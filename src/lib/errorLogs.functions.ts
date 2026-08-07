// ====================================================================
//  generation_error_logs —— 图片/视频生成失败日志
//
//  - logGenerationError:内部使用,失败时 fire-and-forget 写入。
//    使用 supabaseAdmin(绕过 RLS),user_id 通过请求 Authorization
//    header 的 JWT payload 提取(无验证,仅用于归属;RLS 只读时按
//    auth.uid() 过滤本人)。
//  - listMyGenerationErrors:登录用户查看本人最近 100 条日志。
// ====================================================================

// 客户端可导入:仅 createServerFn 声明。写入逻辑见 errorLogs.server.ts。
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ListInput = z.object({
  kind: z.enum(["all", "image", "video"]).default("all"),
  limit: z.number().int().min(1).max(200).default(100),
});

const ReportInput = z.object({
  kind: z.enum(["image", "video"]),
  provider: z.string().min(1).max(120),
  model: z.string().max(200).optional(),
  status: z.number().int().nullish(),
  durationMs: z.number().nonnegative().nullish(),
  errorMessage: z.string().min(1).max(1_000),
  requestPayload: z.unknown().optional(),
});

/**
 * 客户端上报通道：视频/图片任务的失败在客户端轮询侧发现时（服务端
 * submit/poll 本身都成功、失败是任务终态），经此写入 generation_error_logs，
 * 与服务端 logGenerationError 同表同口径（脱敏/截断在 server 侧完成）。
 */
export const reportGenerationError = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ReportInput.parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context as { supabase: any; userId: string };
    const { logGenerationError } = await import("./errorLogs.server");
    // 必须 await：CF Workers 响应返回后未完成的异步写入会被回收（实测 insert 静默丢失）
    await logGenerationError({
      kind: data.kind,
      provider: data.provider,
      model: data.model ?? null,
      status: data.status ?? null,
      durationMs: data.durationMs ?? null,
      requestPayload: data.requestPayload ?? null,
      errorMessage: data.errorMessage,
      userId,
    });
    return { ok: true as const };
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
