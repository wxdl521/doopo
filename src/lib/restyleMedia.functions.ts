// ====================================================================
//  转绘大文件直传（v2 与旧版工作台共用）：浏览器 PUT 原始二进制到
//  Supabase Storage 签名上传地址，不经 base64 / 不进内存字符串
//  （212MB 视频 base64 化会撑爆标签页）。
//
//  桶策略已允许用户写自己 userId/ 前缀（create_workspace_media_bucket 迁移），
//  无需新增 storage SQL；桶为 public（20260711 迁移），读地址用 getPublicUrl。
//  帧图/单元音频等小文件仍走 uploadLocalImage。
// ====================================================================

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const BUCKET = "workspace-media";

const Input = z.object({
  id: z.string().min(1).max(128),
  kind: z.enum(["video", "audio", "image"]),
  ext: z.string().min(1).max(10).regex(/^[a-z0-9]+$/i),
});

export type MediaUploadTarget =
  | { ok: true; uploadUrl: string; readUrl: string; path: string }
  | { ok: false; error: string };

export const createMediaUploadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => Input.parse(d))
  .handler(async ({ data, context }): Promise<MediaUploadTarget> => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    const path = `${userId}/uploads/restyle-v2/${data.kind}/${data.id}-${Date.now()}.${data.ext}`;

    const { data: upload, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUploadUrl(path);
    if (error || !upload?.signedUrl) {
      return { ok: false as const, error: `签名上传地址生成失败: ${error?.message ?? "no url"}` };
    }

    // workspace-media 是 public 桶（20260711 迁移，供 Seedance 公网拉取），
    // 读地址用 getPublicUrl 纯拼字符串——对象上传前也合法；
    // 不能再 createSignedUrl，对象尚不存在时会报 "Object not found"。
    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
    if (!pub?.publicUrl) {
      return { ok: false as const, error: "读取地址生成失败" };
    }
    return { ok: true as const, uploadUrl: upload.signedUrl, readUrl: pub.publicUrl, path };
  });
