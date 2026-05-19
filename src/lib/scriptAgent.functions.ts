import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

// ============================================================
// 剧本智能体 — 流式生成（Lovable AI Gateway，async generator）
// 5 步：① 灵感  →  ② 故事梗概  →  ③ 第N集分镜  →  ④ 角色卡  →  ⑤ 完成
// 每个 step 服务器以 async function* 形式 yield { delta }，
// 流结束后再 yield { done: true, text }。客户端逐字追加渲染。
// ============================================================

const Lang = z.enum(['zh', 'en'])

const ENDPOINT = 'https://ai.gateway.lovable.dev/v1/chat/completions'
const DEFAULT_MODEL = 'google/gemini-3-flash-preview'

// 解析模型 id："lovable:xxx" / "openrouter:xxx" / 裸 id，全部走 Lovable Gateway。
function pickModel(raw?: string): string {
  const v = raw?.trim()
  if (!v) return DEFAULT_MODEL
  if (v.startsWith('lovable:')) return v.slice(8)
  if (v.startsWith('openrouter:')) return v.slice(11)
  return v
}

type StreamChunk =
  | { delta: string }
  | { done: true; text: string }
  | { error: string }

async function* streamChat(opts: {
  model: string
  system: string
  user: string
}): AsyncGenerator<StreamChunk> {
  const apiKey = process.env.LOVABLE_API_KEY
  if (!apiKey) {
    yield { error: 'LOVABLE_API_KEY 未配置' }
    return
  }

  const controller = new AbortController()
  let upstream: Response
  try {
    upstream = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: opts.model,
        stream: true,
        messages: [
          { role: 'system', content: opts.system },
          { role: 'user', content: opts.user },
        ],
      }),
      signal: controller.signal,
    })
  } catch (e) {
    yield { error: e instanceof Error ? e.message : '网络错误' }
    return
  }

  if (!upstream.ok) {
    if (upstream.status === 429) {
      yield { error: 'rate_limit' }
      return
    }
    if (upstream.status === 402) {
      yield { error: 'no_credits' }
      return
    }
    const txt = await upstream.text().catch(() => '')
    yield { error: `网关错误 ${upstream.status}: ${txt.slice(0, 200)}` }
    return
  }

  if (!upstream.body) {
    yield { error: '上游无响应体' }
    return
  }

  const reader = upstream.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let fullText = ''

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      // SSE：以双换行分隔事件
      let nl: number
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim()
        buffer = buffer.slice(nl + 1)
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (!payload || payload === '[DONE]') continue
        try {
          const json = JSON.parse(payload)
          const delta: string | undefined =
            json?.choices?.[0]?.delta?.content ??
            json?.choices?.[0]?.message?.content
          if (delta) {
            fullText += delta
            yield { delta }
          }
        } catch {
          // 忽略解析失败的心跳/注释
        }
      }
    }
  } catch (e) {
    yield { error: e instanceof Error ? e.message : '流读取失败' }
    return
  } finally {
    try {
      controller.abort()
    } catch {
      /* noop */
    }
  }

  yield { done: true, text: fullText }
}

// ============= 1) 故事梗概 / 一句话剧情 =============

const SynopsisInput = z.object({
  lang: Lang,
  type: z.string(),
  genre: z.string(),
  tone: z.string(),
  theme: z.string().min(1).max(200),
  plot: z.string().min(1).max(2000),
  expectedEpisodes: z.number().min(1).max(200).default(100),
  model: z.string().optional(),
})

const SYS_SYNOPSIS_ZH = `你是一位资深短剧爆款编剧。根据用户灵感，输出一份完整的"剧本基本信息 + 故事大纲 + 章节结构表 + 人设档案"的纯文本框架。

硬性要求：
1) 全文使用 emoji + Markdown 风格章节标题（# / ## / *），便于阅读，但禁止额外解说；
2) 严格按以下结构与顺序输出，不要遗漏任何小节：

# 📺 剧本基本信息
* 主标题：《...》
* 信息卡片：
  * 题材类型：
  * 核心爽点：
  * 目标受众：
  * 预计集数：N 集（单集 1-2 分钟）
  * 情绪基调：

# 📖 故事大纲（深化版）
* 一句话卖点：
* 三句话简介：
  * 起：
  * 承：
  * 转/合：
* 完整剧情大纲：
  * 第 1-5 集（压抑至觉醒）：...
  * 第 6-10 集（初露锋芒）：...
  * 第 11-30 集（青云之巅）：...
  * 第 31-60 集（王朝风云）：...
  * 第 61-90 集（诸天战场）：...
  * 第 91-N 集（终极之战）：...

# 🎬 章节结构表（N 集框架）
| 集数范围 | 标题范例 | 核心事件 | 爽点/反转 | 悬念 |
| :--- | :--- | :--- | :--- | :--- |
| 1-5 | 《...》 | ... | ... | ... |
（至少 6 行，覆盖全剧）

# 👥 人设档案
对主角、核心反派、关键女配、关键男配各一段，含：
* 视觉外貌（年龄/身高/发型/眼神/服饰）
* 性格
* 金手指 / 可恨之处 / 特殊设定
* 经典台词

末尾另起两段，原样输出：

---

## 📋 同步确认信息清单

请确认以下信息，以便我开始创作完整剧本：

第 1 集需要几个分镜？（默认 15-20 个，建议 15 个左右以快速进入高潮）

请回复"确认"或直接指定第 1 集分镜数量（例如：15 个）。`

const SYS_SYNOPSIS_EN = `You are a seasoned short-drama screenwriter. From the user idea, produce a complete framework: basic info, story outline, chapter table, character dossiers, in plain English markdown text. Always finish with a "Confirmation Checklist" asking how many storyboards the user wants for Episode 1 (default 15-20).`

