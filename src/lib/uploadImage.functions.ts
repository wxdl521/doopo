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
