// ====================================================================
//  视频生成 —— 双后端统一调度
//
//  2026 接入:用户在 NewProjectDialog 里既可以选火山方舟 ARK 的 Seedance,
//  也可以选阿里 DashScope 的 HappyHorse / Wanx 系列。后端实现差异不小,
//  这里按 model id 自动路由到对应的提交/轮询端点。
//
//  ┌──────────────────────┬────────────────────────────────────────────┐
//  │ doubao-seedance-*    │ 火山方舟 ARK                               │
//  │ (或 seedance-*)      │  POST {ARK_BASE_URL}/contents/generations/tasks
//  │                      │  GET  {ARK_BASE_URL}/contents/generations/tasks/{id}
//  │                      │  返回结构:{status, content:{video_url}}     │
//  ├──────────────────────┼────────────────────────────────────────────┤
//  │ happyhorse-*         │ 阿里 DashScope                              │
//  │ wan2.*-i2v / t2v     │  POST dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis
//  │ wanx2.1-*            │  Header: X-DashScope-Async: enable
//  │ qwen-image 视频变体  │  GET  dashscope.aliyuncs.com/api/v1/tasks/{id}
//  │ (其他 legacy)        │  返回结构:{output:{task_status, video_url}}│
//  └──────────────────────┴────────────────────────────────────────────┘
//
//  三个 server function:
//   1) submitVideoTask       —— 立即返回 taskId
//   2) pollVideoTask         —— 单次轮询
//   3) generateVideo         —— 高层 helper(submit + poll + onProgress)
//
//  历史:这个文件的前身是 seedance.functions.ts(2026 6 月仅支持 ARK)。
//  用户在 docs/qwen.md 加了 HappyHorse 接口后,扩展成双后端 dispatcher。
// ====================================================================

import './loadEnv'  // 2026 修复:必须最先导入,让 ARK/Qwen env 在读取前就绪
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

// ---------- ARK (Seedance) 配置 ----------

const ARK_DEFAULT_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3'
const ARK_DEFAULT_MODEL = 'doubao-seedance-2-0-260128'

// ---------- DashScope (HappyHorse / Wanx) 配置 ----------

const DASHSCOPE_VIDEO_ENDPOINT =
  'https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis'
const DASHSCOPE_TASK_GET = 'https://dashscope.aliyuncs.com/api/v1/tasks/'

// ====================================================================
// 模型路由
// ====================================================================

/**
 * 模型 id 路由到对应后端。
 *  - ARK (Seedance):doubao-seedance-* 或 seedance-*
 *  - DashScope (HappyHorse / Wan / Wanx):其他视频模型 id 一律 fallback 到 DashScope
 */
export function getVideoBackend(modelId: string | null | undefined): 'ark' | 'dashscope' {
  const m = (modelId || '').trim().toLowerCase()
  if (m.startsWith('doubao-seedance-') || m.startsWith('seedance-')) return 'ark'
  return 'dashscope'
}

export const SEEDANCE_MODELS = {
  'doubao-seedance-2-0-260128': 'Doubao Seedance 2.0',
  'doubao-seedance-2-0-fast-260128': 'Doubao Seedance 2.0 Fast (720p)',
  'doubao-seedance-1-0-pro-250528': 'Doubao Seedance 1.0 Pro (T2V)',
  'doubao-seedance-1-0-lite-i2v-250428': 'Doubao Seedance 1.0 Lite (I2V)',
} as const

export const HAPPYHORSE_MODELS = {
  'happyhorse-1.0-t2v': 'HappyHorse 1.0 (文生视频)',
  'happyhorse-1.0-i2v': 'HappyHorse 1.0 (图生视频·首帧)',
  'happyhorse-1.0-r2v': 'HappyHorse 1.0 (参考生视频)',
} as const

// ====================================================================
// 通用类型
// ====================================================================

type ContentItem =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string }; role?: 'reference_image' }
  | { type: 'video_url'; video_url: { url: string }; role?: 'reference_video' }
  | { type: 'audio_url'; audio_url: { url: string }; role?: 'reference_audio' }

export type SeedanceProgress = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

export const SUPPORTED_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'] as const
export type SeedanceRatio = (typeof SUPPORTED_RATIOS)[number]

// ====================================================================
// ARK (Seedance) 端实现
// ====================================================================

