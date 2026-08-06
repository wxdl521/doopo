// 服务端专用：解析当前访问者 key。依赖 TanStack 请求上下文，禁止进入客户端图。
import { getOptionalAuthCtx } from "./authContext.server";
import { buildAnonymousViewerKey } from "./communityViewerKey";

/** 登录 → `u:<userId>`；匿名 → IP+UA 哈希 */
export async function resolveViewerKey(): Promise<string> {
  const ctx = await getOptionalAuthCtx();
  if (ctx) return `u:${ctx.userId}`;
  let ip: string | null = null;
  let ua: string | null = null;
  try {
    const { getRequest } = await import("@tanstack/react-start/server");
    const headers = getRequest()?.headers;
    // 反代链路优先取 CF / XFF 首跳，取不到退化为仅 UA 哈希
    ip =
      headers?.get("cf-connecting-ip") ??
      headers?.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      null;
    ua = headers?.get("user-agent") ?? null;
  } catch {
    // getRequest 在非请求上下文抛错时退化为仅 UA 哈希
  }
  return buildAnonymousViewerKey(ip, ua);
}