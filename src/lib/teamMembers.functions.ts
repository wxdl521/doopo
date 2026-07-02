import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ====================================================================
// Schemas
// ====================================================================

const TeamIdInput = z.object({
  teamId: z.string().uuid(),
});

const UpdateRoleInput = z.object({
  teamId: z.string().uuid(),
  userId: z.string().uuid(),
  role: z.enum(["admin", "member"]),
});

const RemoveMemberInput = z.object({
  teamId: z.string().uuid(),
  userId: z.string().uuid(),
});

const LeaveTeamInput = z.object({
  teamId: z.string().uuid(),
});

const InviteMemberInput = z.object({
  teamId: z.string().uuid(),
});

const JoinTeamInput = z.object({
  teamId: z.string().uuid(),
});

// ====================================================================
// Types
// ====================================================================

export type MemberRow = {
  id: string;
  teamId: string;
  userId: string;
  role: "owner" | "admin" | "member";
  creditsBalance: number;
  subscriptionCredits: number;
  joinedAt: string;
  invitedBy: string | null;
  // 以下字段通过 join users 表获取
  email?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
};

// ====================================================================
// getTeamMembers — 查询团队成员列表
// ====================================================================

export const getTeamMembers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(TeamIdInput)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // 先确认当前用户是团队成员
    const { data: self } = await supabase
      .from("team_members")
      .select("role")
      .eq("team_id", data.teamId)
      .eq("user_id", userId)
      .maybeSingle();

    if (!self) {
      return { members: [] as MemberRow[], error: "You are not a member of this team" };
    }

    // 查询成员列表（通过 supabase 关联获取用户邮箱等基本信息）
    const { data: members, error } = await supabase
      .from("team_members")
      .select(
        `
        id,
        team_id,
        user_id,
        role,
        credits_balance,
        subscription_credits,
        joined_at,
        invited_by
      `,
      )
      .eq("team_id", data.teamId)
      .order("joined_at", { ascending: true });

    if (error) {
      return { members: [] as MemberRow[], error: error.message };
    }

    // 批量获取用户 profile 信息
    const userIds = (members ?? []).map((m: any) => m.user_id);
    const userProfiles: Map<string, any> = new Map();

    if (userIds.length > 0) {
      try {
        // 通过 RPC 函数查询 auth.users（SECURITY DEFINER，需先在 Supabase 创建函数）
        const { data: users } = await supabase.rpc(
          "get_team_member_profiles",
          { p_user_ids: userIds },
        );
        if (users && Array.isArray(users)) {
          for (const u of users) {
            const meta = (u.raw_user_meta_data ?? {}) as Record<string, any>;
            userProfiles.set(u.user_id, {
              email: u.email ?? null,
              displayName:
                meta.display_name ?? meta.full_name ?? meta.name ?? null,
            });
          }
        }
      } catch {
        // RPC 函数尚未创建时降级处理，成员列表照常返回
      }
    }

    const result: MemberRow[] = (members ?? []).map((m: any) => ({
      id: m.id,
      teamId: m.team_id,
      userId: m.user_id,
      role: m.role,
      creditsBalance: m.credits_balance,
      subscriptionCredits: m.subscription_credits,
      joinedAt: m.joined_at,
      invitedBy: m.invited_by,
      email: userProfiles.get(m.user_id)?.email ?? null,
      displayName: userProfiles.get(m.user_id)?.displayName ?? null,
      avatarUrl: userProfiles.get(m.user_id)?.avatarUrl ?? null,
    }));

    return { members: result, error: null as string | null };
  });

// ====================================================================
// updateMemberRole — 修改成员角色（仅 owner/admin）
// ====================================================================

export const updateMemberRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(UpdateRoleInput)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // 获取当前用户的角色
    const { data: self } = await supabase
      .from("team_members")
      .select("role")
      .eq("team_id", data.teamId)
      .eq("user_id", userId)
      .maybeSingle();

    if (!self) {
      return { ok: false as const, error: "You are not a member of this team" };
    }

    // 获取目标成员信息
    const { data: target } = await supabase
      .from("team_members")
      .select("role")
      .eq("team_id", data.teamId)
      .eq("user_id", data.userId)
      .maybeSingle();

    if (!target) {
      return { ok: false as const, error: "Target member not found" };
    }

    // 权限检查
    if (self.role !== "owner" && self.role !== "admin") {
      return { ok: false as const, error: "You do not have permission to change roles" };
    }
    if (target.role === "owner") {
      return { ok: false as const, error: "Cannot change the owner role" };
    }
    if (self.role === "admin" && target.role === "admin") {
      return { ok: false as const, error: "Admin cannot change another admin role" };
    }

    const { error } = await supabase
      .from("team_members")
      .update({ role: data.role })
      .eq("team_id", data.teamId)
      .eq("user_id", data.userId);

    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  });

// ====================================================================
// removeMember — 移除成员（owner 可移任何人，admin 只可移 member）
// ====================================================================

