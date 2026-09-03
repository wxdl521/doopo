import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function isMissingRpc(message: string | undefined): boolean {
  return /PGRST202|PGRST204|42883|does not exist|could not find/i.test(message ?? "");
}

function rpcRow<T>(data: unknown): T | null {
  if (data == null) return null;
  if (Array.isArray(data)) return (data[0] as T) ?? null;
  return data as T;
}

/** RPC 未落地时的钱包初始化（旧 INSERT 策略仍在时可用；RLS 收紧后必须走 ensure_user_wallet） */
async function fallbackInitWallet(supabase: any, userId: string): Promise<number> {
  const { data: wallet } = await supabase
    .from("user_wallets")
    .select("credits_balance")
    .eq("user_id", userId)
    .maybeSingle();
  if (wallet) return Number(wallet.credits_balance ?? 0);

  const { error: insertErr } = await supabase
    .from("user_wallets")
    .insert({ user_id: userId, credits_balance: 0 });
  if (insertErr) {
    if (insertErr.code === "23505") {
      const { data: retry } = await supabase
        .from("user_wallets")
        .select("credits_balance")
        .eq("user_id", userId)
        .maybeSingle();
      return Number(retry?.credits_balance ?? 0);
    }
    console.error("[readOrInitWalletBalance] insert wallet failed:", insertErr);
    return 0;
  }
  return 0;
}

/** 读余额；无钱包则创建为 0。优先 ensure_user_wallet RPC（不依赖客户端写钱包）。 */
export async function readOrInitWalletBalance(supabase: any, userId: string): Promise<number> {
  const { data, error } = await supabase.rpc("ensure_user_wallet");
  if (!error && data != null) {
    const value = Array.isArray(data) ? data[0] : data;
    return Number(value ?? 0);
  }
  if (error && !isMissingRpc(error.message)) {
    console.error("[readOrInitWalletBalance] ensure_user_wallet failed:", error);
  }
  return fallbackInitWallet(supabase, userId);
}

// ====================================================================
// getUserBalance — 获取当前用户个人积分余额（不存在则自动创建钱包）
// ====================================================================

export const getUserBalance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const balance = await readOrInitWalletBalance(supabase, userId);
    return { balance };
  });

// ====================================================================
// getUserCreditSummary — 余额 + 累计入账 + 累计消耗
// ====================================================================

export const getUserCreditSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase.rpc("get_my_credit_summary");
    if (!error) {
      const row = rpcRow<{
        balance: number;
        lifetime_earned: number;
        lifetime_spent: number;
      }>(data);
      if (row) {
        return {
          balance: Number(row.balance ?? 0),
          lifetimeEarned: Number(row.lifetime_earned ?? 0),
          lifetimeSpent: Number(row.lifetime_spent ?? 0),
        };
      }
    } else if (error && !isMissingRpc(error.message)) {
      console.error("[getUserCreditSummary] rpc failed:", error);
    }

    const balance = await readOrInitWalletBalance(supabase, userId);
    const { data: rows } = await supabase
      .from("user_credit_transactions")
      .select("amount")
      .eq("user_id", userId);
    let earned = 0;
    let spent = 0;
    for (const r of rows ?? []) {
      const a = Number((r as { amount?: number }).amount) || 0;
      if (a > 0) earned += a;
      else if (a < 0) spent += -a;
    }
    return { balance, lifetimeEarned: earned, lifetimeSpent: spent };
  });

// ====================================================================
// rechargeCredits — 充值积分（调用 SECURITY DEFINER RPC 安全加余额）
// ====================================================================

