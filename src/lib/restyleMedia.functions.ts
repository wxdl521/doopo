// ====================================================================
//  转绘大文件直传（v2 与旧版工作台共用）：浏览器 PUT 原始二进制到
//  Supabase Storage 签名上传地址，不经 base64 / 不进内存字符串
//  （212MB 视频 base64 化会撑爆标签页）。
//
//  桶策略已允许用户写自己 userId/ 前缀（create_workspace_media_bucket 迁移），
//  无需新增 storage SQL。读地址必须在上传完成后用 createSignedUrl 签发：
//  上传前签名会因对象不存在报 "Object not found"；getPublicUrl 在桶为私有
//  时会 403 无法播放——签后读对公有/私有桶都正确。
//  帧图/单元音频等小文件仍走 uploadLocalImage。
// ====================================================================

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertContentLengthWithin, assertPublicHttpsUrl } from "./restyle/ssrfGuard";

const BUCKET = "workspace-media";

/** 转存视频的体积上限（Content-Length 预检 + 实际字节数双保险）。 */
const MAX_PERSIST_VIDEO_BYTES = 500 * 1024 * 1024;

const Input = z.object({
  id: z.string().min(1).max(128),
  kind: z.enum(["video", "audio", "image"]),
  ext: z.string().min(1).max(10).regex(/^[a-z0-9]+$/i),
});

export type MediaUploadTarget =
  | { ok: true; uploadUrl: string; path: string }
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

    return { ok: true as const, uploadUrl: upload.signedUrl, path };
  });

const ReadSignInput = z.object({ path: z.string().min(1).max(500) });

/** 上传完成后签发长效读地址（此时对象已存在，签名必然成功；私有桶可播）。 */
export const signMediaReadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => ReadSignInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    // 只能签自己目录下的文件
    if (!data.path.startsWith(`${userId}/`)) {
      return { ok: false as const, error: "只能访问自己的文件。" };
    }
    // 签名 7 天有效（审计加固：不再签 10 年）；过期后需重新调 signMediaReadUrl 签发
    const { data: read, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(data.path, 604_800);
    if (error || !read?.signedUrl) {
      return { ok: false as const, error: `读取地址签名失败: ${error?.message ?? "no url"}` };
    }
    return { ok: true as const, url: read.signedUrl };
  });

const PersistInput = z.object({
  url: z.string().url().max(2_000),
  id: z.string().min(1).max(128),
});

export type PersistVideoResult = { ok: true; url: string } | { ok: false; error: string };

/**
 * 转存模型产出的视频到 workspace-media（分段/成片通用）。
 * 模型 TOS 链接约 24h 过期，必须下载后写入自己的桶换永久 URL；
 * 失败只返回 error，调用方保留原链接并在日志中标注。
 */
export const persistRestyleVideo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => PersistInput.parse(d))
  .handler(async ({ data, context }): Promise<PersistVideoResult> => {
    const { supabase, userId } = context as { supabase: any; userId: string };

    // SSRF 收敛：仅允许 https 公网地址，拒绝内网/环回/保留段。
    try {
      assertPublicHttpsUrl(data.url);
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : "下载地址不合法" };
    }

    let res: Response;
    try {
      res = await fetch(data.url, { signal: AbortSignal.timeout(120_000) });
    } catch (error) {
      return { ok: false as const, error: `下载失败: ${error instanceof Error ? error.message : "网络错误"}` };
    }
    if (!res.ok) return { ok: false as const, error: `下载失败 HTTP ${res.status}` };

    // arrayBuffer 之前先按 Content-Length 拦截超大负载，避免把内存打爆。
    try {
      assertContentLengthWithin(res, MAX_PERSIST_VIDEO_BYTES);
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : "文件超过体积上限" };
    }
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_PERSIST_VIDEO_BYTES) {
      return { ok: false as const, error: "文件超过 500MB 体积上限" };
    }
    const path = `${userId}/uploads/restyle-v2/video/${data.id}-${Date.now()}.mp4`;
    const { error: uploadErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, new Blob([buf], { type: "video/mp4" }), { contentType: "video/mp4" });
    if (uploadErr) return { ok: false as const, error: `转存失败: ${uploadErr.message}` };

    // 签名 7 天有效（审计加固：不再签 10 年）；过期后需重新转存/签发
    const { data: read, error: signErr } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(path, 604_800);
    if (signErr || !read?.signedUrl) return { ok: false as const, error: "读取地址签名失败" };
    return { ok: true as const, url: read.signedUrl };
  });
