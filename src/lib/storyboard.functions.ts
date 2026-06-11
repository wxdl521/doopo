// ====================================================================
//  分镜(server) —— 剧情 → 分镜组 → 多图融合 → 分镜图
//
//  包含三个 server function:
//
//  1) generateStoryboardFromPlot
//     - 输入:当集剧情文本 + 角色摘要 + 场景摘要 + 项目风格
//     - 输出:多组 StoryboardGroup(每组 1~3 个镜头,带 startSec/endSec/
//       shotType/action/camera 等字段)。**文本任务**,走 DashScope Qwen
//       (qwen3.6-flash,跟图片生成共用同一个 Qwen API key,稳定性高)。
//       之前用 OpenRouter + gemini-2.5-flash fallback,经常在 google 上
//       报 4xx / 5xx,改回 Qwen 之后稳定。
//
//  2) generateStoryboardShotImage
//     - 输入:单组 plot 文本 + 角色图片 URL 数组 + 场景图片 URL + 镜头信息
//     - 输出:多图融合生成的分镜图 URL(I2I)
//     - 关键:**2026 重构**走 seedream.functions.ts:generateStoryboardShotImage
//       (POST {ARK_BASE_URL}/images/generations,image 字段 = string[])
//       模型把多个参考图按文字指令融合成最终分镜。提示词 builder 已搬到
//       seedream.functions.ts,这里只保留 Zod schema 和委托入口。
//
//  3) regenerateStoryboardShot
//     - 跟 2) 同结构,但图 1 永远是当前分镜图(referenceImageUrl),
//       角色/场景参考随后。委托给 seedream.functions.ts:regenerateStoryboardShot。
//
//  这三个函数对应 workspace UI 的三个动作:
//   - "把当集剧情发给 AI,生成多行分镜组"
//   - "对每个镜头点击生成 / 自动生成,产出分镜图"
//   - "对已生成的镜头,按用户意见重生"
// ====================================================================

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

// --------------------------------------------------------------------
// 1) generateStoryboardFromPlot —— 文本任务
// --------------------------------------------------------------------

const PlotInput = z.object({
  episodeText: z.string().min(50).max(20000),
  episodeIndex: z.number().int().min(1).max(999),
  // 角色 / 场景摘要(从 workspace 现有 GenCharacter / GenScene 简化而来,
  // 不传整个对象,减少 token 消耗)
  characterSummaries: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        role: z.string().optional(),
        // 一句话形象描述(给 AI 锁定"是谁")
        profile: z.string().max(400),
      }),
    )
    .max(40)
    .default([]),
  sceneSummaries: z
    .array(
      z.object({
        id: z.string(),
        slug: z.string(),
        location: z.string().optional(),
        timeOfDay: z.string().optional(),
        profile: z.string().max(200),
      }),
    )
    .max(40)
    .default([]),
  // 期望生成多少组分镜(客户端可调,默认 6)
  groupCount: z.number().int().min(1).max(20).default(6),
  // 上一集剧情(可选),给 AI 提供上下文
  previousEpisodesText: z.string().max(8000).optional(),
  // 项目风格
  projectStyle: z.string().max(50).optional(),
  // 文本生成模型
  model: z.string().max(100).optional(),
})

export type GenerateStoryboardFromPlotInput = z.infer<typeof PlotInput>

