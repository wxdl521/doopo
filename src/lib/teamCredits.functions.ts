import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ====================================================================
// Schemas
// ====================================================================

const AllocateCreditsInput = z.object({
  teamId: z.string().uuid(),
  userId: z.string().uuid(),
  amount: z.number().int().positive(),
  description: z.string().max(500).optional(),
});

const ReclaimCreditsInput = z.object({
  teamId: z.string().uuid(),
  userId: z.string().uuid(),
  amount: z.number().int().positive(),
  description: z.string().max(500).optional(),
});

const TransferCreditsInput = z.object({
  teamId: z.string().uuid(),
  toUserId: z.string().uuid(),
  amount: z.number().int().positive(),
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
  memberBalances: Array<{
    userId: string;
    creditsBalance: number;
    subscriptionCredits: number;
  }>;
};

// ====================================================================
// Helper: 计算团队剩余积分（owner 的 credits_balance）
// ====================================================================

async function getTeamRemainingCredits(supabase: any, teamId: string): Promise<number> {
  // 团队剩余积分 = owner 的 credits_balance
  const { data: owner } = await supabase
    .from("team_members")
    .select("credits_balance")
    .eq("team_id", teamId)
    .eq("role", "owner")
    .maybeSingle();

  return owner?.credits_balance ?? 0;
}

// ====================================================================
// allocateCredits — 分配积分给成员（owner/admin）
// 从团队剩余积分（owner balance）扣减，加到目标成员
// ====================================================================

export const allocateCredits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(AllocateCreditsInput)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // 权限检查
    const { data: self } = await supabase
      .from("team_members")
      .select("role")
      .eq("team_id", data.teamId)
      .eq("user_id", userId)
      .maybeSingle();

    if (!self || (self.role !== "owner" && self.role !== "admin")) {
      return { ok: false as const, error: "You do not have permission to allocate credits" };
    }

    // 获取目标成员
    const { data: target } = await supabase
      .from("team_members")
      .select("role, credits_balance")
      .eq("team_id", data.teamId)
      .eq("user_id", data.userId)
      .maybeSingle();

    if (!target) {
      return { ok: false as const, error: "Target member not found" };
    }

    // admin 只能给 member 分配
    if (self.role === "admin" && target.role !== "member") {
      return { ok: false as const, error: "Admin can only allocate credits to members" };
    }

    // 获取 owner 的可用积分（团队池）
    const { data: owner } = await supabase
      .from("team_members")
      .select("credits_balance, user_id")
      .eq("team_id", data.teamId)
      .eq("role", "owner")
      .maybeSingle();

    if (!owner) {
      return { ok: false as const, error: "Team owner not found" };
    }

    if (owner.credits_balance < data.amount) {
      return { ok: false as const, error: "Insufficient team credits" };
    }

    // 原子操作：扣减 owner 积分
    const { error: deductError } = await supabase
      .from("team_members")
      .update({ credits_balance: owner.credits_balance - data.amount })
      .eq("team_id", data.teamId)
      .eq("user_id", owner.user_id);

    if (deductError) {
      return { ok: false as const, error: deductError.message };
    }

    // 增加目标成员积分
    const newBalance = target.credits_balance + data.amount;
    const { error: addError } = await supabase
      .from("team_members")
      .update({ credits_balance: newBalance })
      .eq("team_id", data.teamId)
      .eq("user_id", data.userId);

    if (addError) {
      // 回滚 owner
      await supabase
        .from("team_members")
        .update({ credits_balance: owner.credits_balance })
        .eq("team_id", data.teamId)
        .eq("user_id", owner.user_id);
      return { ok: false as const, error: addError.message };
    }

    // 写流水
    await supabase.from("credit_transactions").insert({
      team_id: data.teamId,
      user_id: data.userId,
      type: "allocate",
      amount: data.amount,
      balance_after: newBalance,
      operator_id: userId,
      source_type: "recharge",
      description: data.description ?? "积分分配",
    });

    return { ok: true as const, newBalance };
  });

// ====================================================================
// reclaimCredits — 回收成员积分（owner/admin）
// ====================================================================

export const reclaimCredits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(ReclaimCreditsInput)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // 权限检查
    const { data: self } = await supabase
      .from("team_members")
      .select("role")
      .eq("team_id", data.teamId)
      .eq("user_id", userId)
      .maybeSingle();

    if (!self || (self.role !== "owner" && self.role !== "admin")) {
      return { ok: false as const, error: "You do not have permission to reclaim credits" };
    }

    // 获取目标成员
    const { data: target } = await supabase
      .from("team_members")
      .select("role, credits_balance")
      .eq("team_id", data.teamId)
      .eq("user_id", data.userId)
      .maybeSingle();

    if (!target) {
      return { ok: false as const, error: "Target member not found" };
    }

    if (self.role === "admin" && target.role !== "member") {
      return { ok: false as const, error: "Admin can only reclaim credits from members" };
    }

    if (target.credits_balance < data.amount) {
      return { ok: false as const, error: "Member has insufficient credits to reclaim" };
    }

    // 获取 owner
    const { data: owner } = await supabase
      .from("team_members")
      .select("credits_balance, user_id")
      .eq("team_id", data.teamId)
      .eq("role", "owner")
      .maybeSingle();

    if (!owner) {
      return { ok: false as const, error: "Team owner not found" };
    }

    // 扣减目标成员积分
    const newMemberBalance = target.credits_balance - data.amount;
    const { error: deductError } = await supabase
      .from("team_members")
      .update({ credits_balance: newMemberBalance })
      .eq("team_id", data.teamId)
      .eq("user_id", data.userId);

    if (deductError) {
      return { ok: false as const, error: deductError.message };
    }

    // 归还到 owner
    const newOwnerBalance = owner.credits_balance + data.amount;
    const { error: addError } = await supabase
      .from("team_members")
      .update({ credits_balance: newOwnerBalance })
      .eq("team_id", data.teamId)
      .eq("user_id", owner.user_id);

    if (addError) {
      // 回滚
      await supabase
        .from("team_members")
        .update({ credits_balance: target.credits_balance })
        .eq("team_id", data.teamId)
        .eq("user_id", data.userId);
      return { ok: false as const, error: addError.message };
    }

    // 写流水
    await supabase.from("credit_transactions").insert({
      team_id: data.teamId,
      user_id: data.userId,
      type: "reclaim",
      amount: -data.amount,
      balance_after: newMemberBalance,
      operator_id: userId,
      source_type: "recharge",
      description: data.description ?? "积分回收",
    });

    return { ok: true as const, newBalance: newMemberBalance };
  });

