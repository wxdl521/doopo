// ====================================================================
// creditsGuard — 生成前积分预校验
//
// 在真正调用外部生图/视频接口之前,基于 user_wallets.credits_balance 判断
// 用户余额是否足够。未登录 / cost=null(免费模型) / 环境变量缺失 -> 放行,
// 保持既有 "有则扣、无则跳过" 的行为一致。
//
// 口径(2026-08 审计加固):
//   - 余额必须 balance >= required 才放行(余额 0 不再白嫖一次);
//   - 读库失败 / 无钱包行 / 异常一律 fail-closed 返回错误 —— 余额未知不放行,
//     但报错文案与「余额不足」明确区分(系统错误,不展示余额 0)。
//
// 身份口径(2026-08-13):
//   - 带 requireSupabaseAuth 中间件的 serverFn 必须透传中间件上下文(authCtx),
//     与扣费(chargeCredits 用同一 context.supabase)保持同一客户端同一用户;
//   - getOptionalAuthCtx 的 ad-hoc Bearer 解析只作无中间件链路(生图 helper)
//     的兜底,两条路径查询同表同键,行为等价。
//
// 与 chargeCredits 的关系:预校验只防止余额不足时空调用外部接口；真正的
// 原子扣减仍由 chargeCredits 走 deduct_user_credits RPC 完成。
// ====================================================================

import { getOptionalAuthCtx } from "./authContext.server";
import type { AuthCtx } from "./authContext.server";

export type CreditsGuardResult =
  | { ok: true }
  | { ok: false; error: string; balance: number; required: number };

/**
 * 预校验:balance >= required 时返回 { ok:true }。
 * required <= 0 或未登录 -> 直接放行。
 * 读库失败/无钱包行/异常 -> fail-closed 返回 { ok:false }(余额未知不放行,
 * 文案为系统错误,与「余额不足」区分)。
 * authCtx:已登录链路(requireSupabaseAuth 中间件)透传的上下文;缺省回退
 * ad-hoc Bearer 解析(getOptionalAuthCtx)。
 */
export async function ensureEnoughCredits(
  required: number | null | undefined,
  meta?: { kind?: "image" | "video"; model?: string | null },
  authCtx?: AuthCtx | null,
): Promise<CreditsGuardResult> {
  if (!required || required <= 0) return { ok: true };
  const ctx = authCtx ?? (await getOptionalAuthCtx());
  if (!ctx) return { ok: true }; // 未登录:不拦截(与既有扣分逻辑对齐)
  // fail-closed 时余额未知,按 0 上报(调用方只用 error/code,不展示 balance)
  const failClosed = (error: string): CreditsGuardResult => ({
    ok: false,
    error,
    balance: 0,
    required,
  });
  try {
    const { data, error } = await ctx.supabase
      .from("user_wallets")
      .select("credits_balance")
      .eq("user_id", ctx.userId)
      .maybeSingle();
    if (error) {
      console.warn(`[creditsGuard] read wallet failed: ${error.message}`);
      return failClosed("积分余额查询失败，请稍后重试。");
    }
    if (!data) {
      console.warn(`[creditsGuard] no wallet row for user ${ctx.userId}`);
      return failClosed("未查询到积分钱包，请先打开账户页完成初始化后再试。");
    }
    const balance = Number(data.credits_balance ?? 0);
    if (balance >= required) return { ok: true };
    return {
      ok: false,
      error: `积分余额不足(当前余额 ${balance})，请充值后再试。`,
      balance,
      required,
    };
  } catch (e) {
    console.warn(`[creditsGuard] exception:`, e);
    return failClosed("积分余额查询异常，请稍后重试。");
  }
}
