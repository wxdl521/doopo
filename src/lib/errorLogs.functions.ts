// ====================================================================
//  generation_error_logs —— 图片/视频生成失败日志
//
//  - logGenerationError:内部使用,失败时 fire-and-forget 写入。
//    使用 supabaseAdmin(绕过 RLS),user_id 通过请求 Authorization
//    header 的 JWT payload 提取(无验证,仅用于归属;RLS 只读时按
//    auth.uid() 过滤本人)。
//  - listMyGenerationErrors:登录用户查看本人最近 100 条日志。
// ====================================================================

import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const SENSITIVE_KEYS = /^(authorization|api[-_]?key|apikey|access[-_]?key|secret|token|password)$/i;

/** 深拷贝并去掉敏感字段;超长字符串截断。 */
function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[depth-limited]";
  if (value == null) return value;
  if (typeof value === "string") return value.length > 4000 ? value.slice(0, 4000) + "…" : value;
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => sanitize(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.test(k)) {
      out[k] = "[redacted]";
      continue;
    }
    out[k] = sanitize(v, depth + 1);
  }
  return out;
}

/** 从当前请求的 Bearer token 中读取 sub(用户 id),无则返回 null。不做签名校验。 */
export function tryGetUserIdFromRequest(): string | null {
  try {
    const req = getRequest();
    const auth = req?.headers?.get?.("authorization") || req?.headers?.get?.("Authorization");
    if (!auth || !auth.startsWith("Bearer ")) return null;
    const token = auth.slice(7);
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = parts[1];
    // base64url → base64
    const b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
    const json = JSON.parse(
      typeof atob === "function"
        ? atob(b64 + pad)
        : Buffer.from(b64 + pad, "base64").toString("utf8"),
    );
    return typeof json?.sub === "string" ? json.sub : null;
  } catch {
    return null;
  }
}

export type LogGenerationErrorInput = {
  kind: "image" | "video";
  provider: string;
  model?: string | null;
  status?: number | null;
  durationMs?: number | null;
  requestPayload?: unknown;
  responseBody?: string | null;
  errorMessage?: string | null;
  userId?: string | null;
};

/** 内部辅助:fire-and-forget 写一条错误日志。任何异常吞掉,不影响主流程。 */
export function logGenerationError(input: LogGenerationErrorInput): void {
  (async () => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const userId = input.userId ?? tryGetUserIdFromRequest();
      const payload = sanitize(input.requestPayload ?? null);
      const body = input.responseBody
        ? input.responseBody.slice(0, 4096)
        : null;
      const msg = input.errorMessage ? input.errorMessage.slice(0, 1000) : null;
      const { error } = await supabaseAdmin.from("generation_error_logs").insert({
        user_id: userId,
        kind: input.kind,
        provider: input.provider,
        model: input.model ?? null,
        status: input.status ?? null,
        duration_ms: input.durationMs ?? null,
        request_payload: payload as any,
        response_body: body,
        error_message: msg,
      });
      if (error) console.warn("[errorLogs] insert failed:", error.message);
    } catch (e) {
      console.warn("[errorLogs] unexpected:", e);
    }
  })();
}

// ---------- 查询端 ----------

const ListInput = z.object({
  kind: z.enum(["all", "image", "video"]).default("all"),
  limit: z.number().int().min(1).max(200).default(100),
});

export const listMyGenerationErrors = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ListInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    let q = supabase
      .from("generation_error_logs")
      .select(
        "id, kind, provider, model, status, duration_ms, request_payload, response_body, error_message, created_at",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.kind !== "all") q = q.eq("kind", data.kind);
    const { data: rows, error } = await q;
    if (error) return { rows: [], error: error.message };
    return { rows: rows ?? [], error: null };
  });