export const rechargeCredits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => {
    const parsed = z
      .object({ amount: z.number().int().positive().max(1_000_000) })
      .safeParse(input);
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
    /** 幂等键(如视频 taskId);同一 key 只扣一次（库级唯一索引原子保证） */
    idempotencyKey?: string;
    /** 2026/08:项目维度（后台按项目名查明细）;SQL 未执行时自动回退旧签名 */
    projectId?: string;
    projectName?: string;
  },
): Promise<{ ok: boolean; balanceAfter: number | null; deduped?: boolean }> {
  try {
    // 幂等由 RPC + 唯一索引原子完成（迁移 20260804230000）；不再查 description
    const callRpc = (withProject: boolean) =>
      supabase.rpc("deduct_user_credits", {
        p_amount: params.amount,
        p_description: params.description,
        p_model: params.model ?? null,
        p_resolution: params.resolution ?? null,
        p_duration: params.duration ?? null,
        p_idempotency_key: params.idempotencyKey ?? null,
        ...(withProject
          ? { p_project_id: params.projectId ?? null, p_project_name: params.projectName ?? null }
          : {}),
      });
    let { data, error } = await callRpc(true);
    // SQL(supabase/manual/20260818061000)未执行时,新参数/函数签名不存在:
    // PGRST202(函数缺失)/PGRST204(参数缺失)/42883 回退旧 6 参签名重试一次。
    if (
      error &&
      /PGRST202|PGRST204|42883|does not exist|could not find/i.test(error.message ?? "")
    ) {
      console.warn("[chargeCredits] deduct_user_credits 新签名不可用（SQL 未执行?）,回退旧签名");
      ({ data, error } = await callRpc(false));
    }
    if (error) {
      console.error(`[chargeCredits] userId=${userId} RPC failed:`, error);
      return { ok: false, balanceAfter: null };
    }
    // RPC RETURNS TABLE(ok, balance_after, deduped) -> supabase 返回数组
    const row = Array.isArray(data) ? data[0] : data;
    return {
      ok: row?.ok === true || row?.deduped === true,
      balanceAfter: row?.balance_after ?? null,
      deduped: row?.deduped === true,
    };
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
  /** 项目名称（20260818061000 迁移执行前为 null）。 */
  projectName: string | null;
  createdAt: string;
};

export const getUserCreditTransactions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => {
    const parsed = z
      .object({
        limit: z.number().int().min(1).max(100).optional().default(20),
        offset: z.number().int().min(0).optional().default(0),
        /** 项目名称模糊筛选（可选）。 */
        projectName: z.string().trim().max(200).optional(),
      })
      .safeParse(input);
    if (!parsed.success) throw new Error("Invalid input");
    return parsed.data;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const buildQuery = (withProject: boolean) => {
      let query = supabase
        .from("user_credit_transactions")
        .select(
          withProject
            ? "id,type,amount,balance_after,model,resolution,duration,description,project_name,created_at"
            : "id,type,amount,balance_after,model,resolution,duration,description,created_at",
        )
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .range(data.offset, data.offset + data.limit - 1);
      // 项目列不存在（迁移未执行）时项目筛选随降级一并跳过，不报错
      if (withProject && data.projectName) {
        query = query.ilike("project_name", `%${data.projectName}%`);
      }
      return query;
    };
    // 项目列是后加的（20260818061000），迁移未执行时 42703 降级为无项目列查询
    let result = await buildQuery(true);
    let hasProjectColumns = true;
    if (result.error && /42703|does not exist/i.test(result.error.message ?? "")) {
      hasProjectColumns = false;
      result = await buildQuery(false);
    }
    const { data: rows, error } = result;
    if (error)
      return {
        transactions: [] as UserCreditTransactionRow[],
        error: error.message,
        hasProjectColumns,
      };
    const transactions: UserCreditTransactionRow[] = (rows ?? []).map((r: any) => ({
      id: r.id,
      type: r.type,
      amount: Number(r.amount),
      balanceAfter: r.balance_after == null ? null : Number(r.balance_after),
      model: r.model,
      resolution: r.resolution,
      duration: r.duration,
      description: r.description,
      projectName: r.project_name ?? null,
      createdAt: r.created_at,
    }));
    return { transactions, error: null as string | null, hasProjectColumns };
  });

// ====================================================================
// refundChargedCredits — 按扣费幂等键退款（断连补偿）
//
// 场景（D6 回归）：分窗方案生成中客户端与平台断连后放弃某窗（重试仍失败），
// 服务端那次调用可能已完成并滞后扣费——按同一幂等键退还该窗已扣积分。
//
// 安全模型：
//   - 只退已扣的：本人流水必须有该幂等键的 consume 记录，未扣不退；
//   - 退款金额 = abs(consume.amount)，忽略客户端传入的 amount；
//   - 优先 refund_user_credits_by_key RPC（锁钱包 + 写流水，同一事务）；
//   - 退款流水以 `refund:{chargeKey}` 为幂等键，库级唯一索引防重复退款。
//
// 一致性边界（见迁移 20260804230000 / 20260902000000）：
//   - 滞后入账：扣费晚于退款请求时查不到 consume，返回 no_charge，后续重试收敛；
//   - RPC 未执行时的降级路径仍是「先流水后改余额」，窗口极小。
// ====================================================================

