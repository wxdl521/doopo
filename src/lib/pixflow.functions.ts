// ====================================================================
//  Pixflow AI Gateway —— OpenAI 兼容 + Gemini Native 混合协议
//
//  Base URL: https://api.pixflow.im (env: GOOGLE_GEMINI_BASE_URL 可覆盖)
//  Auth (OpenAI):  Authorization: Bearer ${PIXFLOW_API_KEY}
//  Auth (Gemini):  x-goog-api-key: ${PIXFLOW_API_KEY}
//
//  覆盖两类调用:
//    1) callPixflowImage   —— 图像生成
//       - Gemini 图像模型 → POST /v1beta/models/{id}:generateContent
//         (responseModalities=["TEXT","IMAGE"]; 返回 inlineData base64)
//       - gpt-image-* 模型 → POST /v1/images/generations
//         (注:实测当前 API Key 分组不开放 OpenAI Images,会返回 404)
//       已验证可用: gemini-3-pro-image-preview, gemini-3.1-flash-image-preview,
//                   gemini-3.1-flash-image
//    2) callPixflowChat    POST /v1/chat/completions
//       支持: gemini-2.5-pro / 2.5-flash / 3-flash-preview / 3.1-pro-preview ...
//
//  模型 id 约定:在项目里所有 Pixflow 走的模型,UI 选项都加前缀 `pixflow/`
//  以避免和现有 Seedream/Qwen/OpenRouter 路由冲突。本模块在调用时会
//  自动剥离这个前缀再发给 Pixflow。
// ====================================================================

import './loadEnv'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

const DEFAULT_BASE_URL = 'https://api.pixflow.im'
// Pixflow 文档建议:图片请求超时设到 ~400s,文本请求保持较短即可
const REQUEST_TIMEOUT_MS = 120_000
const IMAGE_REQUEST_TIMEOUT_MS = 400_000
const PIXFLOW_PREFIX = 'pixflow/'

export function isPixflowModel(modelId: string | null | undefined): boolean {
  return !!modelId && modelId.toLowerCase().startsWith(PIXFLOW_PREFIX)
}

