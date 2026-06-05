// ====================================================================
//  分镜(server) —— 剧情 → 分镜组 → 多图融合 → 分镜图
//
//  包含两个 server function:
//
//  1) generateStoryboardFromPlot
//     - 输入:当集剧情文本 + 角色摘要 + 场景摘要 + 项目风格
//     - 输出:多组 StoryboardGroup(每组 1~3 个镜头,带 startSec/endSec/
//       shotType/action/camera 等字段)。文本任务,走 **DashScope Qwen**
//       (qwen3.6-flash,跟图片生成共用同一个 Qwen API key,稳定性高)。
//       之前用 OpenRouter + gemini-2.5-flash fallback,经常在 google 上
//       报 4xx / 5xx,改回 Qwen 之后稳定。
//
//  2) generateStoryboardShotImage
//     - 输入:单组 plot 文本 + 角色图片 URL 数组 + 场景图片 URL + 镜头信息
//     - 输出:多图融合生成的分镜图 URL(I2I,qwen-image-2.0-pro)
//     - 关键:走 DashScope multimodal-generation 端点,
//       messages[0].content = [角色图1, 角色图2, ..., 场景图, 文字指令]
//       模型把多个参考图按文字指令融合成最终分镜。
//
//  这两个函数对应 workspace UI 的两个动作:
//   - "把当集剧情发给 AI,生成多行分镜组"
//   - "对每个镜头点击生成 / 自动生成,产出分镜图"
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
要求:
1. 严格按剧本顺序切分,覆盖整集主要内容(开头 / 发展 / 高潮 / 结尾都要覆盖)。
2. 景别在 [WS 远景 / MS 中景 / CU 近景 / ECU 特写 / OTS 过肩] 中选择,按剧情需要混合使用。
3. 时间用秒(startSec / endSec),单组时长 2~10 秒;整集时长应合理(根据剧本长度估算)。
4. 角色 ID 必须是传入的角色列表中的 id,场景 ID 必须是传入的场景列表中的 id。
5. action 字段用中文描述该镜头"什么人做什么"。
6. 只输出 JSON,不要任何解释、Markdown 包裹、代码块标记。`

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
      "plotText": "该分镜对应的原始剧情描述(从剧本里摘录 1~2 句)",
      "startSec": 0,
      "endSec": 5,
      "sceneId": "sc-xxx (必须从上面场景列表里挑一个最接近的,没有就 null)",
      "characterIds": ["ch-xxx", "ch-yyy"]   // 该分镜涉及的角色 id 数组,可以是空数组
      "shots": [
        {
          "shotType": "WS" | "MS" | "CU" | "ECU" | "OTS",
          "action": "什么人做什么(中文 1~2 句)",
          "camera": "机位 / 焦段 / 角度(中文简短)"
        },
        // ... 该分镜 1~3 个镜头
      ]
    }
    // ... 依次 ${data.groupCount} 组
  ]
}

注意:
- 严格按照剧本的剧情顺序排 group(不要乱序)。
- sceneId 必须在传入的场景列表里;不确定时给最接近的。
- characterIds 必须在传入的角色列表里;没有明确角色时给空数组 []。
- 镜头组合要有变化,不要 5 组都是 MS 中景。`

    // ---- 调 DashScope Qwen 文本模型 ----
    // 跟图片生成共用同一个 Qwen API key,避免走 OpenRouter + Google fallback
    // 带来的"好像是谷歌 AI"问题。优先 flash(快),失败再试 plus(更强)。
    const apiKey = process.env.Qwen || process.env.DASHSCOPE_API_KEY
    if (!apiKey) return { ok: false as const, error: 'Qwen API key 未配置(请设置 Qwen 或 DASHSCOPE_API_KEY)' }

    const DASHSCOPE_CHAT = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'
    // 优先 flash(快+便宜),fallback 到 plus(更稳)
    const modelAttempts = [
      data.model || 'qwen3.6-flash',
      'qwen3.6-plus',
      'qwen3.7-max',
    ].filter(Boolean)
    const FALLBACK_RETRYABLE = new Set([403, 404, 429, 500, 502, 503])

    let lastError = ''
    for (const model of modelAttempts) {
      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 60_000)
        const res = await fetch(DASHSCOPE_CHAT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
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
          ? `[${model}] timed out (>60s)`
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
  }>
} | null {
  if (!g || typeof g !== 'object') return null
  const plotText = typeof g.plotText === 'string' && g.plotText.trim()
    ? g.plotText.trim().slice(0, 500)
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
    .map((s: any, i: number) => normalizeShot(s, index, i))
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
): {
  id: string
  shotType: 'WS' | 'MS' | 'CU' | 'ECU' | 'OTS'
  shotTypeLabel: string
  action: string
  camera: string
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
  return {
    id: `grp-${groupIndex + 1}-shot-${shotIndex + 1}`,
    shotType: shotType as any,
    shotTypeLabel: SHOT_LABEL_CN[shotType],
    action,
    camera,
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
//    输入:plotText + 角色图片 URL 数组 + 场景图片 URL + 镜头信息
//    走 qwen-image-2.0-pro 多模态生成端点,content 数组里放 N 张参考图
//    + 1 段融合指令文字,模型把多张参考图按指令融合成最终分镜。
// --------------------------------------------------------------------

const ShotInput = z.object({
  // 上下文(用于 prompt)
  plotText: z.string().min(1).max(2000),
  shotType: z.enum(['WS', 'MS', 'CU', 'ECU', 'OTS']),
  shotTypeLabel: z.string().min(1).max(20),
  action: z.string().min(1).max(400),
  camera: z.string().max(200).default(''),
  // 参考图 —— 客户端会先限好:有场景图时 ≤ 2 角色图,无场景图时 ≤ 3 角色图,
  // 总数 (角色 + 场景) ≤ 3。schema 这里再守一道 .max(3),防止意外传超。
  characterImageUrls: z.array(z.string().url()).max(3).default([]),
  characterNames: z.array(z.string().max(50)).max(3).default([]),
  sceneImageUrl: z.string().url().optional(),
  sceneLocation: z.string().max(200).default(''),
  sceneTimeOfDay: z.string().max(50).default(''),
  // 视觉风格
  projectStyle: z.string().max(50).optional(),
  // 模型(默认 qwen-image-2.0-pro)
  model: z.string().max(100).optional(),
})

export type GenerateStoryboardShotInput = z.infer<typeof ShotInput>

export const generateStoryboardShotImage = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => ShotInput.parse(d))
  .handler(async ({ data }) => {
    const { resolveProjectStyle, resolveI2IModel } = await import('./visualStyles')
    const styleSpec = resolveProjectStyle(data.projectStyle)

    // ---- 构造 reference 图数组(content 的 image 元素)----
    // 顺序约定:先所有角色图,再场景图。prompt 里会显式说"图1..N 是 X,图 N+1 是场景"。
    const refImages: { image: string }[] = []
    const nameForIdx: string[] = []
    data.characterImageUrls.forEach((url, i) => {
      if (url) {
        refImages.push({ image: url })
        nameForIdx.push(data.characterNames[i] || `角色${i + 1}`)
      }
    })
    if (data.sceneImageUrl) {
      refImages.push({ image: data.sceneImageUrl })
    }

    // 至少要有一张参考图;没有就报错(走 T2I 模式也没意义 —— 分镜必须有人物 / 场景)
    if (!refImages.length) {
      return { ok: false as const, error: '缺少参考图(至少需要一张角色图或场景图)' }
    }
    // ⚠️ qwen-image-2.0-pro 端点硬限制:content 数组里 image 元素最多 3 张
    //    (0 张 = T2I,1~3 张 = I2I)。客户端应该已经限好,这里再守一道。
    if (refImages.length > 3) {
      return {
        ok: false as const,
        error: `参考图过多(${refImages.length} 张,qwen-image-2.0-pro 最多 3 张)。请减少该分镜涉及的角色数(≤2)或分批生成分镜图。`,
      }
    }

    // ---- 拼融合指令 ----
    const charRefs = data.characterImageUrls.length
      ? data.characterImageUrls
          .map((_, i) => `图${i + 1} = 「${data.characterNames[i] || `角色${i + 1}`}」`)
          .join(', ')
      : ''
    const sceneRef = data.sceneImageUrl
      ? `图${data.characterImageUrls.length + 1} = 场景(${data.sceneLocation || '当前场景'}${data.sceneTimeOfDay ? ' / ' + data.sceneTimeOfDay : ''})`
      : ''

    const instruction = [
      `[任务] 生成一张「${data.shotTypeLabel}」分镜图,严格按下面的融合规则。`,
      ``,
      `[剧情上下文] ${data.plotText}`,
      `[本镜头] ${data.shotType} ${data.shotTypeLabel} —— ${data.action}`,
      data.camera ? `[机位] ${data.camera}` : '',
      ``,
      `[参考图清单(严格按下面的对应关系使用)]`,
      charRefs,
      sceneRef,
      ``,
      `[融合规则]`,
      data.characterImageUrls.length
        ? `1. 图1..N 是角色形象参考,这些角色的脸/身材/衣服必须与参考图保持一致,不得替换、不得"换脸"。`
        : `1. 本镜头没有角色,纯场景。`,
      data.sceneImageUrl
        ? `2. 场景构图、空间布局、光照氛围请以场景参考图为准,本镜头发生在这个场景内。`
        : `2. 没有场景参考,根据剧情推断合理的环境。`,
      `3. 这是 ${data.shotTypeLabel} 镜头:`,
      data.shotType === 'WS'
        ? `   - 远景:人物在画面中占比较小,环境占据画面主体;展示空间感、地理关系、整体氛围。`
        : data.shotType === 'MS'
          ? `   - 中景:人物从膝盖以上,展示肢体语言和主要动作;既能看到人物也能看到周围环境。`
          : data.shotType === 'CU'
            ? `   - 近景:人物胸部以上,重点是表情、眼神、情绪;环境退到背景。`
            : data.shotType === 'ECU'
              ? `   - 特写:画面聚焦在某个细节(眼睛、嘴唇、手、道具),情绪张力最强。`
              : `   - 过肩:从某人肩膀后面拍另一人,常用于对话场景,有空间纵深。`,
      `4. 画面必须是单张分镜图,不能有面板分割、文字、标号。`,
      `5. 风格必须匹配项目视觉风格:${styleSpec.label} —— ${styleSpec.positive}`,
      `6. 角色动作 / 表情 / 视线方向严格按本镜头的"${data.action}"执行。`,
    ].filter(Boolean).join('\n')

    // ---- negative_prompt ----
    const negativePrompt = [
      // 风格漂移
      'different art style, style drift, photorealistic when input is anime, anime when input is realistic, different medium, different line treatment, different color grading',
      // 不要面板 / 文字 / 水印
      'multiple panels, panel, grid, storyboard template, before/after, comparison, text, watermark, logo, signature, label, caption, annotation, arrow, callout',
      // 角色不一致(换脸 / 换衣服)
      'different face, different face shape, different eye shape, different eye color, different nose, different mouth, different eyebrows, different skin tone, different hairstyle, different hair color, different hair length, different outfit, different clothing color, different accessories, different age',
      // 构图:分镜偶尔也会出"半身 / 切脚"
      'medium shot when shot type is full body, close-up when shot type is mid, headshot, bust, half body, cropped at feet, missing feet, missing legs',
      // 摄像机角度(分镜要稳)
      'extreme low angle, worm\'s eye view, hero shot, extreme dutch angle, fisheye, wide-angle distortion',
      // 杂项
      'extra people, bystander, crowd, extra limbs, deformed hands, extra fingers, blurred face, low quality',
    ].join(', ')

    // ---- 调 Qwen multimodal-generation 端点 ----
    const apiKey = process.env.Qwen || process.env.DASHSCOPE_API_KEY
    if (!apiKey) return { ok: false as const, error: 'Qwen API key not configured' }
    const model = resolveI2IModel(data.model || 'qwen-image-2.0-pro')

    // 画幅:分镜用 16:9 / 3:2 横版,默认 1024*1024(模型支持的范围)
    // 后续可以根据 shotType 选不同比例(特写可以方 / 中远可以横),这里先统一
    const size = '1024*1024'

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 120_000)
    let res: Response
    try {
      res = await fetch(
        'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            input: {
              messages: [
                {
                  role: 'user',
                  content: [
                    // 多张参考图(图1 = 角色1, 图2 = 角色2, ..., 图N = 场景)
                    ...refImages,
                    // 融合指令
                    { text: instruction },
                  ],
                },
              ],
            },
            parameters: {
              n: 1,
              negative_prompt: negativePrompt,
              // I2I 模式关掉自动 prompt 扩展(我们要的是严格按指令融合)
              prompt_extend: false,
              watermark: false,
              size,
            },
          }),
          signal: controller.signal,
        },
      )
    } catch (e) {
      clearTimeout(timeout)
      const msg = e instanceof Error ? e.message : 'unknown'
      const isAbort = e instanceof Error && e.name === 'AbortError'
      return { ok: false as const, error: isAbort ? 'AI 处理超时(>120s)' : `请求失败: ${msg}` }
    }
    clearTimeout(timeout)

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      if (res.status === 401) return { ok: false as const, error: 'Qwen auth failed (401)' }
      if (res.status === 402) return { ok: false as const, error: 'no_credits' }
      if (res.status === 429) return { ok: false as const, error: 'rate_limit' }
      return { ok: false as const, error: `Qwen ${res.status}: ${text.slice(0, 300)}` }
    }

    const json = (await res.json()) as {
      output?: { choices?: Array<{ message?: { content?: Array<{ image?: string; type?: string }> } }> }
      message?: string
    }
    const url = json.output?.choices?.[0]?.message?.content?.[0]?.image
    if (!url) {
      return { ok: false as const, error: json.message || 'Qwen 未返回图片 URL' }
    }
    return { ok: true as const, url, model }
  })
