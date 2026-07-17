// ====================================================================
// creditsGuard — 生成前积分预校验
//
// 在真正调用外部生图/视频接口之前,基于 user_wallets.credits_balance 判断
// 用户是否有足够积分。未登录 / cost=null(免费模型) / 环境变量缺失 -> 放行,
// 保持既有 "有则扣、无则跳过" 的行为一致。
//
// 与 chargeCredits 的关系:预校验只是防止余额<=0 时空跑外部接口。真正的
// 原子扣减仍由 chargeCredits 走 deduct_user_credits RPC 完成(允许微小
// 竞态,依旧维持最终一致性)。
// ====================================================================

import { getOptionalAuthCtx } from "./authContext";

export type CreditsGuardResult =
  | { ok: true }
  | { ok: false; error: string; balance: number; required: number };

/**
 * 预校验:balance >= required 时返回 { ok:true }。
 * required <= 0 或未登录 -> 直接放行。
 */
export async function ensureEnoughCredits(
  required: number | null | undefined,
  meta?: { kind?: "image" | "video"; model?: string | null },
): Promise<CreditsGuardResult> {
  if (!required || required <= 0) return { ok: true };
  const ctx = await getOptionalAuthCtx();
  if (!ctx) return { ok: true }; // 未登录:不拦截(与既有扣分逻辑对齐)
  try {
    const { data, error } = await ctx.supabase
      .from("user_wallets")
      .select("credits_balance")
      .eq("user_id", ctx.userId)
      .maybeSingle();
    if (error) {
      console.warn(`[creditsGuard] read wallet failed: ${error.message}`);
      return { ok: true }; // 读取失败时不拦截,避免误伤
    }
    const balance = Number(data?.credits_balance ?? 0);
    if (balance >= required) return { ok: true };
    const kind = meta?.kind === "video" ? "视频" : "图片";
    return {
      ok: false,
      error: `当前积分不足(余额 ${balance},本次${kind}生成需要 ${required}),请充值后再试。`,
      balance,
      required,
    };
  } catch (e) {
    console.warn(`[creditsGuard] exception:`, e);
    return { ok: true };
  }
}