export const removeMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(RemoveMemberInput)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // 获取目标成员信息
    const { data: target } = await supabase
      .from("team_members")
      .select("role, credits_balance")
      .eq("team_id", data.teamId)
      .eq("user_id", data.userId)
      .maybeSingle();

    if (!target) {
      return { ok: false as const, error: "Member not found" };
    }

    if (target.role === "owner") {
      return { ok: false as const, error: "Cannot remove the team owner" };
    }

    // 获取操作者角色
    const { data: self } = await supabase
      .from("team_members")
      .select("role")
      .eq("team_id", data.teamId)
      .eq("user_id", userId)
      .maybeSingle();

    if (!self) {
      return { ok: false as const, error: "You are not a member of this team" };
    }

    // admin 只能移除 member
    if (self.role === "admin" && target.role !== "member") {
      return { ok: false as const, error: "Admin can only remove members" };
    }
    if (self.role === "member") {
      return { ok: false as const, error: "You do not have permission to remove members" };
    }

    // 如果被移除的成员还有积分，先回收
    if (target.credits_balance > 0) {
      await supabase.from("credit_transactions").insert({
        team_id: data.teamId,
        user_id: data.userId,
        type: "reclaim",
        amount: -target.credits_balance,
        balance_after: 0,
        operator_id: userId,
        source_type: "recharge",
        description: "成员被移出团队，积分回收",
      });
    }

    // 移除成员
    const { error } = await supabase
      .from("team_members")
      .delete()
      .eq("team_id", data.teamId)
      .eq("user_id", data.userId);

    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  });

// ====================================================================
// leaveTeam — 离开团队（非 owner 成员）
// ====================================================================

export const leaveTeam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(LeaveTeamInput)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // 检查是否为 owner
    const { data: self } = await supabase
      .from("team_members")
      .select("role, credits_balance")
      .eq("team_id", data.teamId)
      .eq("user_id", userId)
      .maybeSingle();

    if (!self) {
      return { ok: false as const, error: "You are not a member of this team" };
    }

    if (self.role === "owner") {
      return {
        ok: false as const,
        error: "Owner cannot leave the team. Dissolve the team instead.",
      };
    }

    // 如果还有积分，回收
    if (self.credits_balance > 0) {
      await supabase.from("credit_transactions").insert({
        team_id: data.teamId,
        user_id: userId,
        type: "reclaim",
        amount: -self.credits_balance,
        balance_after: 0,
        operator_id: userId,
        source_type: "recharge",
        description: "成员离开团队，积分回收",
      });
    }

    const { error } = await supabase
      .from("team_members")
      .delete()
      .eq("team_id", data.teamId)
      .eq("user_id", userId);

    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  });

// ====================================================================
// inviteToTeam — 生成邀请链接（owner/admin）
// ====================================================================

export const inviteToTeam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(InviteMemberInput)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // 确认操作者权限
    const { data: self } = await supabase
      .from("team_members")
      .select("role")
      .eq("team_id", data.teamId)
      .eq("user_id", userId)
      .maybeSingle();

    if (!self || (self.role !== "owner" && self.role !== "admin")) {
      return { ok: false as const, error: "You do not have permission to invite members" };
    }

    // 生成邀请 token（使用简单的 UUID + 团队 ID）
    const { data: token, error } = await (supabase.rpc as any)(
      "generate_team_invite_token",
      { p_team_id: data.teamId },
    );

    if (error) {
      // 如果 RPC 不存在，用简单方案：返回 teamId
      const inviteUrl = `${process.env.APP_URL ?? ""}/team/${data.teamId}/join`;
      return { ok: true as const, inviteUrl };
    }

    const inviteUrl = `${process.env.APP_URL ?? ""}/team/join?token=${token}`;
    return { ok: true as const, inviteUrl };
  });

// ====================================================================
// joinTeam — 通过邀请加入团队
// ====================================================================

export const joinTeam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(JoinTeamInput)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // 检查是否已在团队中
    const { data: existing } = await supabase
      .from("team_members")
      .select("id")
      .eq("team_id", data.teamId)
      .eq("user_id", userId)
      .maybeSingle();

    if (existing) {
      return { ok: false as const, error: "You are already a member of this team" };
    }

    // 尝试加入团队（FK 约束会自动校验团队是否存在，无需单独查询 teams 表）
    const { error } = await supabase.from("team_members").insert({
      team_id: data.teamId,
      user_id: userId,
      role: "member",
    });

    if (error) {
      // 外键约束违反 → 团队不存在或已删除
      if (error.code === "23503" || error.message?.includes("foreign key")) {
        return { ok: false as const, error: "Team not found" };
      }
      // 唯一约束违反 → 已是成员（并发场景）
      if (error.code === "23505") {
        return { ok: false as const, error: "You are already a member of this team" };
      }
      return { ok: false as const, error: error.message };
    }

    return { ok: true as const };
  });
