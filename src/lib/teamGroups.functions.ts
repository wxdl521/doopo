import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// ====================================================================
// 团队分组(team_groups)server functions
//
// 权限模型(对齐生产 SQL 的 RLS):
//   - Team owner:建/删/改组、指派/改派组长、任意成员入/出组、指派项目到组
//       -> 用用户态 context.supabase(RLS 已允许 owner)
//   - 组长(team_groups.admin_id = 当前用户):管理【本组】成员、指派项目到本组
//       -> 用 service-role supabaseAdmin + 应用层校验 admin_id = userId
//       (生产 RLS 没给组长单独的 team_members/projects 写权限,组长若是 member
//        角色会被 RLS 挡,故必须在应用层校验后用 service role 写)
//   - 组员:查看本组项目、协作编辑(RLS 已通过 is_in_same_group 允许)
// ====================================================================

// ---------- Schemas ----------

const TeamIdInput = z.object({ teamId: z.string().uuid() });

const CreateGroupInput = z.object({
  teamId: z.string().uuid(),
  name: z.string().min(1).max(50),
  adminId: z.string().uuid().optional(),
});

const UpdateGroupInput = z.object({
  groupId: z.string().uuid(),
  name: z.string().min(1).max(50).optional(),
  // null = 解除组长;undefined = 不改
  adminId: z.string().uuid().nullable().optional(),
});

const GroupIdInput = z.object({ groupId: z.string().uuid() });

const AssignMemberInput = z.object({
  teamId: z.string().uuid(),
  groupId: z.string().uuid(),
  userId: z.string().uuid(),
});

const RemoveMemberFromGroupInput = z.object({
  teamId: z.string().uuid(),
  userId: z.string().uuid(),
});

const AssignProjectInput = z.object({
  projectId: z.string().min(1).max(64),
  groupId: z.string().uuid(),
});

const UnassignProjectInput = z.object({
  projectId: z.string().min(1).max(64),
});

// ---------- Types ----------

export type TeamGroupRow = {
  id: string;
  teamId: string;
  name: string;
  adminId: string | null;
  createdAt: string;
  memberCount: number;
  projectCount: number;
  adminEmail: string | null;
  adminDisplayName: string | null;
  // 当前用户视角
  isMyGroup: boolean; // 当前用户是否在该组
  isMyAdminGroup: boolean; // 当前用户是否为该组组长
};

export type GroupMemberRow = {
  id: string;
  userId: string;
  role: "owner" | "admin" | "member";
  creditsBalance: number;
  joinedAt: string;
  email: string | null;
  displayName: string | null;
};

export type GroupProjectRow = {
  id: string;
  name: string;
  customCover: string | null;
  updatedAt: string;
  ownerId: string;
};

// ---------- Helpers ----------

/** 取团队成员的 profile(邮箱/昵称),通过 SECURITY DEFINER RPC 读 auth.users */
async function fetchProfiles(
  supabase: any,
  userIds: string[],
): Promise<Map<string, { email: string | null; displayName: string | null }>> {
  const map = new Map<string, { email: string | null; displayName: string | null }>();
  if (userIds.length === 0) return map;
  try {
    const { data: users } = await supabase.rpc("get_team_member_profiles", {
      p_user_ids: userIds,
    });
    if (Array.isArray(users)) {
      for (const u of users) {
        const meta = (u.raw_user_meta_data ?? {}) as Record<string, any>;
        map.set(u.user_id, {
          email: u.email ?? null,
          displayName: meta.display_name ?? meta.full_name ?? meta.name ?? null,
        });
      }
    }
  } catch {
    // RPC 不存在时降级,仅返回空 profile
  }
  return map;
}

/**
 * 校验当前用户能否管理某个组:
 *   owner 可管理任意组;组长只能管理 admin_id = 自己 的组。
 *   返回 teamId(供后续校验目标是否同团队)。
 */
async function assertCanManageGroup(
  supabase: any,
  userId: string,
  groupId: string,
): Promise<{ ok: true; teamId: string } | { ok: false; error: string }> {
  // RLS: 团队成员能看到组(team_groups_select = is_in_team)
  const { data: group } = await supabase
    .from("team_groups")
    .select("team_id, admin_id")
    .eq("id", groupId)
    .maybeSingle();
  if (!group) return { ok: false, error: "Group not found" };

  const { data: self } = await supabase
    .from("team_members")
    .select("role")
    .eq("team_id", group.team_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!self) return { ok: false, error: "You are not a member of this team" };
  if (self.role === "owner") return { ok: true, teamId: group.team_id };
  if (group.admin_id === userId) return { ok: true, teamId: group.team_id };
  return { ok: false, error: "Only the owner or this group's admin can manage the group" };
}