const RefundInput = z.object({
  chargeIdempotencyKey: z.string().min(1).max(200),
  /** @deprecated 金额一律取 consume 流水，忽略客户端传入值。 */
  amount: z.number().positive().max(10_000).optional(),
  description: z.string().min(1).max(240),
});

export type RefundChargedCreditsResult =
  | { ok: true; refunded: boolean; reason: "refunded" | "no_charge" | "deduped" }
  | { ok: false; error: string };

type RefundReason = "refunded" | "no_charge" | "deduped";

function asRefundReason(value: unknown): RefundReason {
  if (value === "refunded" || value === "no_charge" || value === "deduped") return value;
  return "refunded";
}

/** 优先 RPC（金额=原 consume）；SQL 未执行时降级，仍用流水实扣额而非客户端 amount。 */
export async function executeRefundChargedCredits(opts: {
  supabase: any;
  supabaseAdmin: any;
  userId: string;
  chargeIdempotencyKey: string;
  description: string;
}): Promise<RefundChargedCreditsResult> {
  const { supabase, supabaseAdmin, userId, chargeIdempotencyKey, description } = opts;

  const { data, error } = await supabase.rpc("refund_user_credits_by_key", {
    p_charge_idempotency_key: chargeIdempotencyKey,
    p_description: description,
  });
  if (!error) {
    const row = rpcRow<{ refunded?: boolean; reason?: string }>(data);
    if (!row) return { ok: false, error: "empty refund result" };
    return {
      ok: true,
      refunded: row.refunded === true,
      reason: asRefundReason(row.reason),
    };
  }
  if (!isMissingRpc(error.message)) {
    return { ok: false, error: error.message };
  }

  const { data: chargeRow, error: chargeError } = await supabaseAdmin
    .from("user_credit_transactions")
    .select("id, amount")
    .eq("user_id", userId)
    .eq("idempotency_key", chargeIdempotencyKey)
    .eq("type", "consume")
    .maybeSingle();
  if (chargeError) return { ok: false, error: chargeError.message };
  if (!chargeRow) return { ok: true, refunded: false, reason: "no_charge" };

  const refundAmount = Math.abs(Number(chargeRow.amount) || 0);
  if (refundAmount <= 0) return { ok: true, refunded: false, reason: "no_charge" };

  const refundKey = `refund:${chargeIdempotencyKey}`;
  const { data: wallet } = await supabaseAdmin
    .from("user_wallets")
    .select("credits_balance")
    .eq("user_id", userId)
    .maybeSingle();
  const balanceAfter = Number(wallet?.credits_balance ?? 0) + refundAmount;

  const { error: ledgerError } = await supabaseAdmin.from("user_credit_transactions").insert({
    user_id: userId,
    type: "refund",
    amount: refundAmount,
    balance_after: balanceAfter,
    model: null,
    resolution: null,
    duration: null,
    description,
    idempotency_key: refundKey,
  });
  if (ledgerError) {
    if (/unique|duplicate/i.test(ledgerError.message)) {
      return { ok: true, refunded: false, reason: "deduped" };
    }
    return { ok: false, error: ledgerError.message };
  }

  const { error: walletError } = await supabaseAdmin
    .from("user_wallets")
    .upsert(
      { user_id: userId, credits_balance: balanceAfter, updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );
  if (walletError) {
    await supabaseAdmin
      .from("user_credit_transactions")
      .delete()
      .eq("user_id", userId)
      .eq("idempotency_key", refundKey);
    return { ok: false, error: walletError.message };
  }
  return { ok: true, refunded: true, reason: "refunded" };
}

export const refundChargedCredits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => RefundInput.parse(input))
  .handler(async ({ data, context }): Promise<RefundChargedCreditsResult> => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return executeRefundChargedCredits({
      supabase,
      supabaseAdmin,
      userId,
      chargeIdempotencyKey: data.chargeIdempotencyKey,
      description: data.description,
    });
  });
