// ====================================================================
//  Revora AI Gateway —— 纯 OpenAI 兼容(api: revora.vip)
//
//  Base URL: https://revora.vip (env: REVORA_BASE_URL 可覆盖)
//  Auth:     Authorization: Bearer ${REVORA_API_KEY}
//
//  本模块只负责 Revora 中转上的 OpenAI 兼容图像接口:
//    - 无参考图(T2I): POST /v1/images/generations
//    - 有参考图(I2I): POST /v1/images/edits  (multipart/form-data)
//
//  当前已验证可用模型:
//    - gpt-image-2
//
//  UI 选项约定:所有走 Revora 的模型 id 都加 `revora/` 前缀,
//  与 pixflow/ / tokenflash/ 等命名空间互不冲突;在调用时本模块
//  会自动剥离前缀再发给上游。
// ====================================================================

import './loadEnv'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

const DEFAULT_BASE_URL = 'https://revora.vip'
const IMAGE_REQUEST_TIMEOUT_MS = 400_000
const REVORA_PREFIX = 'revora/'

export function isRevoraModel(modelId: string | null | undefined): boolean {
  return !!modelId && modelId.toLowerCase().startsWith(REVORA_PREFIX)
}

/** 剥离 `revora/` 前缀,得到真正的 upstream model id */
export function stripRevoraPrefix(modelId: string): string {
  return modelId.replace(/^revora\//i, '')
}

function getRevoraConfig() {
  return {
    apiKey: process.env.REVORA_API_KEY,
    baseUrl: (process.env.REVORA_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ''),
  }
}

type RevoraImageInput = {
  prompt: string
  model: string
  size?: string
  n?: number
  quality?: 'auto' | 'low' | 'high'
  /** I2I 参考图 URL 列表(走 /v1/images/edits) */
  referenceImages?: string[]
}

type RevoraImageResult = {
  url: string
  urls: string[]
  error: string | null
  model: string
}

/** Revora gpt-image-2 支持的尺寸白名单 */
const REVORA_GPT_IMAGE2_SIZES = new Set([
  '1024x1024', '1024x1792', '1792x1024',
])

/** 把任意 size 字符串(WxH / 2K / 1328*1328)折算成 Revora 接受的尺寸 */
function normalizeRevoraSize(size: string | undefined, model: string): string {
  const s = (size || '').trim().toLowerCase().replace(/\*/g, 'x')
  if (/^gpt-image-2$/i.test(model)) {
    if (REVORA_GPT_IMAGE2_SIZES.has(s)) return s
    // 按宽高比就近 fallback
    const m = s.match(/^(\d+)x(\d+)$/)
    if (m) {
      const w = parseInt(m[1], 10), h = parseInt(m[2], 10)
      if (w > h * 1.3) return '1792x1024'
      if (h > w * 1.3) return '1024x1792'
      return '1024x1024'
    }
    return '1024x1024'
  }
  return s || '1024x1024'
}

/**
 * Revora 图像生成 —— OpenAI 兼容路由。
 * 返回与 Pixflow / Tokenflash 一致的 { url, urls, error, model }。
 */
export async function callRevoraImage(input: RevoraImageInput): Promise<RevoraImageResult> {
  const { apiKey, baseUrl } = getRevoraConfig()
  const model = stripRevoraPrefix(input.model)
  const hasRefs = !!input.referenceImages?.length
  const endpoint = hasRefs ? '/v1/images/edits' : '/v1/images/generations'
  const size = normalizeRevoraSize(input.size, model)
  const t0 = Date.now()
  console.log(`[revora→] model=${model} endpoint=${endpoint} refs=${input.referenceImages?.length ?? 0} size=${size} quality=${input.quality ?? 'auto'}`)

  if (!apiKey) {
    console.warn(`[revora×] model=${model} missing REVORA_API_KEY`)
    return { url: '', urls: [], error: 'REVORA_API_KEY not configured', model }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), IMAGE_REQUEST_TIMEOUT_MS)
  try {
    // T2I 用 JSON; I2I 走 OpenAI 标准的 multipart/form-data
    let requestInit: RequestInit
    if (hasRefs) {
      const form = new FormData()
      form.append('model', model)
      form.append('prompt', input.prompt)
      form.append('n', String(input.n ?? 1))
      form.append('size', size)
      form.append('quality', input.quality ?? 'auto')
      form.append('response_format', 'url')
      // 下载每张参考图为 Blob 后以 image[] 文件字段上传
      for (let i = 0; i < input.referenceImages!.length; i++) {
        const refUrl = input.referenceImages![i]
        let blob: Blob
        let filename = `ref_${i}.png`
        let mime = 'image/png'
        if (refUrl.startsWith('data:')) {
          const m = refUrl.match(/^data:([^;]+);base64,(.+)$/)
          if (!m) throw new Error(`invalid data url for ref ${i}`)
          mime = m[1] || 'image/png'
          const bin = Buffer.from(m[2], 'base64')
          blob = new Blob([bin], { type: mime })
        } else {
          const r = await fetch(refUrl)
          if (!r.ok) throw new Error(`fetch ref ${i} failed: ${r.status}`)
          mime = r.headers.get('content-type') || 'image/png'
          blob = await r.blob()
        }
        const ext = mime.includes('jpeg') ? 'jpg' : mime.includes('webp') ? 'webp' : 'png'
        filename = `ref_${i}.${ext}`
        form.append('image[]', blob, filename)
      }
      requestInit = {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: controller.signal,
      }
    } else {
      const body: Record<string, unknown> = {
        model,
        prompt: input.prompt,
        n: input.n ?? 1,
        size,
        quality: input.quality ?? 'auto',
      }
      // gpt-image-* 系列只返回 b64_json,不支持 response_format=url
      if (!/^gpt-image/i.test(model)) {
        body.response_format = 'url'
      }
      requestInit = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      }
    }

    // 对 502/503/504/524 这种上游瞬时错误做一次重试(1.5s 退避)
    let res: Response | null = null
    let lastText = ''
    for (let attempt = 0; attempt < 2; attempt++) {
      res = await fetch(`${baseUrl}${endpoint}`, requestInit)
      if (res.ok) break
      lastText = await res.text().catch(() => '')
      const transient = res.status === 502 || res.status === 503 || res.status === 504 || res.status === 524
      if (!transient || attempt === 1) break
      console.warn(`[revora⟳] model=${model} endpoint=${endpoint} status=${res.status} retry in 1.5s`)
      await new Promise((r) => setTimeout(r, 1500))
    }
    clearTimeout(timeout)

    if (!res || !res.ok) {
      const status = res?.status ?? 0
      console.warn(`[revora×] model=${model} endpoint=${endpoint} status=${status} dur=${Date.now() - t0}ms body=${lastText.slice(0, 200)}`)
      return { url: '', urls: [], error: `[revora ${model}] ${status}: ${lastText.slice(0, 300)}`, model }
    }

    const rawText = await res.text()
    let json: any = {}
    try { json = JSON.parse(rawText) } catch {}

    // 兼容多种返回形状:
    //   1) OpenAI 标准: { data: [{ url | b64_json }] }
    //   2) 包装格式: { data: { data: [...] } } 或 { result: {...} }
    //   3) 直接 { url } / { image_url } / { images: [...] }
    const items: Array<{ url?: string; b64_json?: string; image_url?: string; b64?: string }> =
      (Array.isArray(json?.data) && json.data) ||
      (Array.isArray(json?.data?.data) && json.data.data) ||
      (Array.isArray(json?.images) && json.images) ||
      (Array.isArray(json?.result?.data) && json.result.data) ||
      (json?.url || json?.image_url || json?.b64_json
        ? [{ url: json.url, image_url: json.image_url, b64_json: json.b64_json }]
        : [])
    const urls = items
      .map((d) => {
        if (d.url) return d.url
        if (d.image_url) return d.image_url
        const b64 = d.b64_json || d.b64
        if (b64) return `data:image/png;base64,${b64}`
        return ''
      })
      .filter(Boolean)

    if (urls.length === 0) {
      console.warn(`[revora×] model=${model} endpoint=${endpoint} empty-data dur=${Date.now() - t0}ms err=${json?.error?.message ?? ''} raw=${rawText.slice(0, 400)}`)
      return {
        url: '',
        urls: [],
        error: `[revora ${model}] no image returned: ${json?.error?.message || rawText.slice(0, 200) || 'empty data'}`,
        model,
      }
    }
    console.log(`[revora✓] model=${model} endpoint=${endpoint} images=${urls.length} dur=${Date.now() - t0}ms`)
    return { url: urls[0], urls, error: null, model }
  } catch (e) {
    clearTimeout(timeout)
    console.warn(`[revora×] model=${model} endpoint=${endpoint} network dur=${Date.now() - t0}ms err=${e instanceof Error ? e.message : 'fetch failed'}`)
    return {
      url: '',
      urls: [],
      error: `[revora ${model}] network: ${e instanceof Error ? e.message : 'fetch failed'}`,
      model,
    }
  }
}

// ---------- ServerFn 入口(供前端通过 useServerFn 调用)----------

const RevoraImageFnInput = z.object({
  prompt: z.string().min(1).max(8000),
  model: z.string().min(1).max(200),
  size: z.string().max(50).optional(),
  n: z.number().int().min(1).max(4).optional(),
  quality: z.enum(['auto', 'low', 'high']).optional(),
  referenceImages: z.array(z.string().url()).max(8).optional(),
})

export const generateRevoraImage = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => RevoraImageFnInput.parse(d))
  .handler(async ({ data }) => {
    return callRevoraImage(data)
  })