// ====================================================================
// listGroups - 列出团队内所有组(团队成员可见)
// ====================================================================

export const listGroups = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(TeamIdInput)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // RLS: 仅团队成员能看到组
    const { data: groups, error } = await supabase
      .from("team_groups")
      .select("id, team_id, name, admin_id, created_at")
      .eq("team_id", data.teamId)
      .order("created_at", { ascending: true });
    if (error) return { groups: [] as TeamGroupRow[], error: error.message };
    if (!groups || groups.length === 0) return { groups: [], error: null as string | null };

    // 当前用户的 group_id / 角色(用于标记 isMyGroup / isMyAdminGroup)
    const { data: self } = await supabase
      .from("team_members")
      .select("group_id, role")
      .eq("team_id", data.teamId)
      .eq("user_id", userId)
      .maybeSingle();
    const myGroupId = self?.group_id ?? null;

    // 用用户态 client 统计成员数 / 项目数(RLS 过滤:团队成员可见所有 team_members,
    // 项目按可见性返回--owner/admin 看全组项目,普通成员只看本组)
    const groupIds = groups.map((g: any) => g.id);
    const [membersRes, projectsRes] = await Promise.all([
      supabase.from("team_members").select("group_id").in("group_id", groupIds),
      supabase.from("projects").select("group_id").in("group_id", groupIds),
    ]);
    const memberCount = new Map<string, number>();
    const projectCount = new Map<string, number>();
    (membersRes.data ?? []).forEach((m: any) => {
      if (m.group_id) memberCount.set(m.group_id, (memberCount.get(m.group_id) ?? 0) + 1);
    });
    (projectsRes.data ?? []).forEach((p: any) => {
      if (p.group_id) projectCount.set(p.group_id, (projectCount.get(p.group_id) ?? 0) + 1);
    });

    // 组长 profile
    const adminIds = groups.map((g: any) => g.admin_id).filter(Boolean) as string[];
    const adminProfiles = await fetchProfiles(supabase, adminIds);

    const result: TeamGroupRow[] = groups.map((g: any) => ({
      id: g.id,
      teamId: g.team_id,
      name: g.name,
      adminId: g.admin_id,
      createdAt: g.created_at,
      memberCount: memberCount.get(g.id) ?? 0,
      projectCount: projectCount.get(g.id) ?? 0,
      adminEmail: adminProfiles.get(g.admin_id)?.email ?? null,
      adminDisplayName: adminProfiles.get(g.admin_id)?.displayName ?? null,
      isMyGroup: g.id === myGroupId,
      isMyAdminGroup: g.admin_id === userId,
    }));
    return { groups: result, error: null as string | null };
  });

// ====================================================================
// createGroup - 建组(仅 owner)。1:1 由 DB UNIQUE(team_id, admin_id) 保证
// ====================================================================

export const createGroup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(CreateGroupInput)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: self } = await supabase
      .from("team_members")
      .select("role")
      .eq("team_id", data.teamId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!self || self.role !== "owner") {
      return { ok: false as const, error: "Only the team owner can create groups" };
    }

    if (data.adminId) {
      const { data: adminMember } = await supabase
        .from("team_members")
        .select("id")
        .eq("team_id", data.teamId)
        .eq("user_id", data.adminId)
        .maybeSingle();
      if (!adminMember) {
        return { ok: false as const, error: "Group admin must be a team member" };
      }
    }

    const { data: group, error } = await supabase
      .from("team_groups")
      .insert({ team_id: data.teamId, name: data.name, admin_id: data.adminId ?? null })
      .select("id")
      .single();
    if (error) {
      // 23505 = unique_violation:该组长已管理本团队另一个组(1:1),或组名重复
      if (error.code === "23505") {
        return {
          ok: false as const,
          error: "该成员已是另一个组的组长,或组名已存在(组与组长一对一)",
        };
      }
      return { ok: false as const, error: error.message };
    }
    // 组长同时作为本组成员(team_members.group_id),使 RLS is_in_same_group 对其生效,
    // 组长才能看到/管理本组项目
    if (data.adminId) {
      // owner 可经 RLS 更新 team_members,无需 service role
      await supabase
        .from("team_members")
        .update({ group_id: group.id, role: "admin" })
        .eq("team_id", data.teamId)
        .eq("user_id", data.adminId);
    }
    return { ok: true as const, groupId: group.id };
  });

// ====================================================================
// updateGroup - 改名 / 改派组长(仅 owner)
// ====================================================================

