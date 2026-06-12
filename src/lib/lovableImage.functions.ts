// ====================================================================
//  Lovable AI Gateway —— image generation (openai/gpt-image-*, google/gemini-*-image*)
//
//  Endpoint: POST https://ai.gateway.lovable.dev/v1/images/generations
//  Auth:     Authorization: Bearer ${LOVABLE_API_KEY}
//  Response: { data: [{ b64_json: '<base64>' } | { url: '...' }] }
//
//  调用方:seedream.functions.ts 在用户选了 openai/gpt-image-* 或
//          google/gemini-*-image* 这类模型时委派到此处。
// ====================================================================

import './loadEnv'

const ENDPOINT = 'https://ai.gateway.lovable.dev/v1/images/generations'
const TIMEOUT_MS = 120_000

export type LovableImageInput = {
  prompt: string
  model: string
  size?: string
  /** Optional reference images (base64 data URLs or http URLs) for I2I editing */
  referenceImages?: string[]
}

export type LovableImageResult = {
  url: string
  error: string | null
  model: string
}

/** 判断是否走 Lovable AI Gateway:openai/gpt-image-* 或 google/gemini-*-image* */
export function isLovableGatewayImageModel(modelId: string | null | undefined): boolean {
  if (!modelId) return false
  const id = modelId.toLowerCase()
  if (id.startsWith('openai/gpt-image')) return true
  if (id.startsWith('google/gemini') && id.includes('image')) return true
  return false
}

function mapSize(size?: string): string | undefined {
  if (!size) return undefined
  const s = size.toLowerCase()
  // Lovable Gateway 接受 1024x1024 / 1024x1536 / 1536x1024 / auto
  if (s === '2k' || s === '1k') return '1024x1024'
  if (/^\d+\*\d+$/.test(s)) return s.replace('*', 'x')
  if (/^\d+x\d+$/.test(s)) return s
  return undefined
}

export async function callLovableGatewayImage(input: LovableImageInput): Promise<LovableImageResult> {
  const apiKey = process.env.LOVABLE_API_KEY
  if (!apiKey) {
    return { url: '', error: 'LOVABLE_API_KEY not configured', model: input.model }
  }
  const model = input.model.trim()
  if (!model) return { url: '', error: 'model required', model }

  const body: Record<string, unknown> = {
    model,
    prompt: input.prompt,
    // 默认 low 质量以控制成本(参考 Lovable 文档默认值)
    quality: 'low',
  }
  const size = mapSize(input.size)
  if (size) body.size = size

  // 多模态编辑:把参考图作为 `image` 字段下发(OpenAI Images API 兼容形式)
  if (input.referenceImages && input.referenceImages.length > 0) {
    body.image = input.referenceImages.length === 1 ? input.referenceImages[0] : input.referenceImages
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    clearTimeout(timer)

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      const tag = res.status === 429 ? 'rate_limit' : res.status === 402 ? 'no_credits' : `lovable ${res.status}`
      return { url: '', error: `${tag}: ${text.slice(0, 300)}`, model }
    }
    const json: any = await res.json().catch(() => null)
    const first = json?.data?.[0]
    if (!first) return { url: '', error: 'empty response', model }
    if (first.url) return { url: first.url, error: null, model }
    if (first.b64_json) return { url: `data:image/png;base64,${first.b64_json}`, error: null, model }
    return { url: '', error: 'no image in response', model }
  } catch (e) {
    clearTimeout(timer)
    const msg = e instanceof Error ? (e.name === 'AbortError' ? 'timeout' : e.message) : 'unknown'
    return { url: '', error: `lovable error: ${msg}`, model }
  }
}