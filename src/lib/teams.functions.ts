import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ====================================================================
// Schemas
// ====================================================================

const CreateTeamInput = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  credits: z.number().int().min(0).max(99999999).optional(),
});

const UpdateTeamInput = z.object({
  teamId: z.string().uuid(),
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
});

const TeamIdInput = z.object({
  teamId: z.string().uuid(),
});

// ====================================================================
// Types
// ====================================================================

export type TeamRow = {
  id: string;
  name: string;
  description: string | null;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type TeamMemberRow = {
  id: string;
  teamId: string;
  userId: string;
  role: "owner" | "admin" | "member";
  creditsBalance: number;
  subscriptionCredits: number;
  joinedAt: string;
  invitedBy: string | null;
};

// ====================================================================
// createTeam — 创建团队，同时将创建者加入为 owner
// ====================================================================

export const createTeam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(CreateTeamInput)
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    // 新团队尚无成员，直接 INSERT owner 会触发 team_members 的 RLS。
    // 该 RPC 在数据库内以 auth.uid() 为创建者原子完成 teams + owner member，
    // 不需要也不应在应用环境配置 service role key。
    const { data: teamId, error } = await (supabase as any).rpc("create_team_as_owner", {
      p_name: data.name,
      p_description: data.description ?? null,
      p_credits: data.credits ?? 0,
    });

    if (error || !teamId) {
      return {
        ok: false as const,
        error:
          error?.message ??
          "创建团队初始化失败；请确认管理员已执行 create_team_as_owner 数据库函数。",
      };
    }

    return { ok: true as const, teamId: String(teamId) };
  });

// ====================================================================
// getMyTeams — 查询当前用户的所有团队
// ====================================================================

export const getMyTeams = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({}).optional())
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    // 通过 team_members 关联查询团队
    const { data: memberships, error } = await supabase
      .from("team_members")
      .select(
        `
        role,
        credits_balance,
        subscription_credits,
        joined_at,
        team:teams (
          id,
          name,
          description,
          owner_id,
          deleted_at,
          created_at,
          updated_at
        )
      `,
      )
      .eq("user_id", userId)
      .order("joined_at", { ascending: false });

    if (error) {
      return { teams: [] as any[], error: error.message };
    }

    const teams = (memberships ?? [])
      .filter((m: any) => m.team != null && m.team.deleted_at == null)
      .map((m: any) => ({
        id: m.team.id,
        name: m.team.name,
        description: m.team.description,
        ownerId: m.team.owner_id,
        createdAt: m.team.created_at,
        updatedAt: m.team.updated_at,
        role: m.role,
        creditsBalance: m.credits_balance,
        subscriptionCredits: m.subscription_credits,
        joinedAt: m.joined_at,
      }));

    return { teams, error: null as string | null };
  });

// ====================================================================
// getTeamDetail — 查询团队详情（需为团队成员）
// ====================================================================

export const getTeamDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(TeamIdInput)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // 先查团队
    const { data: team, error: teamError } = await supabase
      .from("teams")
      .select("id, name, description, owner_id, created_at, updated_at, deleted_at")
      .eq("id", data.teamId)
      .is("deleted_at", null)
      .single();

    if (teamError || !team) {
      return { team: null, error: teamError?.message ?? "Team not found" };
    }

    // 再查当前用户在团队中的角色
    const { data: membership } = await supabase
      .from("team_members")
      .select("role, credits_balance, subscription_credits, joined_at")
      .eq("team_id", data.teamId)
      .eq("user_id", userId)
      .maybeSingle();

    return {
      team: {
        id: team.id,
        name: team.name,
        description: team.description,
        ownerId: team.owner_id,
        createdAt: team.created_at,
        updatedAt: team.updated_at,
        deletedAt: team.deleted_at,
      },
      myRole: (membership?.role ?? null) as "owner" | "admin" | "member" | null,
      myCreditsBalance: membership?.credits_balance ?? 0,
      error: null as string | null,
    };
  });

// ====================================================================
// updateTeam — 更新团队信息（仅 owner）
// ====================================================================

export const updateTeam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(UpdateTeamInput)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const updates: { name?: string; description?: string | null } = {};
    if (data.name !== undefined) updates.name = data.name;
    if (data.description !== undefined) updates.description = data.description;

    if (Object.keys(updates).length === 0) {
      return { ok: false as const, error: "Nothing to update" };
    }

    const { error } = await supabase
      .from("teams")
      .update(updates)
      .eq("id", data.teamId)
      .eq("owner_id", userId);

    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  });

// ====================================================================
// deleteTeam — 解散团队（仅 owner，软删除 + 退款）
// ====================================================================

export const deleteTeam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(TeamIdInput)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // 调用 Supabase Function 执行解散 + 退款
    const { error } = await supabase.rpc("dissolve_team_with_refund", {
      p_team_id: data.teamId,
    });

    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  });

// ====================================================================
// getTeamJoinInfo — 通过邀请链接查看团队信息（绕过 RLS，允许非成员查看）
// ====================================================================

export const getTeamJoinInfo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(TeamIdInput)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Use SECURITY DEFINER RPC so non-members can still see basic team info
    // (name/description) on the join page without opening SELECT on teams.
    const { data: rows, error: teamError } = await (supabase.rpc as any)(
      "get_team_public_info",
      { p_team_id: data.teamId },
    );
    const team = Array.isArray(rows) ? rows[0] : rows;
    if (teamError || !team) {
      return {
        team: null,
        isMember: false,
        error: "Team not found",
      };
    }

    // 检查当前用户是否已是成员
    const { data: membership } = await supabase
      .from("team_members")
      .select("id")
      .eq("team_id", data.teamId)
      .eq("user_id", userId)
      .maybeSingle();

    return {
      team: {
        id: team.id,
        name: team.name,
        description: team.description,
        ownerId: team.owner_id,
        createdAt: team.created_at,
      },
      isMember: !!membership,
      error: null as string | null,
    };
  });
