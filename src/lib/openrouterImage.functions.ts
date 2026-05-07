import { createServerFn } from '@tanstack/react-start'

type Input = { prompt: string; model?: string }

// Lovable AI Gateway image models (Nano Banana family)
const FALLBACK_MODELS = [
  'google/gemini-2.5-flash-image',
  'google/gemini-3.1-flash-image-preview',
] as const

const RETRYABLE_STATUSES = new Set([402, 403, 404, 429, 500, 502, 503])

const getModelAttempts = (requested?: string) => {
  const requestedModel = requested?.trim()
  return [...new Set([requestedModel, ...FALLBACK_MODELS].filter(Boolean))] as string[]
}

export const generateImage = createServerFn({ method: 'POST' })
  .inputValidator((input: Input) => {
    if (!input || typeof input.prompt !== 'string' || !input.prompt.trim()) {
      throw new Error('prompt required')
    }
    return input
  })
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY
    if (!apiKey) {
      return { url: '', error: 'LOVABLE_API_KEY is not configured' }
    }

    let lastError = 'Image generation failed'

    for (const model of getModelAttempts(data.model)) {
      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 90_000)
        const res = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
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
          if (res.status === 401) return { url: '', error: 'AI Gateway authentication failed (401)' }
          lastError = `AI Gateway error ${res.status}: ${text.slice(0, 200)}`
          if (RETRYABLE_STATUSES.has(res.status)) continue
          return { url: '', error: lastError }
        }

        const json = await res.json()
        const msg = json?.choices?.[0]?.message
        const url: string =
          msg?.images?.[0]?.image_url?.url ||
          msg?.images?.[0]?.url ||
          ''
        if (url) return { url, error: null as string | null }
        lastError = 'Model returned no image'
      } catch (e) {
        lastError = e instanceof Error && e.name === 'AbortError'
          ? 'Image request timed out'
          : e instanceof Error ? e.message : 'Network error'
      }
    }

    return { url: '', error: lastError }
  })