/** 剥离 `pixflow/` 前缀,得到真正的 upstream model id */
export function stripPixflowPrefix(modelId: string): string {
  return modelId.replace(/^pixflow\//i, '')
}

function getPixflowConfig() {
  return {
    apiKey: process.env.PIXFLOW_API_KEY,
    baseUrl: (process.env.GOOGLE_GEMINI_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ''),
  }
}

/**
 * Pixflow 按"模型分组"发放 API Key:gpt-image-* 与 gemini-* 通常不是同一个 key。
 * 若用户单独提供了 PIXFLOW_GEMINI_API_KEY / PIXFLOW_OPENAI_API_KEY,则优先使用;
 * 否则回落到通用 PIXFLOW_API_KEY。
 */
function pickPixflowKey(model: string): string | undefined {
  const generic = process.env.PIXFLOW_API_KEY
  if (/^gemini-/i.test(model)) {
    return process.env.PIXFLOW_GEMINI_API_KEY || generic
  }
  if (/^gpt-/i.test(model)) {
    return process.env.PIXFLOW_OPENAI_API_KEY || generic
  }
  return generic
}

// ---------- Image generation ----------

type PixflowImageInput = {
  prompt: string
  model: string
  size?: string
  n?: number
  /** OpenAI quality 字段(auto/low/high);仅 gpt-image-* 走 OpenAI 兼容时下发 */
  quality?: 'auto' | 'low' | 'high'
  /** I2I 参考图 URL 列表(Gemini Native 会下载后转 base64 注入) */
  referenceImages?: string[]
}

type PixflowImageResult = {
  url: string
  urls: string[]
  error: string | null
  model: string
}

/** 把 size 字符串(1024x1024 / 1K / 2K)折算成 Gemini imageConfig.imageSize 档位 */
function toGeminiImageSize(size?: string): '1K' | '2K' | '4K' {
  if (!size) return '1K'
  const s = size.trim().toUpperCase()
  if (s === '1K' || s === '2K' || s === '4K') return s as '1K' | '2K' | '4K'
  const m = s.match(/^(\d+)\s*[xX*]\s*(\d+)$/)
  if (m) {
    const pixels = parseInt(m[1], 10) * parseInt(m[2], 10)
    if (pixels >= 4_000_000) return '2K'
  }
  return '1K'
}

/** 下载 URL 转 base64 + mime,失败返回 null(跳过该参考图) */
async function urlToInlineData(url: string): Promise<{ mimeType: string; data: string } | null> {
  try {
    const ctl = new AbortController()
    const tm = setTimeout(() => ctl.abort(), 20_000)
    const r = await fetch(url, { signal: ctl.signal })
    clearTimeout(tm)
    if (!r.ok) return null
    const buf = Buffer.from(await r.arrayBuffer())
    const mime = r.headers.get('content-type')?.split(';')[0]?.trim() || 'image/png'
    return { mimeType: mime, data: buf.toString('base64') }
  } catch {
    return null
  }
}

/**
 * Pixflow 图像生成 —— 按 model id 自动选择最合适的协议。
 * 返回与 Seedream/Qwen 一致的 { url, urls, error, model }。
 */
export async function callPixflowImage(input: PixflowImageInput): Promise<PixflowImageResult> {
  const { baseUrl } = getPixflowConfig()
  const model = stripPixflowPrefix(input.model)
  const apiKey = pickPixflowKey(model)
  const refCount = input.referenceImages?.length ?? 0
  const protocol = /^gemini-/i.test(model) ? 'gemini-native' : 'openai-compat'
  const endpointHint = protocol === 'gemini-native'
    ? `/v1beta/models/${model}:generateContent`
    : (refCount > 0 ? '/v1/images/edits' : '/v1/images/generations')
  const t0 = Date.now()
  console.log(`[pixflow→] model=${model} protocol=${protocol} endpoint=${endpointHint} refs=${refCount} size=${input.size ?? 'default'} quality=${input.quality ?? 'auto'}`)
  if (!apiKey) {
    const needed = /^gemini-/i.test(model) ? 'PIXFLOW_GEMINI_API_KEY (or PIXFLOW_API_KEY)' : /^gpt-/i.test(model) ? 'PIXFLOW_OPENAI_API_KEY (or PIXFLOW_API_KEY)' : 'PIXFLOW_API_KEY'
    console.warn(`[pixflow×] model=${model} missing ${needed}`)
    return { url: '', urls: [], error: `${needed} not configured`, model }
  }

  // ----- Gemini 系列走 Native generateContent(图像模型返回 inlineData)-----
  if (/^gemini-/i.test(model)) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [
        { text: input.prompt },
      ]
      if (input.referenceImages?.length) {
        for (const url of input.referenceImages) {
          const inline = await urlToInlineData(url)
          if (inline) parts.push({ inlineData: inline })
        }
      }
      const res = await fetch(`${baseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts }],
          generationConfig: {
            responseModalities: ['TEXT', 'IMAGE'],
            imageConfig: { imageSize: toGeminiImageSize(input.size) },
          },
        }),
        signal: controller.signal,
      })
      clearTimeout(timeout)
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        console.warn(`[pixflow×] model=${model} status=${res.status} dur=${Date.now() - t0}ms body=${text.slice(0, 200)}`)
        return { url: '', urls: [], error: `[pixflow ${model}] ${res.status}: ${text.slice(0, 300)}`, model }
      }
      const json = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> } }>
        error?: { message?: string }
      }
      const urls: string[] = []
      for (const cand of json.candidates ?? []) {
        for (const part of cand.content?.parts ?? []) {
          if (part.inlineData?.data) {
            const mime = part.inlineData.mimeType || 'image/png'
            urls.push(`data:${mime};base64,${part.inlineData.data}`)
          }
        }
      }
      if (urls.length === 0) {
        console.warn(`[pixflow×] model=${model} empty-candidates dur=${Date.now() - t0}ms err=${json.error?.message ?? ''}`)
        return {
          url: '',
          urls: [],
          error: `[pixflow ${model}] no image returned: ${json.error?.message || 'empty candidates'}`,
          model,
        }
      }
      console.log(`[pixflow✓] model=${model} images=${urls.length} dur=${Date.now() - t0}ms`)
      return { url: urls[0], urls, error: null, model }
    } catch (e) {
      clearTimeout(timeout)
      console.warn(`[pixflow×] model=${model} network dur=${Date.now() - t0}ms err=${e instanceof Error ? e.message : 'fetch failed'}`)
      return {
        url: '',
        urls: [],
        error: `[pixflow ${model}] network: ${e instanceof Error ? e.message : 'fetch failed'}`,
        model,
      }
    }
  }

  // ----- gpt-image-* 走 OpenAI Compatible -----
  //   - 无参考图 → POST /v1/images/generations (JSON, T2I)
  //   - 有参考图 → POST /v1/images/edits     (JSON, images[].image_url)
  //     文档明确:/v1/images/generations 不会把 image/images 当成参考图,
  //     必须走 /v1/images/edits;高稳定分组支持 JSON `images[].image_url`
  //     引用图(免去 multipart 文件上传)。
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), IMAGE_REQUEST_TIMEOUT_MS)
  try {
    const hasRefs = !!input.referenceImages?.length
    const endpoint = hasRefs ? '/v1/images/edits' : '/v1/images/generations'
    const body: Record<string, unknown> = {
      model,
      prompt: input.prompt,
      n: input.n ?? 1,
      size: input.size || '1024x1024',
      quality: input.quality ?? 'auto',
      // 高稳定分组默认返回 url(响应体小);其他分组返回 b64_json,我们都能解析
      response_format: 'url',
    }
    if (hasRefs) {
      body.images = input.referenceImages!.map((image_url) => ({ image_url }))
    }
    // 对 502/524 这种 pixflow 上游瞬时错误做一次重试(指数退避 1.5s)
    let res: Response | null = null
    let lastText = ''
    for (let attempt = 0; attempt < 2; attempt++) {
      res = await fetch(`${baseUrl}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      if (res.ok) break
      lastText = await res.text().catch(() => '')
      const transient = res.status === 502 || res.status === 503 || res.status === 504 || res.status === 524
      if (!transient || attempt === 1) break
      console.warn(`[pixflow⟳] model=${model} endpoint=${endpoint} status=${res.status} retry in 1.5s`)
      await new Promise((r) => setTimeout(r, 1500))
    }
    clearTimeout(timeout)

    if (!res || !res.ok) {
      const status = res?.status ?? 0
      console.warn(`[pixflow×] model=${model} endpoint=${endpoint} status=${status} dur=${Date.now() - t0}ms body=${lastText.slice(0, 200)}`)
      return { url: '', urls: [], error: `[pixflow ${model}] ${status}: ${lastText.slice(0, 300)}`, model }
    }

    const json = (await res.json()) as {
      data?: Array<{ url?: string; b64_json?: string }>
      error?: { message?: string }
    }

    const items = json.data ?? []
    const urls = items
      .map((d) => {
        if (d.url) return d.url
        if (d.b64_json) return `data:image/png;base64,${d.b64_json}`
        return ''
      })
      .filter(Boolean)

    if (urls.length === 0) {
      console.warn(`[pixflow×] model=${model} endpoint=${endpoint} empty-data dur=${Date.now() - t0}ms err=${json.error?.message ?? ''}`)
      return {
        url: '',
        urls: [],
        error: `[pixflow ${model}] no image returned: ${json.error?.message || 'empty data'}`,
        model,
      }
    }
    console.log(`[pixflow✓] model=${model} endpoint=${endpoint} images=${urls.length} dur=${Date.now() - t0}ms`)
    return { url: urls[0], urls, error: null, model }
  } catch (e) {
    clearTimeout(timeout)
    console.warn(`[pixflow×] model=${model} endpoint=${endpointHint} network dur=${Date.now() - t0}ms err=${e instanceof Error ? e.message : 'fetch failed'}`)
    return {
      url: '',
      urls: [],
      error: `[pixflow ${model}] network: ${e instanceof Error ? e.message : 'fetch failed'}`,
      model,
    }
  }
}

