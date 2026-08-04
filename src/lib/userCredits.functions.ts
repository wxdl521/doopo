import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ====================================================================
// getUserBalance — 获取当前用户个人积分余额（不存在则自动创建钱包）
// ====================================================================

export const getUserBalance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const { data: wallet } = await supabase
      .from("user_wallets")
      .select("credits_balance")
      .eq("user_id", userId)
      .maybeSingle();

    if (wallet) {
      return { balance: wallet.credits_balance };
    }

    // 钱包不存在 → 创建（余额 0）
    const { error: insertErr } = await supabase
      .from("user_wallets")
      .insert({ user_id: userId, credits_balance: 0 });

    if (insertErr) {
      // 并发创建导致的唯一冲突 → 重新查询
      if (insertErr.code === "23505") {
        const { data: retry } = await supabase
          .from("user_wallets")
          .select("credits_balance")
          .eq("user_id", userId)
          .maybeSingle();
        return { balance: retry?.credits_balance ?? 0 };
      }
      console.error("[getUserBalance] insert wallet failed:", insertErr);
      return { balance: 0 };
    }

    return { balance: 0 };
  });

// ====================================================================
// getUserCreditSummary — 余额 + 累计入账 + 累计消耗
// ====================================================================

export const getUserCreditSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const { data: wallet } = await supabase
      .from("user_wallets")
      .select("credits_balance")
      .eq("user_id", userId)
      .maybeSingle();

    const { data: rows } = await supabase
      .from("user_credit_transactions")
      .select("amount")
      .eq("user_id", userId);

    let earned = 0;
    let spent = 0;
    for (const r of rows ?? []) {
      const a = Number((r as any).amount) || 0;
      if (a > 0) earned += a;
      else if (a < 0) spent += -a;
    }

    return {
      balance: Number(wallet?.credits_balance ?? 0),
      lifetimeEarned: earned,
      lifetimeSpent: spent,
    };
  });

// ====================================================================
// rechargeCredits — 充值积分（调用 SECURITY DEFINER RPC 安全加余额）
// ====================================================================

export const rechargeCredits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => {
    const parsed = z.object({ amount: z.number().int().positive() }).safeParse(input);
    if (!parsed.success) throw new Error("Invalid amount");
    return parsed.data;
  })
  .handler(async () => {
    // 2026-08：add_user_credits 已撤销 authenticated 执行权（自充漏洞修复，
    // 见迁移 20260804130000）。接入支付回调前，自助充值返回明确提示。
    return { ok: false as const, error: "自助充值通道正在升级，请联系管理员发放积分。" };
  });

// ====================================================================
// chargeCredits - 扣减积分(模型调用成功后调用)
//
//   调 deduct_user_credits RPC(SECURITY DEFINER,原子 UPSERT 扣减 + 写流水)。
//   amount > 0,RPC 内部转负。余额不足扣到负数(欠款,下次充值抵扣)。
//   扣失败(RPC 错误/异常)不抛 -- 返回 {ok:false},调用方不阻断主流程
//   (图片/视频已生成,不收回)。
//
//   supabase 参数:用户 token 的 client(中间件注入或 getOptionalAuthCtx)。
//   RPC 内 auth.uid() 从该 token 取,确保只扣自己的。
//
//   幂等(2026-08 审计加固):params.idempotencyKey 传入时,先查流水表是否已有
//   同 key 记录(description 尾缀 [ref:<key>]),有则跳过扣费直接返回 ok。
//   流水表无专门幂等列,key 编进 description 是最小改动方案;查重失败时
//   继续扣费(扣重风险 < 漏扣,与"扣失败不阻断"的既有口径一致),非强一致。
// ====================================================================

export async function chargeCredits(
  supabase: any,
  userId: string,
  params: {
    amount: number;
    model?: string;
    resolution?: string;
    duration?: number;
    description: string;
    /** 幂等键(如视频 taskId);同一 key 只扣一次 */
    idempotencyKey?: string;
  },
): Promise<{ ok: boolean; balanceAfter: number | null; deduped?: boolean }> {
  // 幂等键编进流水 description,查询与写入用同一口径
  const description = params.idempotencyKey
    ? `${params.description} [ref:${params.idempotencyKey}]`
    : params.description;
  try {
    if (params.idempotencyKey) {
      const { data: existing, error: lookupError } = await supabase
        .from("user_credit_transactions")
        .select("id")
        .eq("user_id", userId)
        .eq("description", description)
        .limit(1);
      if (lookupError) {
        console.warn(
          `[chargeCredits] userId=${userId} idempotency lookup failed, charging anyway:`,
          lookupError,
        );
      } else if (existing && existing.length > 0) {
        return { ok: true, balanceAfter: null, deduped: true };
      }
    }
    const { data, error } = await supabase.rpc("deduct_user_credits", {
      p_amount: params.amount,
      p_description: description,
      p_model: params.model ?? null,
      p_resolution: params.resolution ?? null,
      p_duration: params.duration ?? null,
    });
    if (error) {
      console.error(`[chargeCredits] userId=${userId} RPC failed:`, error);
      return { ok: false, balanceAfter: null };
    }
    // RPC RETURNS TABLE(ok, balance_after) -> supabase 返回数组
    const row = Array.isArray(data) ? data[0] : data;
    return { ok: row?.ok === true, balanceAfter: row?.balance_after ?? null };
  } catch (e) {
    console.error(`[chargeCredits] userId=${userId} exception:`, e);
    return { ok: false, balanceAfter: null };
  }
}

// ====================================================================
// getUserCreditTransactions - 查询当前用户的积分消耗记录(分页)
//   用于 account.credits 页面展示。RLS 保证只能查自己。
// ====================================================================

export type UserCreditTransactionRow = {
  id: string;
  type: string;
  amount: number;
  balanceAfter: number | null;
  model: string | null;
  resolution: string | null;
  duration: number | null;
  description: string | null;
  createdAt: string;
};

export const getUserCreditTransactions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => {
    const parsed = z
      .object({
        limit: z.number().int().min(1).max(100).optional().default(20),
        offset: z.number().int().min(0).optional().default(0),
      })
      .safeParse(input);
    if (!parsed.success) throw new Error("Invalid input");
    return parsed.data;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: rows, error } = await supabase
      .from("user_credit_transactions")
      .select("id,type,amount,balance_after,model,resolution,duration,description,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .range(data.offset, data.offset + data.limit - 1);
    if (error) return { transactions: [] as UserCreditTransactionRow[], error: error.message };
    const transactions: UserCreditTransactionRow[] = (rows ?? []).map((r: any) => ({
      id: r.id,
      type: r.type,
      amount: Number(r.amount),
      balanceAfter: r.balance_after == null ? null : Number(r.balance_after),
      model: r.model,
      resolution: r.resolution,
      duration: r.duration,
      description: r.description,
      createdAt: r.created_at,
    }));
    return { transactions, error: null as string | null };
  });
