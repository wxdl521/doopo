// ====================================================================
//  workspace-media URL 工具（纯函数，客户端/服务端通用）
//
//  `workspace-media` 是私有 bucket，读地址是 7 天有效期的签名 URL。
//  历史数据把签名 URL 直接写进了数据库，过期后前端裂图（"图片已失效"）。
//  这里提供统一的「从 URL 解析 Storage 对象路径」能力，
//  服务端据此在读取时重新签发（见 workspaceMedia.functions.ts#refreshMediaUrls）。
// ====================================================================

export const WORKSPACE_MEDIA_BUCKET = "workspace-media";

/** 从 workspace-media 的 public / sign URL 中提取 Storage 内部对象路径。 */
export function getWorkspaceMediaPath(url: string | null | undefined): string | null {
  if (!url || typeof url !== "string") return null;
  if (url.startsWith("data:") || url.startsWith("blob:")) return null;
  try {
    const pathname = new URL(url).pathname;
    const match = pathname.match(
      /\/(?:storage\/v1\/)?object\/(?:public|sign|authenticated)\/workspace-media\/(.+)$/i,
    );
    return match?.[1] ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

/** URL 是否指向我们自己的 workspace-media 对象（可被重新签名自愈）。 */
export function isWorkspaceMediaUrl(url: string | null | undefined): boolean {
  return getWorkspaceMediaPath(url) !== null;
}

/** 深度遍历任意 JSON 结构，收集其中所有 workspace-media 链接（去重）。 */
export function collectWorkspaceMediaUrls(value: unknown, limit = 300): string[] {
  const found = new Set<string>();
  const walk = (node: unknown, depth: number) => {
    if (found.size >= limit || depth > 8 || node == null) return;
    if (typeof node === "string") {
      if (isWorkspaceMediaUrl(node)) found.add(node);
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    if (typeof node === "object") {
      for (const item of Object.values(node as Record<string, unknown>)) walk(item, depth + 1);
    }
  };
  walk(value, 0);
  return Array.from(found);
}

/** 深度遍历替换：把结构里的 workspace-media 链接按映射换成新签名 URL。 */
export function replaceWorkspaceMediaUrls<T>(value: T, map: Record<string, string>): T {
  if (!map || Object.keys(map).length === 0) return value;
  const walk = (node: unknown, depth: number): unknown => {
    if (depth > 8 || node == null) return node;
    if (typeof node === "string") return map[node] ?? node;
    if (Array.isArray(node)) return node.map((item) => walk(item, depth + 1));
    if (typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        out[k] = walk(v, depth + 1);
      }
      return out;
    }
    return node;
  };
  return walk(value, 0) as T;
}
