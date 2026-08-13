import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const UserIdsInput = z.object({
  userIds: z.array(z.string().uuid()).max(100),
});

const TeamIdsInput = z.object({
  teamIds: z.array(z.string().uuid()).max(100),
});

const ResetPasswordInput = z.object({
  userId: z.string().uuid(),
  newPassword: z.string().min(8).max(72),
});

const SendResetEmailInput = z.object({
  email: z.string().email(),
});

const SetBannedInput = z.object({
  userId: z.string().uuid(),
  banned: z.boolean(),
});

export type AdminUserStatus = {
  id: string;
  email: string | null;
  banned: boolean;
  lastSignInAt: string | null;
};

async function assertAdmin(supabase: any): Promise<boolean> {
  const { data, error } = await (supabase.rpc as any)("is_credit_admin");
  if (error) {
    console.error("[adminUsers] admin check failed:", error);
    return false;
  }
  return data === true;
}

function isBanned(user: any): boolean {
  const until = user?.banned_until;
  if (!until) return false;
  const ts = Date.parse(until);
  return Number.isFinite(ts) ? ts > Date.now() : true;
}

export const getAdminUserStatuses = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(UserIdsInput)
  .handler(async ({ data, context }) => {
    if (!(await assertAdmin(context.supabase))) {
      return { statuses: [] as AdminUserStatus[], error: "无管理权限" };
    }
    if (data.userIds.length === 0) return { statuses: [] as AdminUserStatus[], error: null };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const results = await Promise.all(
      data.userIds.map(async (id) => {
        try {
          const { data: res } = await supabaseAdmin.auth.admin.getUserById(id);
          const u: any = res?.user;
          if (!u) return null;
          return {
            id,
            email: u.email ?? null,
            banned: isBanned(u),
            lastSignInAt: u.last_sign_in_at ?? null,
          } as AdminUserStatus;
        } catch (err) {
          console.error("[adminUsers] getUserById failed for", id, err);
          return null;
        }
      }),
    );

    return {
      statuses: results.filter(Boolean) as AdminUserStatus[],
      error: null as string | null,
    };
  });

export const getTeamOwnerIds = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(TeamIdsInput)
  .handler(async ({ data, context }) => {
    if (!(await assertAdmin(context.supabase))) {
      return { owners: [] as { teamId: string; ownerId: string }[], error: "无管理权限" };
    }
    if (data.teamIds.length === 0) return { owners: [], error: null as string | null };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("teams")
      .select("id, owner_id")
      .in("id", data.teamIds);

    if (error) {
      console.error("[adminUsers] team owners failed:", error.message);
      return { owners: [] as { teamId: string; ownerId: string }[], error: error.message };
    }

    return {
      owners: (rows ?? []).map((r: any) => ({ teamId: r.id, ownerId: r.owner_id })),
      error: null as string | null,
    };
  });

export const adminResetUserPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(ResetPasswordInput)
  .handler(async ({ data, context }) => {
    if (!(await assertAdmin(context.supabase))) {
      return { ok: false as const, error: "无管理权限" };
    }
    if (data.userId === context.userId) {
      return { ok: false as const, error: "不能在此重置自己的密码，请前往账户安全页面修改" };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      password: data.newPassword,
    });
    if (error) {
      console.error("[adminUsers] reset password failed for", data.userId, error.message);
      return { ok: false as const, error: error.message };
    }
    return { ok: true as const };
  });

export const adminSendPasswordResetEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(SendResetEmailInput)
  .handler(async ({ data, context }) => {
    if (!(await assertAdmin(context.supabase))) {
      return { ok: false as const, error: "无管理权限" };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.resetPasswordForEmail(data.email);
    if (error) {
      console.error("[adminUsers] send reset email failed:", error.message);
      return { ok: false as const, error: error.message };
    }
    return { ok: true as const };
  });

export const adminSetUserBanned = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(SetBannedInput)
  .handler(async ({ data, context }) => {
    if (!(await assertAdmin(context.supabase))) {
      return { ok: false as const, error: "无管理权限" };
    }
    if (data.userId === context.userId) {
      return { ok: false as const, error: "不能停用自己的账号" };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (data.banned) {
      const { data: adminRow } = await supabaseAdmin
        .from("admin_users")
        .select("user_id")
        .eq("user_id", data.userId)
        .maybeSingle();
      if (adminRow) {
        return { ok: false as const, error: "不能停用管理员账号" };
      }
    }

    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      ban_duration: data.banned ? "876000h" : "none",
    } as any);
    if (error) {
      console.error("[adminUsers] set banned failed for", data.userId, error.message);
      return { ok: false as const, error: error.message };
    }
    return { ok: true as const };
  });
