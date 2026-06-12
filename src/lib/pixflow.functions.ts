// ====================================================================
//  Pixflow AI Gateway —— OpenAI 兼容协议
//
//  Base URL: https://api.pixflow.im (env: GOOGLE_GEMINI_BASE_URL 可覆盖)
//  Auth:     Authorization: Bearer ${PIXFLOW_API_KEY}
//
//  覆盖两类调用:
//    1) callPixflowImage   POST /v1/images/generations
//       支持: gpt-image-2, gpt-image-1-mini,
//             google/gemini-2.5-flash-image, google/gemini-3-pro-image-preview,
//             google/gemini-3.1-flash-image-preview 等
//    2) callPixflowChat    POST /v1/chat/completions
//       支持: google/gemini-2.5-pro, google/gemini-2.5-flash,
//             google/gemini-3-flash-preview, google/gemini-3.1-pro-preview ...
//
//  模型 id 约定:在项目里所有 Pixflow 走的模型,UI 选项都加前缀 `pixflow/`
//  以避免和现有 Seedream/Qwen/OpenRouter 路由冲突。本模块在调用时会
//  自动剥离这个前缀再发给 Pixflow。
// ====================================================================

import './loadEnv'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

const DEFAULT_BASE_URL = 'https://api.pixflow.im'
const REQUEST_TIMEOUT_MS = 120_000
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

// ---------- Image generation ----------

type PixflowImageInput = {
  prompt: string
  model: string
  size?: string
  n?: number
}

type PixflowImageResult = {
  url: string
  urls: string[]
  error: string | null
  model: string
}

/**
 * Pixflow 图像生成。返回与 Seedream/Qwen 一致的 { url, error, model } 形态。
 *
 * Gemini 系列图像模型在 OpenAI 兼容代理下,Pixflow 文档给出两种 body 形态:
 *   A) {model, prompt, n, size}                 —— 与 OpenAI images 完全一致
 *   B) {model, messages, modalities:["image"]}  —— OpenRouter chat-completions 风格
 *
 * 实测 api.pixflow.im 对所有图像模型都接受 A 形态,我们就只发 A,简化代码。
 * 如果某个模型只吃 B,Pixflow 会返回 400,前端会把错误信息透传出来。
 */
export async function callPixflowImage(input: PixflowImageInput): Promise<PixflowImageResult> {
  const { apiKey, baseUrl } = getPixflowConfig()
  const model = stripPixflowPrefix(input.model)
  if (!apiKey) {
    return { url: '', urls: [], error: 'PIXFLOW_API_KEY not configured', model }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(`${baseUrl}/v1/images/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        prompt: input.prompt,
        n: input.n ?? 1,
        size: input.size || '1024x1024',
      }),
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { url: '', urls: [], error: `[pixflow ${model}] ${res.status}: ${text.slice(0, 300)}`, model }
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
      return {
        url: '',
        urls: [],
        error: `[pixflow ${model}] no image returned: ${json.error?.message || 'empty data'}`,
        model,
      }
    }
    return { url: urls[0], urls, error: null, model }
  } catch (e) {
    clearTimeout(timeout)
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
}

export async function callPixflowChat(input: PixflowChatInput) {
  const { apiKey, baseUrl } = getPixflowConfig()
  const model = stripPixflowPrefix(input.model)
  if (!apiKey) {
    return { content: '', error: 'PIXFLOW_API_KEY not configured', model }
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: input.messages,
        max_tokens: input.max_tokens ?? 2000,
        temperature: input.temperature ?? 0.7,
      }),
      signal: controller.signal,
    })
    clearTimeout(timeout)
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { content: '', error: `[pixflow ${model}] ${res.status}: ${text.slice(0, 300)}`, model }
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
      error?: { message?: string }
    }
    const content = json.choices?.[0]?.message?.content || ''
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
})

export const chatPixflow = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => PixflowChatFnInput.parse(d))
  .handler(async ({ data }) => {
    return callPixflowChat(data)
  })
