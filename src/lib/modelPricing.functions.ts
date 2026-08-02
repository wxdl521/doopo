// ====================================================================
//  模型定价（public.model_pricing）服务端读写
//
//  - listModelPricing：登录可读，模块级缓存 60s（modelPricingCache.ts），可按 kind 过滤
//  - upsertModelPricing / deleteModelPricing：仅 is_credit_admin() 管理员，写后使缓存失效
//  - refreshModelPricingCache：供 creditsCost 同步扣费路径在缓存过期时后台刷新
// ====================================================================

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  getModelPricingRows,
  getRegisteredModelPricingClient,
  invalidateModelPricingCache,
  isModelPricingCacheStale,
  registerModelPricingClient,
  setModelPricingCache,
  type ModelPricingRow,
} from "./modelPricingCache";

export const ModelPricingListInput = z.object({
  kind: z.enum(["video", "image"]).optional(),
});

export const ModelPricingUpsertInput = z.object({
  id: z.string().uuid().optional(),
  kind: z.enum(["video", "image"]),
  modelId: z.string().trim().min(1).max(200),
  label: z.string().trim().min(1).max(200),
  resolution: z.string().trim().max(50).nullish(),
  credits: z.number().min(0).max(1_000_000_000),
  note: z.string().trim().max(500).nullish(),
  isDefault: z.boolean().default(false),
  enabled: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(1_000_000).default(0),
});

export const ModelPricingDeleteInput = z.object({
  id: z.string().uuid(),
});

function mapRow(row: any): ModelPricingRow {
  return {
    id: row.id,
    kind: row.kind,
    modelId: row.model_id,
    label: row.label,
    resolution: row.resolution ?? null,
    credits: Number(row.credits ?? 0),
    note: row.note ?? null,
    isDefault: row.is_default === true,
    enabled: row.enabled !== false,
    sortOrder: Number(row.sort_order ?? 0),
  };
}

async function hasCreditAdminAccess(supabase: any): Promise<boolean> {
  const { data, error } = await (supabase.rpc as any)("is_credit_admin");
  if (error) {
    console.error("[modelPricing] admin access check failed:", error);
    return false;
  }
  return data === true;
}

/** 直接读库并刷新模块级缓存（普通函数，便于复用与测试） */
export async function fetchModelPricingFromDb(supabase: any): Promise<ModelPricingRow[]> {
  const { data, error } = await (supabase.from as any)("model_pricing")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("model_id", { ascending: true });
  if (error) throw new Error(error.message);
  const rows = (data ?? []).map(mapRow);
  setModelPricingCache(rows);
  return rows;
}

/** 缓存过期时用最近注册的登录客户端后台刷新；无客户端则为 no-op */
export async function refreshModelPricingCache(): Promise<void> {
  const client = getRegisteredModelPricingClient();
  if (!client || !isModelPricingCacheStale()) return;
  try {
    await fetchModelPricingFromDb(client);
  } catch (error) {
    console.error("[modelPricing] background refresh failed:", error);
  }
}

export const listModelPricing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(ModelPricingListInput)
  .handler(async ({ data, context }) => {
    registerModelPricingClient(context.supabase);
    let rows = getModelPricingRows();
    if (!rows || isModelPricingCacheStale()) {
      try {
        rows = await fetchModelPricingFromDb(context.supabase);
      } catch (error) {
        console.error("[modelPricing] list failed:", error);
        return { rows: [] as ModelPricingRow[], error: (error as Error).message };
      }
    }
    const filtered = data.kind ? rows.filter((row) => row.kind === data.kind) : rows;
    return { rows: filtered, error: null as string | null };
  });

export const upsertModelPricing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(ModelPricingUpsertInput)
  .handler(async ({ data, context }) => {
    if (!(await hasCreditAdminAccess(context.supabase))) {
      return { ok: false as const, error: "无管理权限" };
    }

    const table = (context.supabase.from as any)("model_pricing");
    const payload = {
      kind: data.kind,
      model_id: data.modelId,
      label: data.label,
      resolution: data.resolution || null,
      credits: data.credits,
      note: data.note || null,
      is_default: data.isDefault,
      enabled: data.enabled,
      sort_order: data.sortOrder,
      updated_at: new Date().toISOString(),
    };

    // 唯一键是表达式索引 (kind, model_id, coalesce(resolution,''))，supabase upsert
    // 无法直接命中，因此先按自然键查已有行再决定 update / insert。
    let existingId = data.id ?? null;
    if (!existingId) {
      let query = table
        .select("id")
        .eq("kind", data.kind)
        .eq("model_id", data.modelId)
        .limit(1);
      query = data.resolution ? query.eq("resolution", data.resolution) : query.is("resolution", null);
      const { data: existing, error: findError } = await query;
      if (findError) {
        console.error("[modelPricing] find existing failed:", findError);
        return { ok: false as const, error: findError.message };
      }
      existingId = existing?.[0]?.id ?? null;
    }

    const { error } = existingId
      ? await table.update(payload).eq("id", existingId)
      : await table.insert(payload);
    if (error) {
      console.error("[modelPricing] upsert failed:", error);
      return { ok: false as const, error: error.message };
    }

    invalidateModelPricingCache();
    return { ok: true as const, error: null as string | null };
  });

export const deleteModelPricing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(ModelPricingDeleteInput)
  .handler(async ({ data, context }) => {
    if (!(await hasCreditAdminAccess(context.supabase))) {
      return { ok: false as const, error: "无管理权限" };
    }

    const { error } = await (context.supabase.from as any)("model_pricing")
      .delete()
      .eq("id", data.id);
    if (error) {
      console.error("[modelPricing] delete failed:", error);
      return { ok: false as const, error: error.message };
    }

    invalidateModelPricingCache();
    return { ok: true as const, error: null as string | null };
  });
