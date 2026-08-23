// ====================================================================
//  服务端「读时重签」helper（workspace-media 私有桶，签名 7 天过期）。
//
//  历史数据把签名 URL 直接写进了库，过期后前端裂图 / 视频打不开。
//  读取路径统一过一遍本 helper：能解析出对象路径的重新签发，
//  三方链接原样返回。
// ====================================================================

import {
  WORKSPACE_MEDIA_BUCKET,
  collectWorkspaceMediaUrls,
  getWorkspaceMediaPath,
  replaceWorkspaceMediaUrls,
} from "./mediaUrl";

const SIGN_TTL_SECONDS = 604_800;

/** 批量重签一组 URL，返回「原 URL → 新签名 URL」映射。 */
export async function buildResignMap(
  supabase: any,
  urls: string[],
): Promise<Record<string, string>> {
  const unique = Array.from(new Set(urls.filter(Boolean))).slice(0, 300);
  const map: Record<string, string> = {};
  await Promise.all(
    unique.map(async (url) => {
      const path = getWorkspaceMediaPath(url);
      if (!path) return;
      try {
        const { data, error } = await supabase.storage
          .from(WORKSPACE_MEDIA_BUCKET)
          .createSignedUrl(path, SIGN_TTL_SECONDS);
        if (!error && data?.signedUrl) map[url] = data.signedUrl as string;
      } catch {
        // 单条失败不影响其余；保留原 URL
      }
    }),
  );
  return map;
}

/** 深度遍历任意结构，把其中的 workspace-media 链接换成新签名 URL。 */
export async function resignMediaDeep<T>(supabase: any, value: T): Promise<T> {
  const urls = collectWorkspaceMediaUrls(value);
  if (urls.length === 0) return value;
  const map = await buildResignMap(supabase, urls);
  return replaceWorkspaceMediaUrls(value, map);
}