function getArkConfig() {
  return {
    apiKey: process.env.ARK_API_KEY,
    baseUrl: (process.env.ARK_BASE_URL || ARK_DEFAULT_BASE_URL).replace(/\/+$/, ''),
    model: process.env.ARK_VIDEO_MODEL || ARK_DEFAULT_MODEL,
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function arkSubmit(input: {
  model: string
  content: ContentItem[]
  ratio?: SeedanceRatio
  duration?: number
  generateAudio?: boolean
  watermark?: boolean
  apiKey: string
  baseUrl: string
}): Promise<{ ok: true; taskId: string; model: string } | { ok: false; error: string }> {
  const body: Record<string, unknown> = {
    model: input.model,
    content: input.content,
  }
  if (input.ratio) body.ratio = input.ratio
  if (typeof input.duration === 'number') body.duration = input.duration
  if (typeof input.generateAudio === 'boolean') body.generate_audio = input.generateAudio
  if (typeof input.watermark === 'boolean') body.watermark = input.watermark

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000)
  try {
    const res = await fetch(`${input.baseUrl}/contents/generations/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    clearTimeout(timeout)
    const text = await res.text().catch(() => '')
    if (!res.ok) return { ok: false, error: `[ark-seedance] submit ${res.status}: ${text.slice(0, 300)}` }
    // 2026/06 Bugfix:res.text() 已经把 body 流消费了,res.json() 必然失败。
    // 改成 JSON.parse(text) 复用同一份 text,不再二次读 body。
    let json: { id?: string; error?: { code?: string; message?: string } } = {}
    try { json = JSON.parse(text) } catch {}
    if (!json.id) return { ok: false, error: `[ark-seedance] no task_id: ${json.error?.message || text.slice(0, 200)}` }
    return { ok: true, taskId: json.id, model: input.model }
  } catch (e) {
    clearTimeout(timeout)
    const msg = e instanceof Error ? (e.name === 'AbortError' ? 'submit timeout (30s)' : e.message) : 'fetch failed'
    return { ok: false, error: `[ark-seedance] network: ${msg}` }
  }
}

async function arkPoll(input: {
  taskId: string
  apiKey: string
  baseUrl: string
}): Promise<
  | { ok: true; status: SeedanceProgress; videoUrl: string | null; raw: any }
  | { ok: false; error: string; status?: SeedanceProgress; raw?: any }
> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000)
  try {
    const res = await fetch(`${input.baseUrl}/contents/generations/tasks/${input.taskId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.apiKey}`,
      },
      signal: controller.signal,
    })
    clearTimeout(timeout)
    const text = await res.text().catch(() => '')
    if (!res.ok) return { ok: false, error: `[ark-seedance] poll ${res.status}: ${text.slice(0, 300)}` }
    // 2026/06 Bugfix:见 arkSubmit —— 改用 JSON.parse(text) 而不是 res.json()
    let json: { id?: string; status?: string; content?: { video_url?: string }; error?: { code?: string; message?: string } } = {}
    try { json = JSON.parse(text) } catch {}
    const status = (json.status?.toLowerCase() || '') as SeedanceProgress
    const videoUrl = json.content?.video_url || null
    return { ok: true, status, videoUrl, raw: json }
  } catch (e) {
    clearTimeout(timeout)
    const msg = e instanceof Error ? (e.name === 'AbortError' ? 'poll timeout (30s)' : e.message) : 'fetch failed'
    return { ok: false, error: `[ark-seedance] poll network: ${msg}` }
  }
}

// ====================================================================
// DashScope (HappyHorse / Wanx) 端实现
//
//  提交:POST /api/v1/services/aigc/video-generation/video-synthesis
//        Header: X-DashScope-Async: enable
//        Body:
//          {
//            "model": "happyhorse-1.0-t2v" | "-i2v" | "-r2v",
//            "input": {
//              "prompt": "...",
//              "media": [                    ← 可选,首帧 / 参考图
//                { "type": "first_frame", "url": "..." },
//                { "type": "reference_image", "url": "..." },
//                ...
//              ]
//            },
//            "parameters": {
//              "resolution": "720P" | "1080P",
//              "ratio": "16:9" | "9:16" | ... ,
//              "duration": 5
//            }
//          }
//        返回:{ output: { task_id, task_status: "PENDING" } }
//
//  轮询:GET /api/v1/tasks/{task_id}
//        返回:{ output: { task_status, video_url, submit_time, ... } }
//        video_url 出现在 output.video_url(output.results 不存在,跟 image 任务不同)。
// ====================================================================

function getDashScopeConfig() {
  return {
    apiKey: process.env.Qwen || process.env.DASHSCOPE_API_KEY,
  }
}

type DashScopeMediaItem = { type: 'first_frame' | 'reference_image'; url: string }

// ----- ARK 内容拼装 -----
type ArkReferences = {
  referenceImageUrls?: string[]
  firstFrameImageUrl?: string
  referenceVideoUrl?: string
  referenceAudioUrl?: string
}

/**
 * 按 ARK 官方 cURL 示例拼 content 数组(text + 多个 image_url + 可选 video_url / audio_url)
 */
export function buildArkContent(prompt: string, refs: ArkReferences): ContentItem[] {
  const content: ContentItem[] = [{ type: 'text', text: prompt }]
  if (refs.firstFrameImageUrl) {
    content.push({ type: 'image_url', image_url: { url: refs.firstFrameImageUrl }, role: 'reference_image' })
  }
  for (const url of refs.referenceImageUrls ?? []) {
    content.push({ type: 'image_url', image_url: { url }, role: 'reference_image' })
  }
  if (refs.referenceVideoUrl) {
    content.push({ type: 'video_url', video_url: { url: refs.referenceVideoUrl }, role: 'reference_video' })
  }
  if (refs.referenceAudioUrl) {
    content.push({ type: 'audio_url', audio_url: { url: refs.referenceAudioUrl }, role: 'reference_audio' })
  }
  return content
}

async function dashscopeSubmit(input: {
  model: string
  prompt: string
  media: DashScopeMediaItem[]
  ratio?: string
  resolution?: string
  duration?: number
  apiKey: string
}): Promise<{ ok: true; taskId: string; model: string } | { ok: false; error: string }> {
  const body: Record<string, unknown> = {
    model: input.model,
    input: {
      prompt: input.prompt,
      ...(input.media.length > 0 ? { media: input.media } : {}),
    },
    parameters: {
      resolution: input.resolution || '720P',
      ...(input.ratio ? { ratio: input.ratio } : {}),
      ...(typeof input.duration === 'number' ? { duration: input.duration } : {}),
    },
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000)
  try {
    const res = await fetch(DASHSCOPE_VIDEO_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.apiKey}`,
        'X-DashScope-Async': 'enable',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    clearTimeout(timeout)
    const text = await res.text().catch(() => '')
    if (!res.ok) return { ok: false, error: `[dashscope-video] submit ${res.status}: ${text.slice(0, 300)}` }
    // 2026/06 Bugfix:见 arkSubmit —— 改用 JSON.parse(text) 而不是 res.json()
    let json: { output?: { task_id?: string; task_status?: string }; error?: { code?: string; message?: string } } = {}
    try { json = JSON.parse(text) } catch {}
    const taskId = json.output?.task_id
    if (!taskId) {
      return { ok: false, error: `[dashscope-video] no task_id: ${json.error?.message || text.slice(0, 200)}` }
    }
    return { ok: true, taskId, model: input.model }
  } catch (e) {
    clearTimeout(timeout)
    const msg = e instanceof Error ? (e.name === 'AbortError' ? 'submit timeout (30s)' : e.message) : 'fetch failed'
    return { ok: false, error: `[dashscope-video] network: ${msg}` }
  }
}

async function dashscopePoll(input: {
  taskId: string
  apiKey: string
}): Promise<
  | { ok: true; status: SeedanceProgress; videoUrl: string | null; raw: any }
  | { ok: false; error: string; status?: SeedanceProgress; raw?: any }
> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000)
  try {
    const res = await fetch(DASHSCOPE_TASK_GET + input.taskId, {
      headers: { Authorization: `Bearer ${input.apiKey}` },
      signal: controller.signal,
    })
    clearTimeout(timeout)
    const text = await res.text().catch(() => '')
    if (!res.ok) return { ok: false, error: `[dashscope-video] poll ${res.status}: ${text.slice(0, 300)}` }
    // 2026/06 Bugfix:见 arkSubmit —— 改用 JSON.parse(text) 而不是 res.json()
    let json: { output?: { task_status?: string; video_url?: string; results?: Array<{ video_url?: string; url?: string }> }; error?: { code?: string; message?: string } } = {}
    try { json = JSON.parse(text) } catch {}
    const rawStatus = (json.output?.task_status || '').toUpperCase()
    const status = rawStatus.toLowerCase() as SeedanceProgress
    // 成功时 video_url 在 output.video_url(DashScope 视频任务的字段);
    // 但有少数版本也用 output.results[0].video_url / .url,做一下兜底
    const videoUrl =
      json.output?.video_url ||
      json.output?.results?.[0]?.video_url ||
      json.output?.results?.[0]?.url ||
      null
    return { ok: true, status, videoUrl, raw: json }
  } catch (e) {
    clearTimeout(timeout)
    const msg = e instanceof Error ? (e.name === 'AbortError' ? 'poll timeout (30s)' : e.message) : 'fetch failed'
    return { ok: false, error: `[dashscope-video] poll network: ${msg}` }
  }
}

