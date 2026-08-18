import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const RecipientInput = z.object({
  kind: z.enum(["user", "team"]),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(10),
  query: z.string().trim().max(100).default(""),
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
        p_query: data.query,
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

// ====================================================================
// getAdminCreditTransactions —— 后台积分消耗明细（2026/08 项目维度查询）
//
// 权限:is_credit_admin（用户态 RPC 判定）后走 supabaseAdmin 读流水
// （service role 绕 RLS,与 errorLogs 管理读取同 pattern）。
// projectId / projectName(ILIKE 模糊) / userId 过滤;SQL 未执行
// （project_name 列不存在,42703）时自动降级为不带项目列的查询。
// ====================================================================

const TransactionsInput = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  projectName: z.string().trim().max(200).default(""),
  userId: z.string().uuid().optional(),
});

export type AdminCreditTransaction = {
  id: string;
  userId: string;
  type: string;
  amount: number;
  balanceAfter: number | null;
  model: string | null;
  resolution: string | null;
  duration: number | null;
  description: string | null;
  projectId: string | null;
  projectName: string | null;
  createdAt: string;
};

export const getAdminCreditTransactions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => TransactionsInput.parse(input))
  .handler(async ({ data, context }) => {
    if (!(await hasCreditAdminAccess(context.supabase))) {
      return {
        transactions: [] as AdminCreditTransaction[],
        error: "无管理权限",
        hasProjectColumns: false,
      };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const from = (data.page - 1) * data.pageSize;
    const to = from + data.pageSize - 1;
    const withProjectColumns = (query: any) =>
      query.select(
        "id,user_id,type,amount,balance_after,model,resolution,duration,description,project_id,project_name,created_at",
      );
    const withoutProjectColumns = (query: any) =>
      query.select("id,user_id,type,amount,balance_after,model,resolution,duration,description,created_at");
    const applyFilters = (query: any, includeProjectFilter: boolean) => {
      let q = query.order("created_at", { ascending: false }).range(from, to);
      // 降级路径（列不存在）不能加 project_name 过滤,否则再次报错
      if (includeProjectFilter && data.projectName)
        q = q.ilike("project_name", `%${data.projectName}%`);
      if (data.userId) q = q.eq("user_id", data.userId);
      return q;
    };
    let rows: any[] | null = null;
    let hasProjectColumns = true;
    {
      const { data: r, error } = await applyFilters(
        withProjectColumns(supabaseAdmin.from("user_credit_transactions")),
        true,
      );
      if (error && /42703|does not exist/i.test(error.message)) {
        // project_name 列未建（SQL 未执行）→ 降级为不带项目列与项目过滤的查询
        hasProjectColumns = false;
        console.warn("[adminCredits] project_name 列不存在（SQL 未执行?）,降级查询");
        const fallback = await applyFilters(
          withoutProjectColumns(supabaseAdmin.from("user_credit_transactions")),
          false,
        );
        if (fallback.error) {
          return { transactions: [] as AdminCreditTransaction[], error: fallback.error.message, hasProjectColumns: false };
        }
        rows = fallback.data;
      } else if (error) {
        return { transactions: [] as AdminCreditTransaction[], error: error.message, hasProjectColumns: true };
      } else {
        rows = r;
      }
    }
    // hasProjectColumns=false（SQL 未执行）时项目列返回 null 且项目名过滤不生效,
    // 透出给 UI 提示「先执行 SQL」。
    const transactions: AdminCreditTransaction[] = (rows ?? []).map((row: any) => ({
      id: row.id,
      userId: row.user_id,
      type: row.type,
      amount: Number(row.amount),
      balanceAfter: row.balance_after == null ? null : Number(row.balance_after),
      model: row.model ?? null,
      resolution: row.resolution ?? null,
      duration: row.duration ?? null,
      description: row.description ?? null,
      projectId: hasProjectColumns ? (row.project_id ?? null) : null,
      projectName: hasProjectColumns ? (row.project_name ?? null) : null,
      createdAt: row.created_at,
    }));
    return { transactions, error: null as string | null, hasProjectColumns };
  });