export const generateStoryboardFromPlot = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => PlotInput.parse(d))
  .handler(async ({ data }) => {
    const { resolveProjectStyle } = await import('./visualStyles')
    const styleSpec = resolveProjectStyle(data.projectStyle)

    const charList = data.characterSummaries.length
      ? data.characterSummaries
          .map((c) => `- id="${c.id}" name="${c.name}"${c.role ? ` role="${c.role}"` : ''}: ${c.profile}`)
          .join('\n')
      : '(无角色信息)'
    const sceneList = data.sceneSummaries.length
      ? data.sceneSummaries
          .map((s) => `- id="${s.id}" slug="${s.slug}"${s.location ? ` location="${s.location}"` : ''}${s.timeOfDay ? ` time=${s.timeOfDay}` : ''}: ${s.profile}`)
          .join('\n')
      : '(无场景信息)'

    // 强制 JSON 输出,避免模型输出自然语言;prompt 里明确告诉模型输出 schema。
    const systemPrompt = `你是一名资深影视分镜师。你的任务是把一集剧本切分成若干组分镜。
每组分镜对应剧本中一段连续剧情,包含 1~3 个具体镜头(shot),每个镜头对应一张分镜图。

【plotText 字段要求(2026/06 用户诉求)】
- plotText 仍然要写(AI 输出),但格式必须是**结构化剧情列表**,不是散文:
  • 按 shot 顺序逐条描述
  • 每条对应一个 shot,包含:**台词(必须有,角色名:内容) + 动作(什么人做什么) + 场景变化**
  • 台词是核心 —— 用户说"看不到人物台词,详情不够",所以每条都要有角色对白
- 输出格式示例(plotText 是多行字符串,用 \\n 分隔):
  "陆深在教室自习。\\n小明冲进来:『老师找你!』,声音急迫。\\n陆深抬头:『什么事?』,起身。\\n两人穿过走廊,镜头跟着背影。\\n转场到办公室,陆深推门:『报告。』"
- 这个 plotText 会在 UI 上**辅助展示**(不直接显示,主要用 shots[].action),但要写得**自包含**
- plotText 描述的是"剧情文本",**不要**重复 shot 的景别/镜头信息(那些是 shots.camera)

【分镜 shots 字段要求】
- action 用中文描述该镜头"什么人做什么",1~2 句
- camera 用中文描述机位/焦段/角度
- startSec / endSec 必填:每个 shot 自己在当集时间轴上的区间(秒)。
  - 必须严格在 group 的 startSec~endSec 范围内
  - 连续 shot 的时间区间要无缝衔接(shot N 的 endSec == shot N+1 的 startSec)
  - 单 shot 时长 1~5 秒
- shotType 必填,5 个里选

【其他】
1. 严格按剧本顺序切分,覆盖整集主要内容(开头 / 发展 / 高潮 / 结尾都要覆盖)。
2. 景别在 [WS 远景 / MS 中景 / CU 近景 / ECU 特写 / OTS 过肩] 中选择,按剧情需要混合使用。
3. 时间用秒(startSec / endSec),单组时长 2~10 秒;整集时长应合理。
4. 角色 ID 必须是传入的角色列表中的 id,场景 ID 必须是传入的场景列表中的 id。
5. 只输出 JSON,不要任何解释、Markdown 包裹、代码块标记。`

    const userPrompt = `请把下面第 ${data.episodeIndex} 集剧本切分成 ${data.groupCount} 组分镜,输出 JSON。

===== 角色列表 =====
${charList}

===== 场景列表 =====
${sceneList}

===== 项目视觉风格 =====
${styleSpec.label} —— ${styleSpec.positive}

${data.previousEpisodesText ? `===== 前面集数上下文 =====\n${data.previousEpisodesText}\n` : ''}
===== 第 ${data.episodeIndex} 集剧本 =====
${data.episodeText}

===== 输出 JSON Schema =====
{
  "groups": [
    {
      "id": "grp-1",
      "plotText": "本组完整剧情描述(包含场景变化+人物动作+台词,50-200 字;不要写 shot 描述)",
      "startSec": 0,
      "endSec": 8,
      "sceneId": "sc-xxx (必须从上面场景列表里挑一个最接近的,没有就 null)",
      "characterIds": ["ch-xxx", "ch-yyy"],
      "shots": [
        {
          "shotType": "WS" | "MS" | "CU" | "ECU" | "OTS",
          "action": "什么人做什么(中文 1~2 句)",
          "camera": "机位 / 焦段 / 角度(中文简短)",
          "startSec": 0,
          "endSec": 4
        },
        {
          "shotType": "WS" | "MS" | "CU" | "ECU" | "OTS",
          "action": "什么人做什么(中文 1~2 句)",
          "camera": "机位 / 焦段 / 角度(中文简短)",
          "startSec": 4,
          "endSec": 8
        }
      ]
    }
  ]
}

注意:
- 严格按照剧本的剧情顺序排 group(不要乱序)
- sceneId 必须在传入的场景列表里;不确定时给最接近的
- characterIds 必须在传入的角色列表里;没有明确角色时给空数组 []
- shots 内部:连续 shot 的 endSec 必须等于下一个 shot 的 startSec(无缝衔接)
- shots 内部:第一个 shot 的 startSec == group.startSec,最后一个 shot 的 endSec == group.endSec
- 镜头组合要有变化,不要 5 组都是 MS 中景`

    // ---- 调 DashScope Qwen 文本模型 ----
    // 跟图片生成共用同一个 Qwen API key,避免走 OpenRouter + Google fallback
    // 带来的"好像是谷歌 AI"问题。优先 flash(快),失败再试 plus(更强)。
    const apiKey = process.env.Qwen || process.env.DASHSCOPE_API_KEY
    if (!apiKey) return { ok: false as const, error: 'Qwen API key 未配置(请设置 Qwen 或 DASHSCOPE_API_KEY)' }

    const DASHSCOPE_CHAT = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'
    // 2026/06 修法:[qwen3.7-max] timed out (>60s) 经常超时。
    // 1) 模型顺序:小 → 大(flash 60s 内必出;plus 90s;max 给 180s)
    // 2) 显式 prompt 是大 prompt(长 context + 结构化 JSON 4000 token),
    //    max 模型 60s 根本不够
    // 3) flash 失败时,**优先再试一次 flash** 再跳 plus(网络抖动的概率)
    const MODEL_TIMEOUTS: Record<string, number> = {
      'qwen3.6-flash': 60_000,
      'qwen3.6-plus': 90_000,
      'qwen3.7-max': 180_000,
    }
    const modelAttempts = [
      data.model || 'qwen3.6-flash',
      'qwen3.6-flash',  // flash 再试一次(网络抖动 fallback)
      'qwen3.6-plus',
      'qwen3.7-max',
    ].filter(Boolean)
    const FALLBACK_RETRYABLE = new Set([403, 404, 429, 500, 502, 503])

    let lastError = ''
    for (const model of modelAttempts) {
      const timeoutMs = MODEL_TIMEOUTS[model] ?? 90_000
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const res = await fetch(DASHSCOPE_CHAT, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            // Qwen 支持 response_format 强制 JSON
            response_format: { type: 'json_object' },
            temperature: 0.6,
            max_tokens: 4000,
          }),
          signal: controller.signal,
        })
        clearTimeout(timeout)
        if (!res.ok) {
          const text = await res.text().catch(() => '')
          lastError = `[${model}] ${res.status}: ${text.slice(0, 200)}`
          if (FALLBACK_RETRYABLE.has(res.status)) continue
          return { ok: false as const, error: lastError }
        }
        const json = (await res.json()) as {
          choices?: Array<{ message?: { content?: string } }>
        }
        const raw = json?.choices?.[0]?.message?.content ?? ''
        const jsonText = extractJsonBlock(raw)
        if (!jsonText) {
          lastError = `[${model}] empty JSON output (raw: ${raw.slice(0, 200)})`
          continue
        }
        try {
          const parsed = JSON.parse(jsonText) as { groups?: any[] }
          if (!Array.isArray(parsed.groups)) {
            lastError = `[${model}] no groups in output (raw: ${jsonText.slice(0, 200)})`
            continue
          }
          // 轻校验 + 兜底
          const groups = parsed.groups
            .slice(0, data.groupCount)
            .map((g: any, i: number) => normalizeGroup(g, i, data))
            .filter(Boolean) as ReturnType<typeof normalizeGroup>[]
          if (!groups.length) {
            lastError = `[${model}] all groups filtered out (raw: ${jsonText.slice(0, 200)})`
            continue
          }
          return { ok: true as const, groups, model }
        } catch (e) {
          lastError = `[${model}] parse failed: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)} (raw: ${jsonText.slice(0, 200)})`
          continue
        }
      } catch (e) {
        lastError = e instanceof Error && e.name === 'AbortError'
          ? `[${model}] timed out (>${Math.round(timeoutMs / 1000)}s)`
          : `[${model}] ${e instanceof Error ? e.message : 'network error'}`
      }
    }
    return { ok: false as const, error: lastError || '分镜生成失败' }
  })