// ====================================================================
// 统一 submit / poll(根据 model id 派发)
// ====================================================================

type SubmitInput = {
  model: string
  prompt: string
  media: DashScopeMediaItem[]  // 同时给 ARK 和 DashScope 用
  ratio?: SeedanceRatio
  resolution?: string
  duration?: number
  generateAudio?: boolean
  watermark?: boolean
}

type SubmitResult = { ok: true; taskId: string; model: string; backend: 'ark' | 'dashscope' } | { ok: false; error: string }

async function submitVideoTask(input: SubmitInput): Promise<SubmitResult> {
  const backend = getVideoBackend(input.model)
  if (backend === 'ark') {
    const { apiKey, baseUrl } = getArkConfig()
    if (!apiKey) return { ok: false, error: 'ARK_API_KEY not configured' }
    // 构造 ARK content 数组
    const content: ContentItem[] = [{ type: 'text', text: input.prompt }]
    for (const m of input.media) {
      // ARK 的角色 = 'reference_image'(不论 DashScope 是 first_frame 还是 reference_image,都当参考)
      content.push({ type: 'image_url', image_url: { url: m.url }, role: 'reference_image' })
    }
    const r = await arkSubmit({
      model: input.model,
      content,
      ratio: input.ratio,
      duration: input.duration,
      generateAudio: input.generateAudio,
      watermark: input.watermark,
      apiKey,
      baseUrl,
    })
    return r.ok ? { ok: true, taskId: r.taskId, model: r.model, backend: 'ark' } : { ok: false, error: r.error }
  }
  // DashScope
  const { apiKey } = getDashScopeConfig()
  if (!apiKey) return { ok: false, error: 'Qwen / DASHSCOPE_API_KEY not configured' }
  const r = await dashscopeSubmit({
    model: input.model,
    prompt: input.prompt,
    media: input.media,
    ratio: input.ratio,
    resolution: input.resolution,
    duration: input.duration,
    apiKey,
  })
  return r.ok ? { ok: true, taskId: r.taskId, model: r.model, backend: 'dashscope' } : { ok: false, error: r.error }
}

