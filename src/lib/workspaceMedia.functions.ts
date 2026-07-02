// ====================================================================
//  Workspace media persistence —— 把分镜视频 / 故事板图从三方 URL
//  (ARK / DashScope / Seedream,24h 过期)下载下来,上传到用户自己的
//  Supabase Storage `workspace-media` bucket,返回永久 URL。
//
//  触发方式:
//    1. 用户在 workspace 左上角点「保存」时,客户端先调 persistWorkspaceMedia
//       把所有 ephemeral URL 入库,再把替换后的 URL 写回 workspace_data。
//    2. 2026/06 自动入库:每个 groupStoryboards[gid] 状态变成 succeeded 时,
//       useEffect 自动调 saveOneStoryboard —— 不依赖用户点「保存」,
//       避免 Seedream TOS URL 24h 过期后用户回来看故事板发现图 broken。
//
//  路径约定:
//    {userId}/{workspaceId}/videos/{groupId}.{ext}        视频
//    {userId}/{workspaceId}/storyboards/{groupId}.{ext}   故事板图
//
//  复用 `script-covers` 的 bucket 模式:public bucket + RLS 锁 userId/。
//
//  已入库检测:URL host 已经是 supabase.co / supabase.in / 用户自己的
//  自定义 Storage 域名 → 跳过,避免重复下载上传。
// ====================================================================

import "./loadEnv";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * 2026/06:saveOneStoryboard —— 单条故事板图入库(自动入库链路)。
 *
 *   跟 persistWorkspaceMedia 的 processMap("storyboard") 等价,但只处理一条。
 *   客户端 useEffect 监听 groupStoryboards 变化 → 每个新 succeeded 项自动
 *   调这个 → 不依赖用户点「保存」也能避免 24h 后图片 broken。
 *
 *   路径:{userId}/{workspaceId}/storyboards/{groupId}.{ext}
 *
 *   行为:
 *     - 已入库(URL 已在 supabase.co / 自己的 storage 域名)→ 跳过,返回原 URL
 *     - 三方 URL → 服务端 fetch → 上传 Supabase Storage → 返回永久 URL
 *     - fetch 失败(TOS 过期 / 网络断)→ 返回 ok:false,客户端决定是否 toast
 *     - 空 url 或 status !== 'succeeded' → noop 返回 ok:true url:''
 */
const SaveOneStoryboardInput = z.object({
  workspaceId: z.string().min(1).max(64),
  groupId: z.string().min(1).max(64),
  url: z.string().min(1).max(5000000),
});

export type SaveOneStoryboardResult = {
  ok: boolean;
  url: string; // 替换后的永久 URL(或原 URL,如果已入库 / noop)
  persisted: boolean; // true = 这次真做了下载 + 上传;false = 跳过 / noop
  error?: string;
};

export const saveOneStoryboard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SaveOneStoryboardInput.parse(input))
  .handler(async ({ data, context }): Promise<SaveOneStoryboardResult> => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    const { workspaceId, groupId, url } = data;

    if (!url) {
      return { ok: true, url: "", persisted: false };
    }
    // 已入库(浏览器走的 supabase 域名)→ 跳过,直接返回原 URL
    if (isAlreadyPersisted(url)) {
      return { ok: true, url, persisted: false };
    }

    try {
      const { buf, contentType } = await fetchMedia(url);
      const path = makePath(userId, workspaceId, "storyboard", groupId, contentType);
      const mime = MIME_BY_KIND.storyboard;
      const blob = new Blob([buf], { type: mime });
      const { error: uploadErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, blob, { contentType: mime, upsert: true });
      if (uploadErr) {
        return {
          ok: false,
          url,
          persisted: false,
          error: `storage upload failed: ${uploadErr.message}`,
        };
      }
      const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(path, 315360000);
      if (!signed?.signedUrl) {
        return { ok: false, url, persisted: false, error: "no signed url after upload" };
      }
      return { ok: true, url: signed.signedUrl, persisted: true };
    } catch (e: any) {
      return { ok: false, url, persisted: false, error: e?.message ?? String(e) };
    }
  });