// ====================================================================
// transferCredits — 成员间转账
// ====================================================================

export const transferCredits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(TransferCreditsInput)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    if (data.toUserId === userId) {
      return { ok: false as const, error: "Cannot transfer credits to yourself" };
    }

    // 获取转出方
    const { data: fromMember } = await supabase
      .from("team_members")
      .select("credits_balance")
      .eq("team_id", data.teamId)
      .eq("user_id", userId)
      .maybeSingle();

    if (!fromMember) {
      return { ok: false as const, error: "You are not a member of this team" };
    }

    if (fromMember.credits_balance < data.amount) {
      return { ok: false as const, error: "Insufficient credits" };
    }

    // 获取转入方
    const { data: toMember } = await supabase
      .from("team_members")
      .select("credits_balance")
      .eq("team_id", data.teamId)
      .eq("user_id", data.toUserId)
      .maybeSingle();

    if (!toMember) {
      return { ok: false as const, error: "Target member not found in this team" };
    }

    const fromNewBalance = fromMember.credits_balance - data.amount;
    const toNewBalance = toMember.credits_balance + data.amount;

    // 扣减转出方
    const { error: fromError } = await supabase
      .from("team_members")
      .update({ credits_balance: fromNewBalance })
      .eq("team_id", data.teamId)
      .eq("user_id", userId);

    if (fromError) {
      return { ok: false as const, error: fromError.message };
    }

    // 增加转入方
    const { error: toError } = await supabase
      .from("team_members")
      .update({ credits_balance: toNewBalance })
      .eq("team_id", data.teamId)
      .eq("user_id", data.toUserId);

    if (toError) {
      // 回滚
      await supabase
        .from("team_members")
        .update({ credits_balance: fromMember.credits_balance })
        .eq("team_id", data.teamId)
        .eq("user_id", userId);
      return { ok: false as const, error: toError.message };
    }

    // 写两条 transaction
    await supabase.from("credit_transactions").insert([
      {
        team_id: data.teamId,
        user_id: userId,
        type: "transfer_out",
        amount: -data.amount,
        balance_after: fromNewBalance,
        operator_id: userId,
        source_type: "recharge",
        description: data.description ?? `转账给成员`,
      },
      {
        team_id: data.teamId,
        user_id: data.toUserId,
        type: "transfer_in",
        amount: data.amount,
        balance_after: toNewBalance,
        operator_id: userId,
        source_type: "recharge",
        description: data.description ?? `收到转账`,
      },
    ]);

    // 写 transfer_record
    await supabase.from("transfer_records").insert({
      team_id: data.teamId,
      from_user_id: userId,
      to_user_id: data.toUserId,
      amount: data.amount,
      from_balance_after: fromNewBalance,
      to_balance_after: toNewBalance,
      operator_id: userId,
    });

    return { ok: true as const, fromNewBalance, toNewBalance };
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
// depositCredits — 转入团队池（owner/admin 从个人余额扣除）
// ====================================================================

export const depositCredits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    z.object({
      teamId: z.string().uuid(),
      amount: z.number().int().min(1),
    }),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { teamId, amount } = data;

    const { data: member, error: memberError } = await supabase
      .from("team_members")
      .select("role, credits_balance")
      .eq("team_id", teamId)
      .eq("user_id", userId)
      .single();

    if (memberError || !member) return { ok: false as const, error: "您不是该团队的成员" };
    if (member.role !== "owner" && member.role !== "admin")
      return { ok: false as const, error: "仅所有者和管理员可转入积分" };
    if (member.credits_balance < amount) return { ok: false as const, error: "积分不足" };

    const newBalance = member.credits_balance - amount;
    const { error: updateError } = await supabase
      .from("team_members")
      .update({ credits_balance: newBalance })
      .eq("team_id", teamId)
      .eq("user_id", userId);

    if (updateError) return { ok: false as const, error: updateError.message };

    await supabase.from("credit_transactions").insert({
      team_id: teamId,
      user_id: userId,
      type: "deposit",
      amount: -amount,
      balance_after: newBalance,
      operator_id: userId,
      source_type: "recharge",
      description: `转入团队池 ${amount} 积分`,
    });

    return { ok: true as const, newBalance };
  });

// ====================================================================
// getTeamBalance — 查询团队余额（剩余积分 + 各成员余额）
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
    const totalCredits = owner?.credits_balance ?? 0;

    const memberBalances = (members ?? []).map((m: any) => ({
      userId: m.user_id,
      creditsBalance: m.credits_balance,
      subscriptionCredits: m.subscription_credits,
    }));

    return {
      balance: {
        teamId: data.teamId,
        totalCredits,
        memberBalances,
      },
      error: null as string | null,
    };
  });