type PollInput = { taskId: string; backend: 'ark' | 'dashscope' }

type PollResult =
  | { ok: true; status: SeedanceProgress; videoUrl: string | null; raw: any }
  | { ok: false; error: string; status?: SeedanceProgress; raw?: any }

async function pollVideoTask(input: PollInput): Promise<PollResult> {
  if (input.backend === 'ark') {
    const { apiKey, baseUrl } = getArkConfig()
    if (!apiKey) return { ok: false, error: 'ARK_API_KEY not configured' }
    return arkPoll({ taskId: input.taskId, apiKey, baseUrl })
  }
  const { apiKey } = getDashScopeConfig()
  if (!apiKey) return { ok: false, error: 'Qwen / DASHSCOPE_API_KEY not configured' }
  return dashscopePoll({ taskId: input.taskId, apiKey })
}

// ====================================================================
// 公开 server functions
// ====================================================================

// ---- 1) submitVideoTaskFn (server fn) ----

const SubmitServerInput = z.object({
  model: z.string().max(200).optional(),
  content: z.array(z.any()).min(1).max(20),
  ratio: z.enum(SUPPORTED_RATIOS).optional(),
  duration: z.number().int().min(1).max(60).optional(),
  generateAudio: z.boolean().optional(),
  watermark: z.boolean().optional(),
})

export const submitVideoTaskFn = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => SubmitServerInput.parse(d))
  .handler(async ({ data }) => {
    // 把 ARK 风格的 content 数组转成统一 media 形式
    const media: DashScopeMediaItem[] = []
    for (const item of (data.content as any[])) {
      if (item?.type === 'image_url' && item?.image_url?.url) {
        media.push({ type: 'reference_image', url: item.image_url.url })
      }
    }
    const prompt = (data.content as any[]).find((i) => i?.type === 'text')?.text || ''
    const model = data.model || ARK_DEFAULT_MODEL

    const r = await submitVideoTask({
      model,
      prompt,
      media,
      ratio: data.ratio,
      duration: data.duration,
      generateAudio: data.generateAudio,
      watermark: data.watermark,
    })
    if (!r.ok) return { ok: false as const, error: r.error }
    return { ok: true as const, taskId: r.taskId, model: r.model, backend: r.backend }
  })

// ---- 2) pollVideoTaskFn (server fn) ----

const PollServerInput = z.object({
  taskId: z.string().min(1).max(200),
  backend: z.enum(['ark', 'dashscope']),
})

