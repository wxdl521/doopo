import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware'
import { generateImage } from './seedream.functions'

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
    // 2026/06 修复:整个 handler 用 try/catch 包住,任何抛出都转成
    // { url:'', error } 返回。否则 h3 会把异常吃掉,把响应改写成
    // {"unhandled":true,"message":"HTTPError"},前端只能拿到一个无意义
    // 的 HTML 错误页,根本看不到真实原因。
    try {
      const { supabase, userId } = context as { supabase: any; userId: string }
      const { scriptId, prompt } = data

      // 1) 生成图片。复用 generateImage server fn,模型路由 / 兜底统一在那里。
      //    历史坑:老代码传 '1328*1328'(Qwen 尺寸)给 Seedream,被拒
      //    "size must be one of 'WIDTHxHEIGHT', '2k', '3k', or '4k'"。
      //    改用 '2K'(自动满足 3.68MP 像素下限,适合封面)。
      const generated = await generateImage({ data: { prompt, size: '2K' } })
      const sourceUrl = generated?.url
      if (!sourceUrl) {
        return { url: '', error: generated?.error || 'image generation failed' }
      }

      // 2) 下载字节(上游 URL 有时效)。
      let bytes: ArrayBuffer
      try {
        const resp = await fetch(sourceUrl)
        if (!resp.ok) throw new Error(`upstream fetch ${resp.status}`)
        bytes = await resp.arrayBuffer()
      } catch (e: any) {
        return { url: '', error: `failed to download generated image: ${e?.message ?? e}` }
      }

      // 3) 上传到 {userId}/{scriptId}.jpg
      const path = `${userId}/${scriptId}.jpg`
      const blob = new Blob([bytes], { type: 'image/jpeg' })
      const { error: uploadErr } = await supabase.storage
        .from('script-covers')
        .upload(path, blob, { contentType: 'image/jpeg', upsert: true })
      if (uploadErr) {
        return { url: '', error: `storage upload failed: ${uploadErr.message}` }
      }

      // 4) 取 public URL。
      const { data: pub } = supabase.storage.from('script-covers').getPublicUrl(path)
      return { url: pub?.publicUrl || '', model: generated.model }
    } catch (e: any) {
      console.error('[uploadScriptCover] unhandled:', e)
      return { url: '', error: `unhandled: ${e?.message ?? String(e)}` }
    }
  })