// 兜底:把 AI 返回的 loose group 强制规整成可用的 StoryboardGroup
function normalizeGroup(
  g: any,
  index: number,
  data: GenerateStoryboardFromPlotInput,
): {
  id: string
  index: number
  plotText: string
  startSec: number
  endSec: number
  sceneId?: string
  characterIds: string[]
  shots: Array<{
    id: string
    shotType: 'WS' | 'MS' | 'CU' | 'ECU' | 'OTS'
    shotTypeLabel: string
    action: string
    camera: string
    startSec?: number
    endSec?: number
  }>
} | null {
  if (!g || typeof g !== 'object') return null
  const plotText = typeof g.plotText === 'string' && g.plotText.trim()
    ? g.plotText.trim().slice(0, 2000)
    : ''
  if (!plotText) return null
  const startSec = Number.isFinite(g.startSec) ? Math.max(0, Number(g.startSec)) : index * 5
  const endSec = Number.isFinite(g.endSec) ? Math.max(startSec + 1, Number(g.endSec)) : startSec + 5
  const validSceneIds = new Set(data.sceneSummaries.map((s) => s.id))
  const sceneId = typeof g.sceneId === 'string' && validSceneIds.has(g.sceneId) ? g.sceneId : undefined
  const validCharIds = new Set(data.characterSummaries.map((c) => c.id))
  const characterIds: string[] = Array.isArray(g.characterIds)
    ? g.characterIds.filter((x: any) => typeof x === 'string' && validCharIds.has(x))
    : []
  const rawShots: any[] = Array.isArray(g.shots) ? g.shots : []
  const shots = rawShots
    .slice(0, 3)
    .map((s: any, i: number, arr: any[]) => normalizeShot(s, index, i, startSec, endSec, arr))
    .filter((s): s is NonNullable<ReturnType<typeof normalizeShot>> => s !== null)
  if (!shots.length) return null
  return {
    id: `grp-${index + 1}-${Date.now().toString(36)}`,
    index: index + 1,
    plotText,
    startSec,
    endSec,
    sceneId,
    characterIds,
    shots,
  }
}

