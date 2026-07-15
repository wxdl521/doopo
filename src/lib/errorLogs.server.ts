// 服务端专用:错误日志写入 & 从 Bearer token 提取 user id。
// 不可被客户端图导入。
import { getRequest } from "@tanstack/react-start/server";

const SENSITIVE_KEYS = /^(authorization|api[-_]?key|apikey|access[-_]?key|secret|token|password)$/i;

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

export function tryGetUserIdFromRequest(): string | null {
  try {
    const req = getRequest();
    const auth = req?.headers?.get?.("authorization") || req?.headers?.get?.("Authorization");
    if (!auth || !auth.startsWith("Bearer ")) return null;
    const token = auth.slice(7);
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = parts[1];
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

export function logGenerationError(input: LogGenerationErrorInput): void {
  (async () => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const userId = input.userId ?? tryGetUserIdFromRequest();
      const payload = sanitize(input.requestPayload ?? null);
      const body = input.responseBody ? input.responseBody.slice(0, 4096) : null;
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