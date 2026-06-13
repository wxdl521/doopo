// ====================================================================
//  Workspace media persistence —— 把分镜视频 / 故事板图从三方 URL
//  (ARK / DashScope / Seedream,24h 过期)下载下来,上传到用户自己的
//  Supabase Storage `workspace-media` bucket,返回永久 URL。
//
//  触发方式:用户在 workspace 左上角点「保存」时,客户端先调这个 fn
//  把所有 ephemeral URL 入库,再把替换后的 URL 写回 workspace_data。
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

import "./loadEnv"
import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware"

const BUCKET = "workspace-media"
const FETCH_TIMEOUT_MS = 60_000

type MediaItem = {
  url: string
  status: "running" | "succeeded" | "failed"
}

/** 检测 URL 是否已经是我们自己的 Supabase Storage 链接(已入库) */
function isAlreadyPersisted(url: string): boolean {
  if (!url) return false
  try {
    const u = new URL(url)
    const host = u.hostname.toLowerCase()
    // Supabase 默认的 storage 域名
    if (host.endsWith(".supabase.co") && u.pathname.includes(`/object/public/${BUCKET}/`)) {
      return true
    }
    // 自部署 Supabase 也走 *.supabase.in 或自定域名,但路径特征一致
    if (u.pathname.includes(`/storage/v1/object/public/${BUCKET}/`)) {
      return true
    }
    if (u.pathname.includes(`/object/public/${BUCKET}/`)) {
      return true
    }
  } catch {
    // 非合法 URL,当 ephemeral 处理
  }
  return false
}

const EXT_BY_KIND: Record<"video" | "storyboard", string> = {
  video: "mp4",
  storyboard: "png",
}

const MIME_BY_KIND: Record<"video" | "storyboard", string> = {
  video: "video/mp4",
  storyboard: "image/png",
}

/** 抓取远端媒体 → ArrayBuffer,带超时 */
async function fetchMedia(
  url: string,
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<{ buf: ArrayBuffer; contentType: string }> {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) throw new Error(`upstream fetch ${res.status}`)
    const buf = await res.arrayBuffer()
    const contentType = res.headers.get("content-type") || ""
    return { buf, contentType }
  } finally {
    clearTimeout(t)
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
  const ct = (contentType || "").toLowerCase()
  let ext = EXT_BY_KIND[kind]
  if (kind === "storyboard") {
    if (ct.includes("jpeg") || ct.includes("jpg")) ext = "jpg"
    else if (ct.includes("webp")) ext = "webp"
    else ext = "png"
  } else if (kind === "video") {
    if (ct.includes("webm")) ext = "webm"
    else if (ct.includes("quicktime")) ext = "mov"
    else ext = "mp4"
  }
  // groupId 可能含特殊字符(grp-N-xxx),URL encode 一下保险
  const safeGroupId = encodeURIComponent(groupId)
  return `${userId}/${workspaceId}/${kind === "video" ? "videos" : "storyboards"}/${safeGroupId}.${ext}`
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
  groupVideos: z
    .record(z.string(), z.object({ url: z.string(), status: z.string() }))
    .optional(),
  groupStoryboards: z
    .record(z.string(), z.object({ url: z.string(), status: z.string() }))
    .optional(),
})

export type PersistWorkspaceMediaResult = {
  groupVideos: Record<string, MediaItem>
  groupStoryboards: Record<string, MediaItem>
  persistedCount: number
  skippedCount: number
  failedCount: number
  errors: string[]
}

export const persistWorkspaceMedia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => PersistInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string }
    const { workspaceId, groupVideos = {}, groupStoryboards = {} } = data

    const result: PersistWorkspaceMediaResult = {
      groupVideos: {},
      groupStoryboards: {},
      persistedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      errors: [],
    }

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
      const entries = Object.entries(inputMap)
      for (const [groupId, item] of entries) {
        // 1) 原样保留
        if (item.status !== "succeeded" || !item.url) {
          outputMap[groupId] = { url: item.url, status: item.status as MediaItem["status"] }
          continue
        }
        // 3) 已入库 → 跳过
        if (isAlreadyPersisted(item.url)) {
          outputMap[groupId] = { url: item.url, status: item.status as MediaItem["status"] }
          result.skippedCount++
          continue
        }
        // 4) 下载 + 上传
        try {
          const { buf, contentType } = await fetchMedia(item.url)
          const path = makePath(userId, workspaceId, kind, groupId, contentType)
          const mime = MIME_BY_KIND[kind]
          const blob = new Blob([buf], { type: mime })
          const { error: uploadErr } = await supabase.storage
            .from(BUCKET)
            .upload(path, blob, { contentType: mime, upsert: true })
          if (uploadErr) {
            throw new Error(`storage upload failed: ${uploadErr.message}`)
          }
          const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path)
          const permanentUrl = pub?.publicUrl
          if (!permanentUrl) throw new Error("no public url after upload")
          outputMap[groupId] = { url: permanentUrl, status: "succeeded" }
          result.persistedCount++
        } catch (e: any) {
          // 失败 → 原样保留 ephemeral URL,统计错误
          outputMap[groupId] = { url: item.url, status: item.status as MediaItem["status"] }
          result.failedCount++
          result.errors.push(`[${kind}:${groupId}] ${e?.message ?? String(e)}`.slice(0, 200))
        }
      }
    }

    await processMap("video", groupVideos, result.groupVideos)
    await processMap("storyboard", groupStoryboards, result.groupStoryboards)

    return result
  })