import { createServerFn } from '@tanstack/react-start'

type Input = { prompt: string; model?: string }

// Preferred order — tried first if present in the live model list.
const PREFERRED_ORDER = [
  'google/gemini-3.1-flash-image-preview',
  'google/gemini-2.5-flash-image',
  'google/gemini-3-pro-image-preview',
]

// Models known to frequently reject normal creative prompts via TOS — skip them.
const BLOCKED_MODELS = new Set<string>([
  'openai/gpt-5-image',
  'openai/gpt-5-image-mini',
  'openai/gpt-5.4-image-2',
])

const RETRYABLE_STATUSES = new Set([403, 404, 429, 502, 503])

let cachedModels: { ids: string[]; ts: number } | null = null
const MODEL_CACHE_MS = 10 * 60 * 1000

async function fetchImageModels(apiKey: string): Promise<string[]> {
  if (cachedModels && Date.now() - cachedModels.ts < MODEL_CACHE_MS) return cachedModels.ids
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (!res.ok) return []
    const json: any = await res.json()
    const ids: string[] = (json?.data ?? [])
      .filter((m: any) => {
        const out = m?.architecture?.output_modalities ?? []
        return Array.isArray(out) && out.includes('image')
      })
      .map((m: any) => m.id)
      .filter((id: string) => id && !id.startsWith('openrouter/'))
    cachedModels = { ids, ts: Date.now() }
    return ids
  } catch {
    return []
  }
}

function buildAttempts(requested: string | undefined, available: string[]): string[] {
  const set = new Set<string>()
  if (requested?.trim()) set.add(requested.trim())
  for (const id of PREFERRED_ORDER) if (available.includes(id)) set.add(id)
  for (const id of available) set.add(id)
  if (set.size === 0) PREFERRED_ORDER.forEach(id => set.add(id))
  return [...set].filter(id => !BLOCKED_MODELS.has(id))
}

export const generateImage = createServerFn({ method: 'POST' })
  .inputValidator((input: Input) => {
    if (!input || typeof input.prompt !== 'string' || !input.prompt.trim()) {
      throw new Error('prompt required')
    }
    return input
  })
  .handler(async ({ data }) => {
    const apiKey = process.env.OPENROUTER_API_KEY
    if (!apiKey) {
      return { url: '', error: 'OPENROUTER_API_KEY is not configured', model: '' }
    }

    const available = await fetchImageModels(apiKey)
    const attempts = buildAttempts(data.model, available)
    let lastError = 'Image generation failed'

    for (const model of attempts) {
      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 55_000)
        const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://doopoo.app',
            'X-Title': 'Doopoo',
          },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: data.prompt }],
            modalities: ['image', 'text'],
          }),
          signal: controller.signal,
        })
        clearTimeout(timeout)

        if (!res.ok) {
          const text = await res.text().catch(() => '')
          if (res.status === 401) return { url: '', error: 'OpenRouter authentication failed (401)', model }
          lastError = `[${model}] ${res.status}: ${text.slice(0, 180)}`
          if (RETRYABLE_STATUSES.has(res.status)) continue
          return { url: '', error: lastError, model }
        }

        const json: any = await res.json()
        const msg = json?.choices?.[0]?.message
        const url: string =
          msg?.images?.[0]?.image_url?.url ||
          msg?.images?.[0]?.url ||
          ''
        if (url) return { url, error: null as string | null, model }
        lastError = `[${model}] returned no image`
      } catch (e) {
        lastError = e instanceof Error && e.name === 'AbortError'
          ? `[${model}] timed out`
          : `[${model}] ${e instanceof Error ? e.message : 'network error'}`
      }
    }

    return { url: '', error: lastError, model: '' }
  })