/**
 * 2026/06:saveOneVideo —— 单条视频入库(自动入库链路)。
 *
 *   跟 saveOneStoryboard 等价,但处理视频。
 *   路径:{userId}/{workspaceId}/videos/{groupId}.{ext}
 *
 *   行为:
 *     - 已入库(URL 已在 supabase.co / 自己的 storage 域名)→ 跳过,返回原 URL
 *     - 三方 URL → 服务端 fetch → 上传 Supabase Storage → 返回永久 URL
 *     - fetch 失败(TOS 过期 / 网络断)→ 返回 ok:false,客户端决定是否 toast
 *     - 空 url → noop 返回 ok:true url:''
 */
const SaveOneVideoInput = z.object({
  workspaceId: z.string().min(1).max(64),
  groupId: z.string().min(1).max(64),
  url: z.string().min(1).max(200000),
});

export type SaveOneVideoResult = {
  ok: boolean;
  url: string;
  persisted: boolean;
  error?: string;
};

export const saveOneVideo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SaveOneVideoInput.parse(input))
  .handler(async ({ data, context }): Promise<SaveOneVideoResult> => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    const { workspaceId, groupId, url } = data;

    if (!url) {
      return { ok: true, url: "", persisted: false };
    }
    // 已入库 → 跳过
    if (isAlreadyPersisted(url)) {
      return { ok: true, url, persisted: false };
    }

    try {
      const { buf, contentType } = await fetchMedia(url);
      const path = makePath(userId, workspaceId, "video", groupId, contentType);
      const mime = MIME_BY_KIND.video;
      const blob = new Blob([buf], { type: mime });
      const { error: uploadErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, blob, { contentType: mime, upsert: true });
      if (uploadErr) {
        return {
          ok: false,
          url,
          persisted: false,
          error: `storage upload failed: ${uploadErr.message}`,
        };
      }
      const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(path, 315360000);
      if (!signed?.signedUrl) {
        return { ok: false, url, persisted: false, error: "no signed url after upload" };
      }
      return { ok: true, url: signed.signedUrl, persisted: true };
    } catch (e: any) {
      return { ok: false, url, persisted: false, error: e?.message ?? String(e) };
    }
  });

/**
 * 2026/06:通用图片持久化 —— 下载临时 URL → 上传 workspace-media → 返回永久 URL。
 * 用于角色/场景/道具图片的自动入库,与 saveOneStoryboard 同模式。
 * 路径: {userId}/assets/{kind}/{id}-{timestamp}.{ext}
 */
const PersistAssetImageInput = z.object({
  // 注意:生图函数(azure/aigcfamily/onetoken/pixflow/tokenflash/openrouter/lovable 等)
  // 经常返回 data:image/png;base64,... 形式的 URL,单条可达数 MB。
  // 上限放宽到 ~15MB 字符,覆盖常见 base64 图。
  url: z.string().min(1).max(15_000_000),
  userId: z.string().min(1).max(64),
  kind: z.enum(["character", "scene", "prop", "panel", "shot"]),
  id: z.string().min(1).max(128),
});

