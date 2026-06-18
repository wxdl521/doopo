import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware'

const UploadInput = z.object({
  base64: z.string().min(100),
  id: z.string().min(1).max(128),
  kind: z.enum(['character', 'scene', 'prop']),
})

export const uploadLocalImage = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => UploadInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string }
    const { base64, id, kind } = data

    // 1) 解析 base64 → buffer
    const match = base64.match(/^data:(image\/\w+);base64,(.+)$/)
    if (!match) return { ok: false as const, error: 'invalid base64' }
    const mime = match[1]
    const ext = (mime.split('/')[1] || 'png').replace('jpeg', 'jpg')
    const buf = Buffer.from(match[2], 'base64')

    // 2) 上传到 workspace-media bucket
    const path = `${userId}/uploads/${kind}/${id}-${Date.now()}.${ext}`
    const { error: uploadErr } = await supabase.storage
      .from('workspace-media')
      .upload(path, buf, { contentType: mime, upsert: false })
    if (uploadErr) return { ok: false as const, error: uploadErr.message }

    // 3) 取 public URL
    const { data: pub } = supabase.storage.from('workspace-media').getPublicUrl(path)
    if (!pub?.publicUrl) return { ok: false as const, error: 'no public url' }
    return { ok: true as const, url: pub.publicUrl }
  })

/**
 * 服务端下载图片 → base64 data URL（绕开浏览器跨域限制）
 * 客户端 urlToBase64 失败时的兜底方案。
 */
const ServerUrlToBase64Input = z.object({
  url: z.string().min(1).max(5000000),
})
export const serverUrlToBase64 = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => ServerUrlToBase64Input.parse(d))
  .handler(async ({ data }) => {
    const { url } = data
    if (url.startsWith('data:')) return { base64: url, error: null as string | null }
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
      if (!res.ok) return { base64: null as string | null, error: `HTTP ${res.status}` }
      const contentType = res.headers.get('content-type') || 'image/png'
      const buf = await res.arrayBuffer()
      const b64 = Buffer.from(buf).toString('base64')
      return { base64: `data:${contentType};base64,${b64}`, error: null as string | null }
    } catch (e: any) {
      return { base64: null as string | null, error: e?.message ?? String(e) }
    }
  })
