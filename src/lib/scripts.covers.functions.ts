import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware'
import { generateImage } from './openrouterImage.functions'

/**
 * Server-side: generate a script cover with the configured image model,
 * download the resulting bytes, upload them to the user's own folder in
 * the `script-covers` Supabase Storage bucket, and return the public URL.
 *
 * The client never sees the time-limited upstream URL — only the permanent
 * Supabase Storage URL, which we then store in scripts.payload.coverUrl.
 */
export const uploadScriptCover = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        scriptId: z.string().min(1).max(128),
        prompt: z.string().min(1).max(2000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string }
    const { scriptId, prompt } = data

    // 1) Generate the image. We use the existing generateImage server fn
    //    rather than calling Qwen directly, so model selection / fallbacks
    //    stay in one place.
    const generated = await generateImage({ data: { prompt, size: '1328*1328' } })
    const sourceUrl = generated?.url
    if (!sourceUrl) {
      return { url: '', error: generated?.error || 'image generation failed' }
    }

    // 2) Download the bytes. The upstream URL is time-limited so we must
    //    re-host the file immediately.
    let bytes: ArrayBuffer
    try {
      const resp = await fetch(sourceUrl)
      if (!resp.ok) throw new Error(`upstream fetch ${resp.status}`)
      bytes = await resp.arrayBuffer()
    } catch (e: any) {
      return { url: '', error: `failed to download generated image: ${e?.message ?? e}` }
    }

    // 3) Upload to the user's own folder. Path: {userId}/{scriptId}.jpg
    //    jpg is fine because Qwen always returns JPEG output.
    const path = `${userId}/${scriptId}.jpg`
    const blob = new Blob([bytes], { type: 'image/jpeg' })
    const { error: uploadErr } = await supabase.storage
      .from('script-covers')
      .upload(path, blob, { contentType: 'image/jpeg', upsert: true })
    if (uploadErr) {
      return { url: '', error: `storage upload failed: ${uploadErr.message}` }
    }

    // 4) Return the public URL.
    const { data: pub } = supabase.storage.from('script-covers').getPublicUrl(path)
    return { url: pub.publicUrl, model: generated.model }
  })