export const persistAssetImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => PersistAssetImageInput.parse(d))
  .handler(async ({ data, context }): Promise<{ ok: boolean; url: string; error?: string }> => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    const { url, kind, id } = data;

    if (!url) return { ok: true, url: "", error: undefined };
    if (isAlreadyPersisted(url)) return { ok: true, url, error: undefined };

    try {
      const { buf, contentType } = await fetchMedia(url);
      const ct = contentType.toLowerCase();
      let ext = "png";
      if (ct.includes("jpeg") || ct.includes("jpg")) ext = "jpg";
      else if (ct.includes("webp")) ext = "webp";
      else if (ct.includes("gif")) ext = "gif";
      const path = `${userId}/assets/${kind}/${id}-${Date.now()}.${ext}`;
      const blob = new Blob([buf], { type: contentType || "image/png" });
      const { error: uploadErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, blob, { contentType: contentType || "image/png", upsert: true });
      if (uploadErr) return { ok: false, url: "", error: `upload failed: ${uploadErr.message}` };
      // 用签名 URL（10年有效期），避免 RLS 限制导致 <img> 无法加载
      const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(path, 315360000); // 10 years
      if (!signed?.signedUrl) return { ok: false, url: "", error: "no signed url" };
      return { ok: true, url: signed.signedUrl };
    } catch (e: any) {
      return { ok: false, url: "", error: e?.message ?? String(e) };
    }
  });

const BUCKET = "workspace-media";
const FETCH_TIMEOUT_MS = 60_000;

type MediaItem = {
  url: string;
  status: "running" | "succeeded" | "failed";
};

/** 检测 URL 是否已经是我们自己的 Supabase Storage 链接(已入库) */
function isAlreadyPersisted(url: string): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    // Supabase 默认的 storage 域名
    if (host.endsWith(".supabase.co") && u.pathname.includes(`/object/public/${BUCKET}/`)) {
      return true;
    }
    // 自部署 Supabase 也走 *.supabase.in 或自定域名,但路径特征一致
    if (u.pathname.includes(`/storage/v1/object/public/${BUCKET}/`)) {
      return true;
    }
    if (u.pathname.includes(`/object/public/${BUCKET}/`)) {
      return true;
    }
    // 签名 URL
    if (u.pathname.includes(`/storage/v1/object/sign/${BUCKET}/`)) {
      return true;
    }
  } catch {
    // 非合法 URL,当 ephemeral 处理
  }
  return false;
}

const EXT_BY_KIND: Record<"video" | "storyboard", string> = {
  video: "mp4",
  storyboard: "png",
};

const MIME_BY_KIND: Record<"video" | "storyboard", string> = {
  video: "video/mp4",
  storyboard: "image/png",
};

/** 抓取远端媒体 → ArrayBuffer,带超时。data: URL 直接 base64 解码。 */
export async function fetchMedia(
  url: string,
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<{ buf: ArrayBuffer; contentType: string }> {
  // data: URL 在 Workers 运行时 fetch 行为不一致,直接解码 base64。
  if (url.startsWith("data:")) {
    // 形如 data:[<mediatype>][;base64],<data>
    const comma = url.indexOf(",");
    if (comma === -1) throw new Error("invalid data url: missing comma");
    const meta = url.slice(5, comma); // 去掉 "data:"
    const payload = url.slice(comma + 1);
    const isBase64 = /;base64/i.test(meta);
    const contentType = meta.replace(/;base64/i, "").split(";")[0] || "application/octet-stream";
    if (!isBase64) {
      throw new Error("unsupported non-base64 data url");
    }
    const bin = Buffer.from(payload, "base64");
    const buf = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer;
    return { buf, contentType };
  }
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`upstream fetch ${res.status}`);
    const buf = await res.arrayBuffer();
    const contentType = res.headers.get("content-type") || "";
    return { buf, contentType };
  } finally {
    clearTimeout(t);
  }
}

/** 用 userId/workspaceId/kind/groupId 拼出 storage 路径 */
function makePath(
  userId: string,
  workspaceId: string,
  kind: "video" | "storyboard",
  groupId: string,
  contentType: string,
): string {
  // 优先用 response content-type 推断扩展名,失败兜底
  const ct = (contentType || "").toLowerCase();
  let ext = EXT_BY_KIND[kind];
  if (kind === "storyboard") {
    if (ct.includes("jpeg") || ct.includes("jpg")) ext = "jpg";
    else if (ct.includes("webp")) ext = "webp";
    else ext = "png";
  } else if (kind === "video") {
    if (ct.includes("webm")) ext = "webm";
    else if (ct.includes("quicktime")) ext = "mov";
    else ext = "mp4";
  }
  // groupId 可能含特殊字符(grp-N-xxx),URL encode 一下保险
  const safeGroupId = encodeURIComponent(groupId);
  return `${userId}/${workspaceId}/${kind === "video" ? "videos" : "storyboards"}/${safeGroupId}.${ext}`;
}

