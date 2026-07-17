import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const RecipientInput = z.object({
  kind: z.enum(["user", "team"]),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
});

const GrantInput = z.object({
  kind: z.enum(["user", "team"]),
  targetId: z.string().uuid(),
  amount: z.number().int().positive().max(1_000_000_000),
  description: z.string().trim().max(500).optional(),
});

export type AdminCreditRecipient = {
  id: string;
  kind: "user" | "team";
  name: string;
  email: string | null;
  balance: number;
  createdAt: string;
};

async function hasCreditAdminAccess(supabase: any): Promise<boolean> {
  const { data, error } = await (supabase.rpc as any)("is_credit_admin");
  if (error) {
    console.error("[adminCredits] admin access check failed:", error);
    return false;
  }
  return data === true;
}

// Header and route guards use this only for visibility/navigation. Every
// privileged RPC below independently checks the same permission in Postgres.
export const getAdminAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => ({
    isAdmin: await hasCreditAdminAccess(context.supabase),
  }));

export const getAdminCreditRecipients = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(RecipientInput)
  .handler(async ({ data, context }) => {
    if (!(await hasCreditAdminAccess(context.supabase))) {
      return { recipients: [] as AdminCreditRecipient[], total: 0, error: "无管理权限" };
    }

    const { data: rows, error } = await (context.supabase.rpc as any)(
      "admin_list_credit_recipients",
      {
        p_kind: data.kind,
        p_page: data.page,
        p_page_size: data.pageSize,
      },
    );

    if (error) {
      console.error("[adminCredits] list recipients failed:", error);
      return { recipients: [] as AdminCreditRecipient[], total: 0, error: error.message };
    }

    const recipients: AdminCreditRecipient[] = (rows ?? []).map((row: any) => ({
      id: row.target_id,
      kind: row.target_type,
      name: row.name,
      email: row.email,
      balance: Number(row.balance ?? 0),
      createdAt: row.created_at,
    }));

    return {
      recipients,
      total: Number(rows?.[0]?.total_count ?? 0),
      error: null as string | null,
    };
  });

export const grantAdminCredits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(GrantInput)
  .handler(async ({ data, context }) => {
    if (!(await hasCreditAdminAccess(context.supabase))) {
      return { ok: false as const, error: "无管理权限" };
    }

    const { data: rows, error } = await (context.supabase.rpc as any)("admin_grant_credits", {
      p_target_type: data.kind,
      p_target_id: data.targetId,
      p_amount: data.amount,
      p_description: data.description || null,
    });

    if (error) {
      console.error("[adminCredits] grant credits failed:", error);
      return { ok: false as const, error: error.message };
    }

    return {
      ok: true as const,
      balance: Number(rows?.[0]?.balance_after ?? 0),
    };
  });
