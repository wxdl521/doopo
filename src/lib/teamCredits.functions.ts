import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ====================================================================
// Schemas
// ====================================================================

const AllocateCreditsInput = z.object({
  teamId: z.string().uuid(),
  userId: z.string().uuid(),
  amount: z.number().positive(),
  description: z.string().max(500).optional(),
});

const ReclaimCreditsInput = z.object({
  teamId: z.string().uuid(),
  userId: z.string().uuid(),
  amount: z.number().positive(),
  description: z.string().max(500).optional(),
});

const TransferCreditsInput = z.object({
  teamId: z.string().uuid(),
  toUserId: z.string().uuid(),
  amount: z.number().positive(),
  description: z.string().max(500).optional(),
});

const TeamIdQuery = z.object({
  teamId: z.string().uuid(),
});

const TransactionQuery = z.object({
  teamId: z.string().uuid(),
  limit: z.number().int().min(1).max(100).optional().default(20),
  offset: z.number().int().min(0).optional().default(0),
  userId: z.string().uuid().optional(),
});

// ====================================================================
// Types
// ====================================================================

export type TransactionRow = {
  id: string;
  teamId: string;
  userId: string;
  type: "allocate" | "reclaim" | "transfer_in" | "transfer_out" | "consume" | "refund";
  amount: number;
  balanceAfter: number | null;
  operatorId: string | null;
  sourceType: "recharge" | "subscription";
  description: string | null;
  createdAt: string;
};

export type TransferRow = {
  id: string;
  teamId: string;
  fromUserId: string;
  toUserId: string;
  amount: number;
  fromBalanceAfter: number | null;
  toBalanceAfter: number | null;
  operatorId: string | null;
  createdAt: string;
};

export type TeamBalance = {
  teamId: string;
  totalCredits: number;
  ownerCredits: number;
  memberBalances: Array<{
    userId: string;
    creditsBalance: number;
    subscriptionCredits: number;
  }>;
};

// ====================================================================
// allocateCredits — 分配积分给成员（owner/admin）
// 从所有者的个人积分转给目标成员；数据库 RPC 会同步两人的团队余额。
// ====================================================================

export const allocateCredits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(AllocateCreditsInput)
  .handler(async ({ data, context }) => {
    const { data: result, error } = await (context.supabase.rpc as any)("allocate_team_credits", {
      p_team_id: data.teamId,
      p_user_id: data.userId,
      p_amount: data.amount,
      p_description: data.description ?? null,
    });

    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const, newBalance: Number(result ?? 0) };
  });

// ====================================================================
// reclaimCredits — 回收成员积分（owner/admin）
// ====================================================================

export const reclaimCredits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(ReclaimCreditsInput)
  .handler(async ({ data, context }) => {
    const { data: result, error } = await (context.supabase.rpc as any)("reclaim_team_credits", {
      p_team_id: data.teamId,
      p_user_id: data.userId,
      p_amount: data.amount,
      p_description: data.description ?? null,
    });

    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const, newBalance: Number(result ?? 0) };
  });

// ====================================================================
// transferCredits — 成员间转账
// ====================================================================

export const transferCredits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(TransferCreditsInput)
  .handler(async ({ data, context }) => {
    const { data: result, error } = await (context.supabase.rpc as any)("transfer_team_credits", {
      p_team_id: data.teamId,
      p_to_user_id: data.toUserId,
      p_amount: data.amount,
      p_description: data.description ?? null,
    });

    if (error) return { ok: false as const, error: error.message };
    const row = Array.isArray(result) ? result[0] : result;
    return {
      ok: true as const,
      fromNewBalance: Number(row?.from_new_balance ?? 0),
      toNewBalance: Number(row?.to_new_balance ?? 0),
    };
  });

// ====================================================================
// getCreditTransactions — 查询积分流水
// ====================================================================

export const getCreditTransactions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(TransactionQuery)
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    let query = supabase
      .from("credit_transactions")
      .select("*")
      .eq("team_id", data.teamId)
      .order("created_at", { ascending: false })
      .range(data.offset, data.offset + data.limit - 1);

    if (data.userId) {
      query = query.eq("user_id", data.userId);
    }

    const { data: transactions, error } = await query;

    if (error) {
      return { transactions: [] as TransactionRow[], error: error.message };
    }

    const result: TransactionRow[] = (transactions ?? []).map((t: any) => ({
      id: t.id,
      teamId: t.team_id,
      userId: t.user_id,
      type: t.type,
      amount: t.amount,
      balanceAfter: t.balance_after,
      operatorId: t.operator_id,
      sourceType: t.source_type,
      description: t.description,
      createdAt: t.created_at,
    }));

    return { transactions: result, error: null as string | null };
  });

// ====================================================================
// getTransferRecords — 查询转账记录
// ====================================================================

export const getTransferRecords = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(TeamIdQuery)
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const { data: records, error } = await supabase
      .from("transfer_records")
      .select("*")
      .eq("team_id", data.teamId)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      return { records: [] as TransferRow[], error: error.message };
    }

    const result: TransferRow[] = (records ?? []).map((r: any) => ({
      id: r.id,
      teamId: r.team_id,
      fromUserId: r.from_user_id,
      toUserId: r.to_user_id,
      amount: r.amount,
      fromBalanceAfter: r.from_balance_after,
      toBalanceAfter: r.to_balance_after,
      operatorId: r.operator_id,
      createdAt: r.created_at,
    }));

    return { records: result, error: null as string | null };
  });

// ====================================================================
// getTeamBalance — 团队剩余积分为所有在籍成员个人可用积分之和。
// ====================================================================

export const getTeamBalance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(TeamIdQuery)
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const { data: members, error } = await supabase
      .from("team_members")
      .select("user_id, credits_balance, subscription_credits, role")
      .eq("team_id", data.teamId);

    if (error) {
      return { balance: null, error: error.message };
    }

    const owner = (members ?? []).find((m: any) => m.role === "owner");
    const totalCredits = (members ?? []).reduce(
      (total: number, member: any) => total + Number(member.credits_balance ?? 0),
      0,
    );

    const memberBalances = (members ?? []).map((m: any) => ({
      userId: m.user_id,
      creditsBalance: Number(m.credits_balance ?? 0),
      subscriptionCredits: Number(m.subscription_credits ?? 0),
    }));

    return {
      balance: {
        teamId: data.teamId,
        totalCredits,
        ownerCredits: Number(owner?.credits_balance ?? 0),
        memberBalances,
      },
      error: null as string | null,
    };
  });
