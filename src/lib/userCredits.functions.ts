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
      return { transactions: [] as UserCreditTransactionRow[], error: error.message, hasProjectColumns };
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
//   - 只退已扣的：先核对本人流水里存在该幂等键的 consume 记录，未扣不退；
//   - 退款流水以 `refund:{chargeKey}` 为幂等键，库级唯一索引防并发/重复退款；
//   - 验证用 supabaseAdmin 读本人流水（RLS 下用户态也读得到，admin 只为与
//     写入同通道）；加余额走 admin upsert（add_user_credits 已撤销
//     authenticated 执行权，且其内部 auth.uid() 对 service role 为 null 不可用）。
//
// 一致性边界（已在回归中接受的取舍，见迁移 20260804230000 的幂等设计）：
//   - 滞后入账：断连的服务端扣费可能晚于退款请求到账——此时查不到 consume
//     记录，本轮返回 no_charge 不退；调用方稍后重试即可收敛（幂等键保证
//     不会退两次），流水里 consume/refund 两条记录可对账；
//   - 非原子窗口：先写退款流水再补余额，两步之间崩溃会漏补余额（流水已记）。
//     不加新 RPC（避免新建 DB 函数），窗口极小且流水可对账，接受该边界。
// ====================================================================

const RefundInput = z.object({
  chargeIdempotencyKey: z.string().min(1).max(200),
  amount: z.number().positive().max(10_000),
  description: z.string().min(1).max(240),
});

export type RefundChargedCreditsResult =
  | { ok: true; refunded: boolean; reason: "refunded" | "no_charge" | "deduped" }
  | { ok: false; error: string };

export const refundChargedCredits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => RefundInput.parse(input))
  .handler(async ({ data, context }): Promise<RefundChargedCreditsResult> => {
    const { userId } = context as { supabase: any; userId: string };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // 只退已扣的：本人流水里必须存在该幂等键的 consume 记录。
    const { data: chargeRow, error: chargeError } = await supabaseAdmin
      .from("user_credit_transactions")
      .select("id, amount")
      .eq("user_id", userId)
      .eq("idempotency_key", data.chargeIdempotencyKey)
      .eq("type", "consume")
      .maybeSingle();
    if (chargeError) return { ok: false, error: chargeError.message };
    if (!chargeRow) return { ok: true, refunded: false, reason: "no_charge" };

    const refundKey = `refund:${data.chargeIdempotencyKey}`;
    const { data: wallet } = await supabaseAdmin
      .from("user_wallets")
      .select("credits_balance")
      .eq("user_id", userId)
      .maybeSingle();
    const balanceAfter = Number(wallet?.credits_balance ?? 0) + data.amount;

    // 退款流水先行登记（幂等键唯一索引兜底并发与重复调用）。
    const { error: ledgerError } = await supabaseAdmin.from("user_credit_transactions").insert({
      user_id: userId,
      type: "refund",
      amount: data.amount,
      balance_after: balanceAfter,
      model: null,
      resolution: null,
      duration: null,
      description: data.description,
      idempotency_key: refundKey,
    });
    if (ledgerError) {
      if (/unique|duplicate/i.test(ledgerError.message)) {
        return { ok: true, refunded: false, reason: "deduped" };
      }
      return { ok: false, error: ledgerError.message };
    }

    // 余额回补；失败时补偿删除流水，允许重试（best-effort 原子性）。
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
  });
