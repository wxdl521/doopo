import { createFileRoute } from '@tanstack/react-router'
import { callPixflowChat, callPixflowImage } from '@/lib/pixflow.functions'

export const Route = createFileRoute('/api/public/pixflow-test')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const model = url.searchParams.get('model') || 'pixflow/gemini-2.0-flash'
        const kind = url.searchParams.get('kind') || 'chat'
        const prompt = url.searchParams.get('prompt') || 'reply with the single word: pong'
        const started = Date.now()
        try {
          if (kind === 'native') {
            const model = (url.searchParams.get('model') || 'gemini-2.0-flash').replace(/^pixflow\//, '')
            const key = process.env.PIXFLOW_GEMINI_API_KEY || process.env.PIXFLOW_API_KEY
            const base = (process.env.GOOGLE_GEMINI_BASE_URL || 'https://api.pixflow.im').replace(/\/+$/, '')
            const r = await fetch(`${base}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key || '' },
              body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }] }),
            })
            const text = await r.text()
            return Response.json({ ok: r.ok, status: r.status, body: text.slice(0, 400), ms: Date.now() - started })
          }
          if (kind === 'image') {
            const r = await callPixflowImage({ prompt, model, size: '1024x1024' })
            return Response.json({
              ok: !r.error, model: r.model, error: r.error,
              imageCount: r.urls.length,
              firstUrlPreview: r.url ? r.url.slice(0, 80) : null,
              ms: Date.now() - started,
            })
          }
          const r = await callPixflowChat({ model, messages: [{ role: 'user', content: prompt }], max_tokens: 100 })
          return Response.json({ ok: !r.error, model: r.model, error: r.error, content: r.content, ms: Date.now() - started })
        } catch (e) {
          return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e), ms: Date.now() - started }, { status: 500 })
        }
      },
    },
  },
})