export const updateGroup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(UpdateGroupInput)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: group } = await supabase
      .from("team_groups")
      .select("team_id, admin_id")
      .eq("id", data.groupId)
      .maybeSingle();
    if (!group) return { ok: false as const, error: "Group not found" };

    const { data: self } = await supabase
      .from("team_members")
      .select("role")
      .eq("team_id", group.team_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (!self || self.role !== "owner") {
      return { ok: false as const, error: "Only the team owner can update groups" };
    }

    // 改派组长:校验新组长是团队成员
    if (data.adminId !== undefined && data.adminId !== null) {
      const { data: adminMember } = await supabase
        .from("team_members")
        .select("id")
        .eq("team_id", group.team_id)
        .eq("user_id", data.adminId)
        .maybeSingle();
      if (!adminMember) {
        return { ok: false as const, error: "Group admin must be a team member" };
      }
    }

    const update: { name?: string; admin_id?: string | null } = {};
    if (data.name !== undefined) update.name = data.name;
    if (data.adminId !== undefined) update.admin_id = data.adminId;
    if (Object.keys(update).length === 0) return { ok: true as const };

    const { error } = await supabase.from("team_groups").update(update).eq("id", data.groupId);
    if (error) {
      if (error.code === "23505") {
        return {
          ok: false as const,
          error: "该成员已是另一个组的组长,或组名已存在(组与组长一对一)",
        };
      }
      return { ok: false as const, error: error.message };
    }
    // 改派组长后,把新组长加入本组(同 createGroup,保证 is_in_same_group 生效)
    if (data.adminId !== undefined && data.adminId !== null) {
      // owner 可经 RLS 更新 team_members,无需 service role
      await supabase
        .from("team_members")
        .update({ group_id: data.groupId, role: "admin" })
        .eq("team_id", group.team_id)
        .eq("user_id", data.adminId);
    }
    return { ok: true as const };
  });

// ====================================================================
// deleteGroup - 删组(仅 owner)。成员/项目 group_id 自动置 NULL(ON DELETE SET NULL)
// ====================================================================

export const deleteGroup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(GroupIdInput)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: group } = await supabase
      .from("team_groups")
      .select("team_id")
      .eq("id", data.groupId)
      .maybeSingle();
    if (!group) return { ok: false as const, error: "Group not found" };

    const { data: self } = await supabase
      .from("team_members")
      .select("role")
      .eq("team_id", group.team_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (!self || self.role !== "owner") {
      return { ok: false as const, error: "Only the team owner can delete groups" };
    }

    const { error } = await supabase.from("team_groups").delete().eq("id", data.groupId);
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  });

// ====================================================================
// getGroupDetail - 组详情 + 成员 + 项目(组内/owner 可见,RLS 过滤)
// ====================================================================

export const getGroupDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(GroupIdInput)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: group, error: gErr } = await supabase
      .from("team_groups")
      .select("id, team_id, name, admin_id, created_at")
      .eq("id", data.groupId)
      .maybeSingle();
    if (gErr) return { group: null, error: gErr.message };
    if (!group) return { group: null, error: "Group not found" };

    // 成员(RLS: 团队成员可见所有 team_members)
    const { data: members } = await supabase
      .from("team_members")
      .select("id, user_id, role, credits_balance, joined_at")
      .eq("group_id", data.groupId)
      .order("joined_at", { ascending: true });
    const memberRows = (members ?? []) as any[];
    const profiles = await fetchProfiles(
      supabase,
      memberRows.map((m) => m.user_id),
    );
    const groupMembers: GroupMemberRow[] = memberRows.map((m: any) => ({
      id: m.id,
      userId: m.user_id,
      role: m.role,
      creditsBalance: Number(m.credits_balance ?? 0),
      joinedAt: m.joined_at,
      email: profiles.get(m.user_id)?.email ?? null,
      displayName: profiles.get(m.user_id)?.displayName ?? null,
    }));

    // 项目(RLS: owner/admin 或同组成员可见;普通成员只能看到自己组的)
    const { data: projects } = await supabase
      .from("projects")
      .select("id, name, custom_cover, updated_at, user_id")
      .eq("group_id", data.groupId)
      .order("updated_at", { ascending: false });
    const groupProjects: GroupProjectRow[] = ((projects ?? []) as any[]).map((p: any) => ({
      id: p.id,
      name: p.name,
      customCover: p.custom_cover,
      updatedAt: p.updated_at,
      ownerId: p.user_id,
    }));

    return {
      group: {
        id: group.id,
        teamId: group.team_id,
        name: group.name,
        adminId: group.admin_id,
        createdAt: group.created_at,
        isMyAdminGroup: group.admin_id === userId,
      },
      members: groupMembers,
      projects: groupProjects,
      error: null as string | null,
    };
  });

