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