// ---------- Chat completion ----------

type PixflowChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

type PixflowChatInput = {
  messages: PixflowChatMessage[]
  model: string
  max_tokens?: number
  temperature?: number
  /** 仅对 GPT-5 系列(Responses API)生效:minimal | low | medium | high | xhigh */
  reasoning_effort?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
  /** 仅对 Responses API 生效:是否禁用对话存储(对应 Codex 的 disable_response_storage) */
  disable_response_storage?: boolean
}

export async function callPixflowChat(input: PixflowChatInput) {
  const { apiKey, baseUrl } = getPixflowConfig()
  const model = stripPixflowPrefix(input.model)
  // gpt-5* 也是 OpenAI 分组,key 优先取 PIXFLOW_OPENAI_API_KEY,回落到通用 key
  const chatKey = /^gpt-/i.test(model) ? (process.env.PIXFLOW_OPENAI_API_KEY || apiKey) : apiKey
  if (!chatKey) {
    return { content: '', error: 'PIXFLOW_API_KEY not configured', model }
  }
  // Pixflow 对 GPT-5 系列要求走 Responses API(wire_api = "responses")
  const useResponses = /^gpt-5(\.|-|$)/i.test(model)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const endpoint = useResponses ? '/v1/responses' : '/v1/chat/completions'
    const body: Record<string, unknown> = useResponses
      ? {
          model,
          // Responses API 用 input[] 替代 messages[];content 是结构化 part 数组
          input: input.messages.map((m) => ({
            role: m.role,
            content: [{ type: m.role === 'assistant' ? 'output_text' : 'input_text', text: m.content }],
          })),
          reasoning: { effort: input.reasoning_effort ?? 'xhigh' },
          store: input.disable_response_storage === false,
          max_output_tokens: input.max_tokens ?? 2000,
        }
      : {
          model,
          messages: input.messages,
          max_tokens: input.max_tokens ?? 2000,
          temperature: input.temperature ?? 0.7,
        }
    const res = await fetch(`${baseUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${chatKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    clearTimeout(timeout)
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { content: '', error: `[pixflow ${model}] ${endpoint} ${res.status}: ${text.slice(0, 300)}`, model }
    }
    const json = (await res.json()) as {
      // chat.completions
      choices?: Array<{ message?: { content?: string } }>
      // responses API
      output_text?: string
      output?: Array<{ content?: Array<{ type?: string; text?: string }> }>
      error?: { message?: string }
    }
    let content = ''
    if (useResponses) {
      content =
        json.output_text ||
        json.output?.flatMap((o) => o.content ?? []).map((c) => c.text || '').join('') ||
        ''
    } else {
      content = json.choices?.[0]?.message?.content || ''
    }
    if (!content) {
      return { content: '', error: `[pixflow ${model}] empty content: ${json.error?.message || ''}`, model }
    }
    return { content, error: null as string | null, model }
  } catch (e) {
    clearTimeout(timeout)
    return {
      content: '',
      error: `[pixflow ${model}] network: ${e instanceof Error ? e.message : 'fetch failed'}`,
      model,
    }
  }
}

// ---------- ServerFn 入口(供前端通过 useServerFn 调用)----------

const PixflowImageFnInput = z.object({
  prompt: z.string().min(1).max(8000),
  model: z.string().min(1).max(200),
  size: z.string().max(50).optional(),
  n: z.number().int().min(1).max(4).optional(),
})

export const generatePixflowImage = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => PixflowImageFnInput.parse(d))
  .handler(async ({ data }) => {
    return callPixflowImage(data)
  })

const PixflowChatFnInput = z.object({
  messages: z.array(z.object({
    role: z.enum(['system', 'user', 'assistant']),
    content: z.string().max(20000),
  })).min(1).max(50),
  model: z.string().min(1).max(200),
  max_tokens: z.number().int().min(1).max(8192).optional(),
  temperature: z.number().min(0).max(2).optional(),
  reasoning_effort: z.enum(['minimal', 'low', 'medium', 'high', 'xhigh']).optional(),
  disable_response_storage: z.boolean().optional(),
})

export const chatPixflow = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => PixflowChatFnInput.parse(d))
  .handler(async ({ data }) => {
    return callPixflowChat(data)
  })