export const streamSynopsis = createServerFn({ method: 'POST', response: 'raw' })
  .inputValidator((d: unknown) => SynopsisInput.parse(d))
  .handler(async function* ({ data }) {
    const sys = data.lang === 'zh' ? SYS_SYNOPSIS_ZH : SYS_SYNOPSIS_EN
    const user =
      data.lang === 'zh'
        ? `【类型】${data.type}\n【题材】${data.genre}\n【风格】${data.tone}\n【主题/标题】${data.theme}\n【剧情概要】${data.plot}\n【预计集数】${data.expectedEpisodes} 集`
        : `[Type] ${data.type}\n[Genre] ${data.genre}\n[Tone] ${data.tone}\n[Theme] ${data.theme}\n[Plot] ${data.plot}\n[Expected episodes] ${data.expectedEpisodes}`
    yield* streamChat({ model: pickModel(data.model), system: sys, user })
  })

// ============= 2) 第 N 集分镜脚本 + 后续概要 =============

const EpisodeInput = z.object({
  lang: Lang,
  epIndex: z.number().min(1).max(200).default(1),
  sceneCount: z.number().min(3).max(40).default(16),
  synopsisText: z.string().min(20).max(20000),
  model: z.string().optional(),
})

const SYS_EPISODE_ZH = `你是一位资深短剧分镜师，请基于已确认的故事梗概，输出"第 N 集完整分镜脚本"的纯文本。

硬性要求：
1) 用以下结构输出，禁止额外解说：

# 🎬 第 N 集完整分镜脚本（X 个分镜）
《本集副标题》

然后依次输出 X 个分镜，每个分镜独立一段：
【场标】INT./EXT. 中文地点 — 时段
（动作/情绪/画面描述，80-160 字）
对白角色：单句对白 ≤ 30 字
对白角色：...
（必要时附 (情绪) 括号提示）

2) 分镜数量严格等于用户指定的 X 个；
3) 节奏先抑后扬，至少一次重大反转，最后一镜留钩子；
4) 接着另起一节：

# 💡 后续集数概要（第 N+1 至 N+9 集）
* 第 N+1 集：...
* 第 N+2 集：...
（共 9 集，每集 1-2 句话）

5) 末尾原样输出：

---

输出后追问：
1. 是否继续生成第 N+1 集的完整分镜脚本？
2. 对本集的节奏、分镜数量或人设是否有调整建议？`

const SYS_EPISODE_EN = `You are a seasoned short-drama storyboarder. Produce Episode N storyboards in plain English following the same structure, then 9-episode rolling summary, then a confirmation question.`

export const streamEpisodeScenes = createServerFn({ method: 'POST', response: 'raw' })
  .inputValidator((d: unknown) => EpisodeInput.parse(d))
  .handler(async function* ({ data }) {
    const sys = (data.lang === 'zh' ? SYS_EPISODE_ZH : SYS_EPISODE_EN)
      .replace(/N\+1/g, String(data.epIndex + 1))
      .replace(/N\+9/g, String(data.epIndex + 9))
      .replace(/第 N /g, `第 ${data.epIndex} `)
      .replace(/Episode N/g, `Episode ${data.epIndex}`)
      .replace(/X/g, String(data.sceneCount))
    const user =
      data.lang === 'zh'
        ? `【目标集数】第 ${data.epIndex} 集\n【分镜数量】${data.sceneCount} 个\n【故事梗概参考】\n${data.synopsisText.slice(0, 8000)}`
        : `[Episode] ${data.epIndex}\n[Storyboards] ${data.sceneCount}\n[Synopsis]\n${data.synopsisText.slice(0, 8000)}`
    yield* streamChat({ model: pickModel(data.model), system: sys, user })
  })

// ============= 3) 角色卡（纯文本档案） =============

const CharactersInput = z.object({
  lang: Lang,
  synopsisText: z.string().min(20).max(20000),
  episodeText: z.string().max(20000).optional(),
  model: z.string().optional(),
})

const SYS_CHARACTERS_ZH = `你是资深角色设计师，基于已有故事梗概与第 1 集分镜，输出"角色卡"纯文本档案。

对每位主要角色（主角 / 反派 / 女配 / 男配，至少 4 位）按如下结构输出：

# 👤 角色名（年龄）— 定位（主角/反派/...）
* MBTI：
* 关键道具：
* 视觉外貌：（身高/发色/眼神/服饰，画面感）
* 性格底色：
* 动机：
* 与其他角色关系：1-3 条
* 经典台词："..."

严禁额外解说。末尾追加"是否需要调整某位角色？"一句。`

const SYS_CHARACTERS_EN = `You are a character designer. Output character dossiers in plain English following the same fields.`

export const streamCharacters = createServerFn({ method: 'POST', response: 'raw' })
  .inputValidator((d: unknown) => CharactersInput.parse(d))
  .handler(async function* ({ data }) {
    const sys = data.lang === 'zh' ? SYS_CHARACTERS_ZH : SYS_CHARACTERS_EN
    const user =
      data.lang === 'zh'
        ? `【故事梗概】\n${data.synopsisText.slice(0, 8000)}\n${data.episodeText ? `\n【第 1 集分镜】\n${data.episodeText.slice(0, 6000)}` : ''}`
        : `[Synopsis]\n${data.synopsisText.slice(0, 8000)}\n${data.episodeText ? `\n[Episode 1]\n${data.episodeText.slice(0, 6000)}` : ''}`
    yield* streamChat({ model: pickModel(data.model), system: sys, user })
  })