// ====================================================================
// persistWorkspaceMedia (server fn)
//
// 输入:workspaceId + 两份 URL map(groupVideos / groupStoryboards)
// 行为:
//   - 跳过 status !== 'succeeded' 或 URL 为空的
//   - 跳过已经入库的(检测 host)
//   - 下载 → 上传 → 用永久 URL 替换
// 输出:替换后的两份 map + 统计(persistedCount / skippedCount / failedCount)
// ====================================================================

const PersistInput = z.object({
  workspaceId: z.string().min(1).max(64),
  groupVideos: z.record(z.string(), z.object({ url: z.string(), status: z.string() })).optional(),
  groupStoryboards: z
    .record(z.string(), z.object({ url: z.string(), status: z.string() }))
    .optional(),
});

export type PersistWorkspaceMediaResult = {
  groupVideos: Record<string, MediaItem>;
  groupStoryboards: Record<string, MediaItem>;
  persistedCount: number;
  skippedCount: number;
  failedCount: number;
  errors: string[];
};

export const persistWorkspaceMedia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => PersistInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    const { workspaceId, groupVideos = {}, groupStoryboards = {} } = data;

    const result: PersistWorkspaceMediaResult = {
      groupVideos: {},
      groupStoryboards: {},
      persistedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      errors: [],
    };

    /**
     * 处理一份 map 的通用逻辑:
     *   1) status !== succeeded → 原样保留
     *   2) url 为空 → 原样保留
     *   3) 已经入库 → 原样保留 + skippedCount++
     *   4) 否则 → 下载 + 上传 + 替换 url
     */
    async function processMap(
      kind: "video" | "storyboard",
      inputMap: Record<string, { url: string; status: string }>,
      outputMap: Record<string, MediaItem>,
    ) {
      const entries = Object.entries(inputMap);
      for (const [groupId, item] of entries) {
        // 1) 原样保留
        if (item.status !== "succeeded" || !item.url) {
          outputMap[groupId] = { url: item.url, status: item.status as MediaItem["status"] };
          continue;
        }
        // 3) 已入库 → 跳过
        if (isAlreadyPersisted(item.url)) {
          outputMap[groupId] = { url: item.url, status: item.status as MediaItem["status"] };
          result.skippedCount++;
          continue;
        }
        // 4) 下载 + 上传
        try {
          const { buf, contentType } = await fetchMedia(item.url);
          const path = makePath(userId, workspaceId, kind, groupId, contentType);
          const mime = MIME_BY_KIND[kind];
          const blob = new Blob([buf], { type: mime });
          const { error: uploadErr } = await supabase.storage
            .from(BUCKET)
            .upload(path, blob, { contentType: mime, upsert: true });
          if (uploadErr) {
            throw new Error(`storage upload failed: ${uploadErr.message}`);
          }
          const { data: signed } = await supabase.storage
            .from(BUCKET)
            .createSignedUrl(path, 315360000);
          if (!signed?.signedUrl) throw new Error("no signed url after upload");
          outputMap[groupId] = { url: signed.signedUrl, status: "succeeded" };
          result.persistedCount++;
        } catch (e: any) {
          // 失败 → 原样保留 ephemeral URL,统计错误
          outputMap[groupId] = { url: item.url, status: item.status as MediaItem["status"] };
          result.failedCount++;
          result.errors.push(`[${kind}:${groupId}] ${e?.message ?? String(e)}`.slice(0, 200));
        }
      }
    }

    await processMap("video", groupVideos, result.groupVideos);
    await processMap("storyboard", groupStoryboards, result.groupStoryboards);

    return result;
  });
