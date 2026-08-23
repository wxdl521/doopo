// ====================================================================
//  浏览器端「读时重签」helper。
//
//  转绘会话存在 localStorage / 库里，其中的 workspace-media 链接是
//  7 天签名 URL，过期后附件裂图、视频播放失败。载入时统一过一遍重签。
// ====================================================================

import {
  collectWorkspaceMediaUrls,
  getWorkspaceMediaPath,
  isWorkspaceMediaUrl,
  replaceWorkspaceMediaUrls,
} from "@/lib/mediaUrl";
import { refreshMediaUrls } from "@/lib/workspaceMedia.functions";

/** 深度重签任意结构里的 workspace-media 链接；失败时原样返回。 */
export async function resignRestyleMedia<T>(value: T): Promise<T> {
  const urls = collectWorkspaceMediaUrls(value);
  if (urls.length === 0) return value;
  try {
    const res = await refreshMediaUrls({ data: { urls } });
    return replaceWorkspaceMediaUrls(value, res?.map ?? {});
  } catch {
    return value;
  }
}

/** 单条重签（用于 onError 兜底）。返回 null 表示无法自愈。 */
export async function resignSingleUrl(url: string | null | undefined): Promise<string | null> {
  if (!url || !isWorkspaceMediaUrl(url)) return null;
  try {
    const res = await refreshMediaUrls({ data: { urls: [url] } });
    const next = res?.map?.[url];
    return next && next !== url ? next : null;
  } catch {
    return null;
  }
}

export { getWorkspaceMediaPath, isWorkspaceMediaUrl };