const SHOT_TYPES = new Set(['WS', 'MS', 'CU', 'ECU', 'OTS'])
const SHOT_LABEL_CN: Record<string, string> = {
  WS: '远景',
  MS: '中景',
  CU: '近景',
  ECU: '特写',
  OTS: '过肩',
}

function normalizeShot(
  s: any,
  groupIndex: number,
  shotIndex: number,
  groupStartSec: number,
  groupEndSec: number,
  allShots: any[],
): {
  id: string
  shotType: 'WS' | 'MS' | 'CU' | 'ECU' | 'OTS'
  shotTypeLabel: string
  action: string
  camera: string
  startSec?: number
  endSec?: number
} | null {
  if (!s || typeof s !== 'object') return null
  const shotType = SHOT_TYPES.has(s.shotType) ? s.shotType : 'MS'
  const action = typeof s.action === 'string' && s.action.trim()
    ? s.action.trim().slice(0, 200)
    : ''
  const camera = typeof s.camera === 'string' && s.camera.trim()
    ? s.camera.trim().slice(0, 100)
    : ''
  if (!action) return null

  // 2026/06:每个 shot 自己的时间范围(秒,绝对值,在当集时间轴上)
  // 优先用 AI 给的 startSec / endSec;否则按 group 区间 + shot 个数均分(兜底)
  let shotStart = Number.isFinite(s.startSec) ? Math.max(groupStartSec, Number(s.startSec)) : null
  let shotEnd = Number.isFinite(s.endSec) ? Number(s.endSec) : null
  if (shotStart !== null && shotEnd !== null) {
    shotEnd = Math.max(shotStart + 1, Math.min(groupEndSec, shotEnd))
  } else {
    // 兜底:均分 group 区间
    const validShots = allShots.filter((x) => x && typeof x === 'object')
    const totalCount = Math.max(1, validShots.length)
    const span = groupEndSec - groupStartSec
    const slice = span / totalCount
    shotStart = groupStartSec + slice * shotIndex
    shotEnd = groupStartSec + slice * (shotIndex + 1)
  }

  return {
    id: `grp-${groupIndex + 1}-shot-${shotIndex + 1}`,
    shotType: shotType as any,
    shotTypeLabel: SHOT_LABEL_CN[shotType],
    action,
    camera,
    startSec: shotStart,
    endSec: shotEnd,
  }
}

