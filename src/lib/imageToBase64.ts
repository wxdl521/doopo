/**
 * Convert an image URL to a base64 data URL.
 *
 * Used as a fallback when Supabase Storage persistence fails.
 * The resulting data URL can be stored directly in the database
 * so the image survives page refreshes.
 *
 * 2026/06 修复:支持传入 serverSideFetch 参数作为兜底,
 * 当浏览器 fetch 跨域失败时走服务端中转。
 */

export async function urlToBase64(
  url: string,
  serverSideFetch?: (u: string) => Promise<{ base64: string | null; error?: string | null }>,
): Promise<string | null> {
  // Already a data URL — return as-is
  if (url.startsWith("data:")) return url;

  // 1) 先尝试客户端 fetch
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch failed: HTTP ${res.status}`);
    const blob = await res.blob();
    return await new Promise<string | null>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error("FileReader failed"));
      reader.readAsDataURL(blob);
    });
  } catch {
    // 客户端 fetch 失败(跨域/超时等)
  }

  // 2) 有服务端兜底时走服务端
  if (serverSideFetch) {
    try {
      const result = await serverSideFetch(url);
      if (result.base64) return result.base64;
    } catch {
      // 服务端也失败
    }
  }

  return null;
}
