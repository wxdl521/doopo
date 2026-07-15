import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isCosConfigured, uploadToCos } from "./cosClient";

const UploadInput = z.object({
  base64: z.string().min(100),
  id: z.string().min(1).max(128),
  kind: z.enum([
    "character",
    "scene",
    "prop",
    "panel",
    "shot",
    "storyboard",
    "video",
    "character-audio",
  ]),
});

export const uploadLocalImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => UploadInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    const { base64, id, kind } = data;

    // 1) 解析 base64 → buffer（支持 image/* / video/* / audio/*）
    const match = base64.match(
      /^data:(image\/[\w.+-]+|video\/[\w.+-]+|audio\/[\w.+-]+);base64,(.+)$/,
    );
    if (!match) return { ok: false as const, error: "invalid base64" };
    const mime = match[1];
    const ext = (mime.split("/")[1] || "bin")
      .replace("jpeg", "jpg")
      .replace("quicktime", "mov")
      .replace("mpeg", "mp3") // audio/mpeg → mp3
      .replace("x-wav", "wav")
      .replace("x-m4a", "m4a");
    const buf = Buffer.from(match[2], "base64");

    const path = `${userId}/uploads/${kind}/${id}-${Date.now()}.${ext}`;
    // 2) 优先上传到腾讯云 COS + CDN
    if (isCosConfigured()) {
      const r = await uploadToCos(path, buf, mime);
      if (r.ok) return { ok: true as const, url: r.url };
      if (!r.fallback) return { ok: false as const, error: `cos upload failed: ${r.error}` };
    }
    // 3) 回落 Supabase Storage
    const { error: uploadErr } = await supabase.storage
      .from("workspace-media")
      .upload(path, buf, { contentType: mime, upsert: false });
    if (uploadErr) return { ok: false as const, error: uploadErr.message };

    const { data: signed } = await supabase.storage
      .from("workspace-media")
      .createSignedUrl(path, 315360000);
    if (!signed?.signedUrl) return { ok: false as const, error: "no signed url" };
    return { ok: true as const, url: signed.signedUrl };
  });

/**
 * 服务端下载图片 → base64 data URL（绕开浏览器跨域限制）
 * 客户端 urlToBase64 失败时的兜底方案。
 */
const ServerUrlToBase64Input = z.object({
  url: z.string().min(1).max(5000000),
});
export const serverUrlToBase64 = createServerFn({ method: "POST" })
  .validator((d: unknown) => ServerUrlToBase64Input.parse(d))
  .handler(async ({ data }) => {
    const { url } = data;
    if (url.startsWith("data:")) return { base64: url, error: null as string | null };
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) return { base64: null as string | null, error: `HTTP ${res.status}` };
      const contentType = res.headers.get("content-type") || "image/png";
      const buf = await res.arrayBuffer();
      const b64 = Buffer.from(buf).toString("base64");
      return { base64: `data:${contentType};base64,${b64}`, error: null as string | null };
    } catch (e: any) {
      return { base64: null as string | null, error: e?.message ?? String(e) };
    }
  });
