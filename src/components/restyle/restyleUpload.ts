// ====================================================================
//  旧版转绘工作台大文件直传：视频与超过 4MB 的文件走 createMediaUploadUrl
//  签名地址 + XHR PUT 原始二进制，不做 base64（200MB 视频 base64 化后约
//  280MB 字符串，会撑爆标签页 / 超出请求体限制）。小图片仍保留
//  uploadLocalImage 的 base64 旧路径。
// ====================================================================

/** 超过该体积（含视频任意体积）走二进制直传。 */
export const DIRECT_UPLOAD_MIN_BYTES = 4 * 1024 * 1024;

/** 附件卡片上传状态，按 attachmentId 归档在组件内。 */
export type DirectUploadState = {
  status: "uploading" | "done" | "error";
  progress: number;
  error?: string;
};

/** 直传决策（纯函数）：视频一律直传；任何超过 4MB 的文件直传；小图片走旧路。 */
export function shouldUseDirectUpload(file: { type: string; size: number }): boolean {
  if (file.type.startsWith("video/")) return true;
  return file.size > DIRECT_UPLOAD_MIN_BYTES;
}

/** createMediaUploadUrl 的最小签名：为二进制直传取签名上传地址。 */
export type PrepareUploadUrlFn = (input: {
  id: string;
  kind: "video" | "audio" | "image";
  ext: string;
}) => Promise<{ ok: boolean; uploadUrl?: string; readUrl?: string; error?: string }>;

/** 从文件名/MIME 取扩展名（签名上传路径用）。 */
export function extFromFile(file: File): string {
  const byName = file.name.match(/\.([a-z0-9]{2,5})$/i)?.[1];
  if (byName) return byName.toLowerCase();
  const byType = file.type.split("/")[1];
  return (byType || "bin").replace("quicktime", "mov").toLowerCase();
}

function uploadKindFor(file: File): "video" | "audio" | "image" {
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return "image";
}

/**
 * 二进制直传：先取签名上传地址，再 XHR PUT 原始 File（不转 base64、不进内存
 * 字符串），带上传进度回调。失败文案区分签名失败 / 网络中断 / 存储 4xx。
 */
export async function uploadFileDirect(
  file: File,
  id: string,
  prepareUrl: PrepareUploadUrlFn,
  onProgress?: (percent: number) => void,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  let target: Awaited<ReturnType<PrepareUploadUrlFn>>;
  try {
    target = await prepareUrl({ id, kind: uploadKindFor(file), ext: extFromFile(file) });
  } catch (error) {
    return {
      ok: false,
      error: `签名上传地址获取失败：${error instanceof Error ? error.message : "网络错误"}`,
    };
  }
  if (!target.ok || !target.uploadUrl || !target.readUrl) {
    return {
      ok: false,
      error: target.ok
        ? "签名上传地址获取失败：未返回上传地址。"
        : `签名上传地址获取失败：${target.error ?? "未知错误"}`,
    };
  }
  const uploadUrl = target.uploadUrl;
  const readUrl = target.readUrl;
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl, true);
    xhr.setRequestHeader("content-type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        resolve({ ok: true, url: readUrl });
      } else if (xhr.status >= 400 && xhr.status < 500) {
        resolve({
          ok: false,
          error: `存储拒绝了上传（HTTP ${xhr.status}）：${(xhr.responseText || "").slice(0, 120)}`,
        });
      } else {
        resolve({ ok: false, error: `存储服务异常（HTTP ${xhr.status}），请稍后重试。` });
      }
    };
    xhr.onerror = () => resolve({ ok: false, error: "网络中断，上传未完成，请重试。" });
    xhr.onabort = () => resolve({ ok: false, error: "上传已中止。" });
    xhr.send(file);
  });
}