/** 从模型输出中尽量提取 JSON 块(容忍 ```json ... ``` 包裹) */
function extractJsonBlock(s: string): string {
  const trimmed = s.trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) return fence[1].trim()
  const first = trimmed.indexOf('{')
  const last = trimmed.lastIndexOf('}')
  if (first !== -1 && last !== -1 && last > first) {
    return trimmed.slice(first, last + 1)
  }
  return ''
}

// --------------------------------------------------------------------
// 2) generateStoryboardShotImage —— 多图融合(I2I)
//
//    2026 重构:实际调用搬到 seedream.functions.ts,这里只保留 Zod schema
//    和委托入口。提示词 builder 集中在 seedream.functions.ts:buildShotInstruction。
//    Seedream 的 image 字段接受 string[],对应 N 张参考图。
// --------------------------------------------------------------------

const ShotInput = z.object({
  // 上下文(用于 prompt)
  plotText: z.string().min(1).max(2000),
  shotType: z.enum(['WS', 'MS', 'CU', 'ECU', 'OTS']),
  shotTypeLabel: z.string().min(1).max(20),
  action: z.string().min(1).max(400),
  camera: z.string().max(200).default(''),
  // 2026/06:每 shot 自带时间范围(秒,绝对值,在当集时间轴上)
  startSec: z.number().min(0).max(3600).optional(),
  endSec: z.number().min(0).max(3600).optional(),
  durationSec: z.number().min(1).max(10).optional(),
  // 参考图 —— 客户端会先限好:有场景图时 ≤ 2 角色图,无场景图时 ≤ 3 角色图,
  // 总数 (角色 + 场景) ≤ 3。schema 这里再守一道 .max(3),防止意外传超。
  characterImageUrls: z.array(z.string().url()).max(3).default([]),
  characterNames: z.array(z.string().max(50)).max(3).default([]),
  sceneImageUrl: z.string().url().optional(),
  sceneLocation: z.string().max(200).default(''),
  sceneTimeOfDay: z.string().max(50).default(''),
  // 视觉风格
  projectStyle: z.string().max(50).optional(),
  // 模型(默认 doubao-seedream-5-0-260128,由 seedream 模块解析)
  model: z.string().max(100).optional(),
})

export type GenerateStoryboardShotInput = z.infer<typeof ShotInput>

export const generateStoryboardShotImage = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => ShotInput.parse(d))
  .handler(async ({ data }) => {
    // 动态 import 避免循环引用
    const { generateStoryboardShotImage: seedreamImpl } = await import('./seedream.functions')
    return seedreamImpl({ data } as any)
  })

// --------------------------------------------------------------------
// 3) regenerateStoryboardShot —— 按修改意见重生分镜图
//
//    2026 重构:同 2),委托给 seedream.functions.ts:regenerateStoryboardShot。
//    关键差别:图 1 永远是 referenceImageUrl(当前镜头),Seedream 端通过
//    seedream.functions.ts 内部处理。
// --------------------------------------------------------------------

const RegenShotInput = z.object({
  // 当前的镜头图(要被改的那张)
  referenceImageUrl: z.string().url(),
  // 用户输入的修改意见
  userInstruction: z.string().min(1).max(500),
  // 上下文(跟 generateStoryboardShotImage 一样)
  plotText: z.string().min(1).max(2000),
  shotType: z.enum(['WS', 'MS', 'CU', 'ECU', 'OTS']),
  shotTypeLabel: z.string().min(1).max(20),
  action: z.string().min(1).max(400),
  camera: z.string().max(200).default(''),
  characterImageUrls: z.array(z.string().url()).max(3).default([]),
  characterNames: z.array(z.string().max(50)).max(3).default([]),
  sceneImageUrl: z.string().url().optional(),
  sceneLocation: z.string().max(200).default(''),
  sceneTimeOfDay: z.string().max(50).default(''),
  projectStyle: z.string().max(50).optional(),
  model: z.string().max(100).optional(),
})

export type RegenerateStoryboardShotInput = z.infer<typeof RegenShotInput>

export const regenerateStoryboardShot = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => RegenShotInput.parse(d))
  .handler(async ({ data }) => {
    // 动态 import 避免循环引用
    const { regenerateStoryboardShot: seedreamImpl } = await import('./seedream.functions')
    return seedreamImpl({ data } as any)
  })
