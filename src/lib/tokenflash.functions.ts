// ====================================================================
//  Tokenflash AI Gateway —— 纯 OpenAI 兼容(api: tokenflash.cn)
//
//  Base URL: https://tokenflash.cn (env: TOKENFLASH_BASE_URL 可覆盖)
//  Auth:     Authorization: Bearer ${TOKENFLASH_API_KEY}
//
//  本模块只负责 Tokenflash 中转上的 OpenAI 兼容图像接口:
//    - 无参考图(T2I): POST /v1/images/generations
//    - 有参考图(I2I): POST /v1/images/edits  (JSON, images[].image_url)
//
//  当前已验证可用模型:
//    - gpt-image-2   (T2I 单次 ≈ 45-55s,稳定性显著优于 pixflow)
//
//  UI 选项约定:所有走 Tokenflash 的模型 id 都加 `tokenflash/` 前缀,
//  与 pixflow/ / openai/ / google/ 等命名空间互不冲突;在调用时本模块
//  会自动剥离前缀再发给上游。
// ====================================================================

import './loadEnv'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

const DEFAULT_BASE_URL = 'https://tokenflash.cn'
const IMAGE_REQUEST_TIMEOUT_MS = 400_000
const TOKENFLASH_PREFIX = 'tokenflash/'

export function isTokenflashModel(modelId: string | null | undefined): boolean {
  return !!modelId && modelId.toLowerCase().startsWith(TOKENFLASH_PREFIX)
}

/** 剥离 `tokenflash/` 前缀,得到真正的 upstream model id */
export function stripTokenflashPrefix(modelId: string): string {
  return modelId.replace(/^tokenflash\//i, '')
}

function getTokenflashConfig() {
  return {
    apiKey: process.env.TOKENFLASH_API_KEY,
    baseUrl: (process.env.TOKENFLASH_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ''),
  }
}

type TokenflashImageInput = {
  prompt: string
  model: string
  size?: string
  n?: number
  quality?: 'auto' | 'low' | 'high'
  /** I2I 参考图 URL 列表(走 /v1/images/edits) */
  referenceImages?: string[]
}

type TokenflashImageResult = {
  url: string
  urls: string[]
  error: string | null
  model: string
}

/** Tokenflash 当前 gpt-image-2 支持的尺寸白名单 */
const TOKENFLASH_GPT_IMAGE2_SIZES = new Set([
  '1024x1024', '1024x1792', '1792x1024',
])

/** 把任意 size 字符串(WxH / 2K / 1328*1328)折算成 Tokenflash 接受的尺寸 */
function normalizeTokenflashSize(size: string | undefined, model: string): string {
  const s = (size || '').trim().toLowerCase().replace(/\*/g, 'x')
  if (/^gpt-image-2$/i.test(model)) {
    if (TOKENFLASH_GPT_IMAGE2_SIZES.has(s)) return s
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
 * Tokenflash 图像生成 —— OpenAI 兼容路由。
 * 返回与 Pixflow / Seedream 一致的 { url, urls, error, model }。
 */
export async function callTokenflashImage(input: TokenflashImageInput): Promise<TokenflashImageResult> {
  const { apiKey, baseUrl } = getTokenflashConfig()
  const model = stripTokenflashPrefix(input.model)
  const hasRefs = !!input.referenceImages?.length
  const endpoint = hasRefs ? '/v1/images/edits' : '/v1/images/generations'
  const size = normalizeTokenflashSize(input.size, model)
  const t0 = Date.now()
  console.log(`[tokenflash→] model=${model} endpoint=${endpoint} refs=${input.referenceImages?.length ?? 0} size=${size} quality=${input.quality ?? 'auto'}`)

  if (!apiKey) {
    console.warn(`[tokenflash×] model=${model} missing TOKENFLASH_API_KEY`)
    return { url: '', urls: [], error: 'TOKENFLASH_API_KEY not configured', model }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), IMAGE_REQUEST_TIMEOUT_MS)
  try {
    const body: Record<string, unknown> = {
      model,
      prompt: input.prompt,
      n: input.n ?? 1,
      size,
      quality: input.quality ?? 'auto',
      // 实测 tokenflash 默认返回 b64_json,显式请求 url 也兼容
      response_format: 'url',
    }
    if (hasRefs) {
      body.images = input.referenceImages!.map((image_url) => ({ image_url }))
    }

    // 对 502/503/504/524 这种上游瞬时错误做一次重试(1.5s 退避)
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
      console.warn(`[tokenflash⟳] model=${model} endpoint=${endpoint} status=${res.status} retry in 1.5s`)
      await new Promise((r) => setTimeout(r, 1500))
    }
    clearTimeout(timeout)

    if (!res || !res.ok) {
      const status = res?.status ?? 0
      console.warn(`[tokenflash×] model=${model} endpoint=${endpoint} status=${status} dur=${Date.now() - t0}ms body=${lastText.slice(0, 200)}`)
      return { url: '', urls: [], error: `[tokenflash ${model}] ${status}: ${lastText.slice(0, 300)}`, model }
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
      console.warn(`[tokenflash×] model=${model} endpoint=${endpoint} empty-data dur=${Date.now() - t0}ms err=${json.error?.message ?? ''}`)
      return {
        url: '',
        urls: [],
        error: `[tokenflash ${model}] no image returned: ${json.error?.message || 'empty data'}`,
        model,
      }
    }
    console.log(`[tokenflash✓] model=${model} endpoint=${endpoint} images=${urls.length} dur=${Date.now() - t0}ms`)
    return { url: urls[0], urls, error: null, model }
  } catch (e) {
    clearTimeout(timeout)
    console.warn(`[tokenflash×] model=${model} endpoint=${endpoint} network dur=${Date.now() - t0}ms err=${e instanceof Error ? e.message : 'fetch failed'}`)
    return {
      url: '',
      urls: [],
      error: `[tokenflash ${model}] network: ${e instanceof Error ? e.message : 'fetch failed'}`,
      model,
    }
  }
}

// ---------- ServerFn 入口(供前端通过 useServerFn 调用)----------

const TokenflashImageFnInput = z.object({
  prompt: z.string().min(1).max(8000),
  model: z.string().min(1).max(200),
  size: z.string().max(50).optional(),
  n: z.number().int().min(1).max(4).optional(),
  quality: z.enum(['auto', 'low', 'high']).optional(),
  referenceImages: z.array(z.string().url()).max(8).optional(),
})

export const generateTokenflashImage = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => TokenflashImageFnInput.parse(d))
  .handler(async ({ data }) => {
    return callTokenflashImage(data)
  })