export const pollVideoTaskFn = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => PollServerInput.parse(d))
  .handler(async ({ data }) => {
    const r = await pollVideoTask({ taskId: data.taskId, backend: data.backend })
    if (!r.ok) return { ok: false as const, error: r.error, status: r.status }
    return { ok: true as const, status: r.status, videoUrl: r.videoUrl }
  })

// ====================================================================
// 3) generateVideo —— 高层 helper(根据 model id 自动派发到 ARK / DashScope)
//
//   把"提交 + 轮询 + 进度回调"打包成一次调用。客户端拿到的是统一返回:
//     { ok, videoUrl?, error?, taskId?, backend? }
// ====================================================================

const GenerateVideoInput = z.object({
  prompt: z.string().min(1).max(4000),
  // 单张图生视频(图作为首帧 / 参考图)
  imageUrl: z.string().url().optional(),
  referenceImageUrls: z.array(z.string().url()).max(8).optional(),
  referenceVideoUrl: z.string().url().optional(),
  referenceAudioUrl: z.string().url().optional(),
  model: z.string().max(200).optional(),
  ratio: z.enum(SUPPORTED_RATIOS).default('16:9'),
  duration: z.number().int().min(1).max(60).default(5),
  resolution: z.enum(['480P', '720P', '1080P']).default('720P'),
  generateAudio: z.boolean().optional(),
  watermark: z.boolean().optional(),
  onProgress: z.function().optional(),
  deadlineMs: z.number().int().min(5_000).max(600_000).optional(),
  pollMs: z.number().int().min(1_000).max(30_000).optional(),
})

export type GenerateVideoInputType = z.infer<typeof GenerateVideoInput>

export const generateVideo = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => GenerateVideoInput.parse(d))
  .handler(async ({ data }) => {
    const backend = getVideoBackend(data.model)
    const media: DashScopeMediaItem[] = []
    if (data.imageUrl) media.push({ type: 'first_frame', url: data.imageUrl })
    if (data.referenceImageUrls?.length) {
      for (const url of data.referenceImageUrls) media.push({ type: 'reference_image', url })
    }

    const model = data.model || (backend === 'ark' ? ARK_DEFAULT_MODEL : 'happyhorse-1.0-i2v')

    // 1) 提交
    const submit = await submitVideoTask({
      model,
      prompt: data.prompt,
      media,
      ratio: data.ratio,
      resolution: data.resolution,
      duration: data.duration,
      generateAudio: data.generateAudio,
      watermark: data.watermark,
    })
    if (!submit.ok) {
      return { ok: false as const, error: submit.error, taskId: undefined, backend }
    }

    data.onProgress?.('queued', { taskId: submit.taskId, backend })

    // 2) 轮询
    const deadline = Date.now() + (data.deadlineMs ?? 300_000)  // 5 min default(视频生成比图慢)
    const pollInterval = data.pollMs ?? 5_000
    let lastStatus: SeedanceProgress = 'queued'
    while (Date.now() < deadline) {
      await sleep(pollInterval)
      const poll = await pollVideoTask({ taskId: submit.taskId, backend: submit.backend })
      if (!poll.ok) {
        // 网络抖动,继续轮询
        continue
      }
      lastStatus = poll.status
      if (poll.status === 'succeeded') {
        data.onProgress?.('succeeded', { taskId: submit.taskId, videoUrl: poll.videoUrl, backend: submit.backend })
        return {
          ok: true as const,
          taskId: submit.taskId,
          videoUrl: poll.videoUrl || '',
          model: submit.model,
          backend: submit.backend,
        }
      }
      if (poll.status === 'failed' || poll.status === 'cancelled') {
        const raw = (poll as any).raw
        const errMsg = raw?.error?.message || raw?.output?.error_message || `${poll.status} (no error detail)`
        return {
          ok: false as const,
          error: `[${submit.backend}] ${poll.status}: ${errMsg}`,
          taskId: submit.taskId,
          backend: submit.backend,
        }
      }
      data.onProgress?.(poll.status, { taskId: submit.taskId, backend: submit.backend })
    }
    return {
      ok: false as const,
      error: `[${submit.backend}] timed out after ${Math.round((data.deadlineMs ?? 300_000) / 1000)}s (last status: ${lastStatus})`,
      taskId: submit.taskId,
      backend: submit.backend,
    }
  })

// ====================================================================
// Backwards-compat alias —— 2026 早期版本叫 generateSeedanceVideo
// 老代码若还在 import 这个名字,会落到 ARK 后端(因为现在 model id 决定 backend)。
// 新代码请直接用 generateVideo。
// ====================================================================
export const generateSeedanceVideo = generateVideo