// ====================================================================
// assignMemberToGroup - 把成员加入某组(owner 或该组组长)
// 设 team_members.group_id(若原在别的组,会移到新组)
// ====================================================================

export const assignMemberToGroup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(AssignMemberInput)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const check = await assertCanManageGroup(supabase, userId, data.groupId);
    if (!check.ok) return { ok: false as const, error: check.error };

    // 校验目标用户是团队成员
    const { data: target } = await supabase
      .from("team_members")
      .select("id")
      .eq("team_id", check.teamId)
      .eq("user_id", data.userId)
      .maybeSingle();
    if (!target) return { ok: false as const, error: "Target user is not a team member" };

    // 用 service role 写:组长可能是 member 角色,RLS 不允许其改 team_members
    const { error } = await supabaseAdmin
      .from("team_members")
      .update({ group_id: data.groupId })
      .eq("team_id", check.teamId)
      .eq("user_id", data.userId);
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  });

// ====================================================================
// removeMemberFromGroup - 把成员移出组(owner 或该成员所在组的组长)
// 清 team_members.group_id
// ====================================================================

export const removeMemberFromGroup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(RemoveMemberFromGroupInput)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: target } = await supabase
      .from("team_members")
      .select("group_id")
      .eq("team_id", data.teamId)
      .eq("user_id", data.userId)
      .maybeSingle();
    if (!target) return { ok: false as const, error: "Member not found" };
    if (!target.group_id) return { ok: false as const, error: "该成员不在任何组中" };

    // owner 直接放行;否则必须是该成员所在组的组长
    const { data: self } = await supabase
      .from("team_members")
      .select("role")
      .eq("team_id", data.teamId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!self) return { ok: false as const, error: "You are not a member of this team" };
    if (self.role !== "owner") {
      const { data: group } = await supabase
        .from("team_groups")
        .select("admin_id")
        .eq("id", target.group_id)
        .maybeSingle();
      if (!group || group.admin_id !== userId) {
        return {
          ok: false as const,
          error: "Only the owner or this group's admin can remove members",
        };
      }
    }

    const { error } = await supabaseAdmin
      .from("team_members")
      .update({ group_id: null })
      .eq("team_id", data.teamId)
      .eq("user_id", data.userId);
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  });

// ====================================================================
// assignProjectToGroup - 把项目指派到组(owner 或该组组长)
// 设 projects.group_id + team_id(组所在团队)
// ====================================================================

export const assignProjectToGroup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(AssignProjectInput)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const check = await assertCanManageGroup(supabase, userId, data.groupId);
    if (!check.ok) return { ok: false as const, error: check.error };

    // 用 service role 写:统一设 group_id + team_id,绕过项目 RLS 的复杂判定
    const { error } = await supabaseAdmin
      .from("projects")
      .update({ group_id: data.groupId, team_id: check.teamId })
      .eq("id", data.projectId);
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  });

// ====================================================================
// unassignProjectFromGroup - 把项目移出组(owner 或项目所在组的组长)
// 清 projects.group_id(team_id 保留,降为团队级项目)
// ====================================================================

export const unassignProjectFromGroup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(UnassignProjectInput)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // 先取项目当前 group_id / team_id(service role,避免 RLS 漏读)
    const { data: project } = await supabaseAdmin
      .from("projects")
      .select("group_id, team_id")
      .eq("id", data.projectId)
      .maybeSingle();
    if (!project) return { ok: false as const, error: "Project not found" };
    if (!project.group_id) return { ok: false as const, error: "该项目不在任何组中" };

    // owner 直接放行;否则必须是该项目所在组的组长
    const { data: self } = await supabase
      .from("team_members")
      .select("role")
      .eq("team_id", project.team_id ?? "")
      .eq("user_id", userId)
      .maybeSingle();
    if (!self) return { ok: false as const, error: "You are not a member of this team" };
    if (self.role !== "owner") {
      const { data: group } = await supabase
        .from("team_groups")
        .select("admin_id")
        .eq("id", project.group_id)
        .maybeSingle();
      if (!group || group.admin_id !== userId) {
        return {
          ok: false as const,
          error: "Only the owner or this group's admin can unassign projects",
        };
      }
    }

    const { error } = await supabaseAdmin
      .from("projects")
      .update({ group_id: null })
      .eq("id", data.projectId);
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  });
