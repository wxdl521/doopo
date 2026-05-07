import { createServerFn } from '@tanstack/react-start'

type Message = { role: 'system' | 'user' | 'assistant'; content: string }

type Input = {
  messages: Message[]
  model?: string
  max_tokens?: number
  temperature?: number
}

export const generateScript = createServerFn({ method: 'POST' })
  .inputValidator((input: Input) => {
    if (!input || !Array.isArray(input.messages) || input.messages.length === 0) {
      throw new Error('messages required')
    }
    return input
  })
  .handler(async ({ data }) => {
    const apiKey = process.env.OPENROUTER_API_KEY
    if (!apiKey) {
      return { content: '', error: 'OPENROUTER_API_KEY is not configured' }
    }

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
          model: data.model ?? 'deepseek/deepseek-chat-v3.1',
          messages: data.messages,
          max_tokens: data.max_tokens ?? 2000,
          temperature: data.temperature ?? 0.85,
        }),
        signal: controller.signal,
      })
      clearTimeout(timeout)

      if (!res.ok) {
        const text = await res.text().catch(() => '')
        if (res.status === 401) return { content: '', error: 'OpenRouter authentication failed (401)' }
        if (res.status === 404) return { content: '', error: `Model not available (404). Please pick another model.` }
        if (res.status === 403) return { content: '', error: 'This model rejected the request (403). Please try a different model.' }
        if (res.status === 429) return { content: '', error: 'Rate limit exceeded, please try again later (429)' }
        return { content: '', error: `OpenRouter error ${res.status}: ${text.slice(0, 200)}` }
      }

      const json = await res.json()
      const content = json?.choices?.[0]?.message?.content ?? ''
      return { content, error: null as string | null }
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        return { content: '', error: 'Request timed out. Try a faster model or shorter prompt.' }
      }
      return { content: '', error: e instanceof Error ? e.message : 'Network error' }
    }
  })