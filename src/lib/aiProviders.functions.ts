// ====================================================================
//  供应商管理（public.ai_providers / public.ai_provider_models）服务端函数
//
//  管理端（requireSupabaseAuth + is_credit_admin）：
//    listProviders / upsertProvider / deleteProvider
//    listProviderModels / upsertProviderModel / deleteProviderModel
//    toggleModelListing（上架/下架）/ toggleModelEnabled（启用/停用）
//    testProviderConnection（最小请求 + 超时，不落明文日志）
//
//  用户端（登录可读）：
//    listListedModels({kind}) —— 已上架 + 启用的脱敏目录。
//    ⚠ 必须走 supabaseAdmin（service role）：两表 RLS 仅 is_credit_admin
//    可读写，用户态 client 一行都读不到。返回结构不含 base_url / 密钥。
//
//  写操作同时失效 modelPricingCache 与目录缓存（listedModelsCache）。
// ====================================================================

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { invalidateModelPricingCache } from "./modelPricingCache";
import { fetchModelPricingFromDb } from "./modelPricing.functions";
import {
  getModelPricingRows,
  isModelPricingCacheStale,
  type ModelPricingRow,
} from "./modelPricingCache";
import {
  buildCatalogKey,
  imagePricingFor,
  invalidateListedModelsCache,
  getListedModelsCache,
  isBuiltinRoutePrefix,
  isListedModelsCacheStale,
  pricingSummary,
  setListedModelsCache,
  videoPricingFor,
  type AiProviderModelRow,
  type AiProviderRow,
  type ListedModelEntry,
  type ModelCapabilities,
} from "./aiProvidersCache";

// 价目匹配助手由 aiProvidersCache 提供；此处 re-export 保持单一来源
export { imagePricingFor, videoPricingFor, pricingSummary };
import { apiKeyHint, encryptProviderSecret } from "./providerSecret.server";

// --------------------------------------------------------------------
// 入参 schema
// --------------------------------------------------------------------

const CapabilitiesSchema = z
  .object({
    t2i: z.boolean().optional(),
    i2i: z.boolean().optional(),
    max_reference_images: z.number().int().min(0).max(20).optional(),
    sizes: z.array(z.string().max(50)).max(20).optional(),
    resolutions: z.array(z.string().max(20)).max(10).optional(),
    // 强制声明（correction #4）：适配器按声明组请求，不接受缺省
    edits_protocol: z.enum(["json", "multipart"]),
    auth_header: z.enum(["bearer", "x-api-key"]),
    api: z.enum(["images", "chat"]).optional(),
  })
  .passthrough();

const ProviderUpsertInput = z.object({
  id: z.string().uuid().optional(),
  code: z
    .string()
    .trim()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9][a-z0-9-_]*$/i, "code 仅允许小写字母/数字/-/_，且以字母或数字开头"),
  name: z.string().trim().min(1).max(100),
  kind: z.enum(["openai_compatible", "builtin"]).default("openai_compatible"),
  baseUrl: z.string().trim().max(500).nullish(),
  /** 明文密钥：仅填写时更新；编辑留空表示不修改（correction：界面显示 ****尾4位） */
  apiKey: z.string().trim().max(500).nullish(),
  envKeyName: z.string().trim().max(200).nullish(),
  enabled: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(1_000_000).default(0),
});

const ProviderDeleteInput = z.object({ id: z.string().uuid() });

const ModelUpsertInput = z.object({
  id: z.string().uuid().optional(),
  providerId: z.string().uuid(),
  modelId: z.string().trim().min(1).max(200),
  label: z.string().trim().min(1).max(200),
  kind: z.enum(["image", "video", "text"]).default("image"),
  capabilities: CapabilitiesSchema,
  listed: z.boolean().default(false),
  enabled: z.boolean().default(true),
  isDefault: z.boolean().default(false),
  sortOrder: z.number().int().min(0).max(1_000_000).default(0),
  note: z.string().trim().max(500).nullish(),
});

const ModelDeleteInput = z.object({ id: z.string().uuid() });

const ModelListInput = z.object({ providerId: z.string().uuid().optional() });

const ToggleModelInput = z.object({ id: z.string().uuid(), value: z.boolean() });

const TestConnectionInput = z.object({ id: z.string().uuid() });

const ListListedModelsInput = z.object({
  kind: z.enum(["image", "video", "text"]).optional(),
});

// --------------------------------------------------------------------
// 共用工具
// --------------------------------------------------------------------

async function hasCreditAdminAccess(supabase: any): Promise<boolean> {
  const { data, error } = await (supabase.rpc as any)("is_credit_admin");
  if (error) {
    console.error("[aiProviders] admin access check failed:", error);
    return false;
  }
  return data === true;
}

/** 写操作后同时失效价目缓存与目录缓存（correction #6） */
function invalidateProviderCaches(): void {
  invalidateListedModelsCache();
  invalidateModelPricingCache();
}

function mapProvider(row: any): AiProviderRow {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    kind: row.kind,
    baseUrl: row.base_url ?? null,
    apiKeyHint: row.api_key_hint ?? null,
    envKeyName: row.env_key_name ?? null,
    hasApiKey: !!row.api_key_cipher,
    enabled: row.enabled !== false,
    sortOrder: Number(row.sort_order ?? 0),
  };
}

function mapModel(row: any): AiProviderModelRow {
  return {
    id: row.id,
    providerId: row.provider_id,
    modelId: row.model_id,
    label: row.label,
    kind: row.kind,
    capabilities: (row.capabilities ?? {}) as ModelCapabilities,
    listed: row.listed === true,
    enabled: row.enabled !== false,
    isDefault: row.is_default === true,
    sortOrder: Number(row.sort_order ?? 0),
    note: row.note ?? null,
  };
}

/** 缓存过期时用 supabaseAdmin 刷新 model_pricing（service role，不依赖请求上下文） */
async function ensurePricingRows(): Promise<ModelPricingRow[]> {
  const rows = getModelPricingRows();
  if (rows && !isModelPricingCacheStale()) return rows;
  try {
    return await fetchModelPricingFromDb(supabaseAdmin);
  } catch (error) {
    console.error("[aiProviders] pricing refresh failed:", error);
    return rows ?? [];
  }
}

// --------------------------------------------------------------------
// 管理端：供应商 CRUD
// --------------------------------------------------------------------

export const listProviders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    if (!(await hasCreditAdminAccess(context.supabase))) {
      return { rows: [] as AiProviderRow[], error: "无管理权限" };
    }
    const { data, error } = await (supabaseAdmin.from as any)("ai_providers")
      .select(
        "id, code, name, kind, base_url, api_key_hint, env_key_name, api_key_cipher, enabled, sort_order",
      )
      .order("sort_order", { ascending: true })
      .order("code", { ascending: true });
    if (error) {
      console.error("[aiProviders] listProviders failed:", error);
      return { rows: [] as AiProviderRow[], error: error.message };
    }
    return { rows: (data ?? []).map(mapProvider), error: null as string | null };
  });

export const upsertProvider = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(ProviderUpsertInput)
  .handler(async ({ data, context }) => {
    if (!(await hasCreditAdminAccess(context.supabase))) {
      return { ok: false as const, error: "无管理权限" };
    }
    const code = data.code.trim().toLowerCase();
    const table = (supabaseAdmin.from as any)("ai_providers");

    // 既有行（编辑时）——code 冲突校验需要区分「沿用自身 code」与「抢占内置前缀」
    let existing: any = null;
    if (data.id) {
      const { data: row, error } = await table
        .select("id, code, kind")
        .eq("id", data.id)
        .maybeSingle();
      if (error) return { ok: false as const, error: error.message };
      if (!row) return { ok: false as const, error: "供应商不存在" };
      existing = row;
    }

    // correction #3：code 不得与内置路由前缀冲突（ark/qwen/azure/pixflow 等）。
    // 例外：编辑既有 builtin 行且未改 code（种子里的内置供应商自身）。
    const isSelfBuiltin =
      existing && existing.kind === "builtin" && existing.code.toLowerCase() === code;
    if (isBuiltinRoutePrefix(code) && !isSelfBuiltin) {
      return {
        ok: false as const,
        error: `code「${code}」与内置路由前缀冲突，请换一个前缀`,
      };
    }
    if (data.kind === "openai_compatible" && isBuiltinRoutePrefix(code)) {
      return { ok: false as const, error: `动态供应商 code「${code}」不可占用内置前缀` };
    }

    // 小写归一唯一（DB 另有 lower(code) 唯一索引兜底，这里给出友好报错）
    const { data: dup, error: dupError } = await table.select("id").ilike("code", code).limit(1);
    if (dupError) return { ok: false as const, error: dupError.message };
    if (dup?.[0] && dup[0].id !== data.id) {
      return { ok: false as const, error: `code「${code}」已被其他供应商占用` };
    }

    const payload: Record<string, unknown> = {
      code,
      name: data.name,
      kind: data.kind,
      base_url: data.baseUrl || null,
      env_key_name: data.envKeyName || null,
      enabled: data.enabled,
      sort_order: data.sortOrder,
      updated_at: new Date().toISOString(),
    };

    // 密钥：填写则加密更新（密文 + 尾4位 hint）；留空不改动
    if (data.apiKey) {
      try {
        payload.api_key_cipher = await encryptProviderSecret(data.apiKey);
        payload.api_key_hint = apiKeyHint(data.apiKey);
      } catch (error) {
        return { ok: false as const, error: (error as Error).message };
      }
    }

    const { error } = data.id
      ? await table.update(payload).eq("id", data.id)
      : await table.insert(payload);
    if (error) {
      console.error("[aiProviders] upsertProvider failed:", error);
      return { ok: false as const, error: error.message };
    }
    invalidateProviderCaches();
    return { ok: true as const, error: null as string | null };
  });

export const deleteProvider = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(ProviderDeleteInput)
  .handler(async ({ data, context }) => {
    if (!(await hasCreditAdminAccess(context.supabase))) {
      return { ok: false as const, error: "无管理权限" };
    }
    const { error } = await (supabaseAdmin.from as any)("ai_providers").delete().eq("id", data.id);
    if (error) {
      console.error("[aiProviders] deleteProvider failed:", error);
      return { ok: false as const, error: error.message };
    }
    invalidateProviderCaches();
    return { ok: true as const, error: null as string | null };
  });

// --------------------------------------------------------------------
// 管理端：模型 CRUD + 上架/启用开关
// --------------------------------------------------------------------

export const listProviderModels = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(ModelListInput)
  .handler(async ({ data, context }) => {
    if (!(await hasCreditAdminAccess(context.supabase))) {
      return { rows: [] as AiProviderModelRow[], error: "无管理权限" };
    }
    let query = (supabaseAdmin.from as any)("ai_provider_models")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("model_id", { ascending: true });
    if (data.providerId) query = query.eq("provider_id", data.providerId);
    const [{ data: models, error }, { data: providers }, pricingRows] = await Promise.all([
      query,
      (supabaseAdmin.from as any)("ai_providers").select("id, code, kind"),
      ensurePricingRows(),
    ]);
    if (error) {
      console.error("[aiProviders] listProviderModels failed:", error);
      return { rows: [] as AiProviderModelRow[], error: error.message };
    }
    const providerById = new Map<string, any>((providers ?? []).map((p: any) => [p.id, p]));
    const rows = (models ?? []).map((row: any) => {
      const mapped = mapModel(row);
      const provider = providerById.get(row.provider_id);
      const key = provider
        ? buildCatalogKey({ code: provider.code, kind: provider.kind }, row.model_id)
        : row.model_id;
      mapped.priced = pricingSummary(pricingRows, mapped.kind, key).priced;
      return mapped;
    });
    return { rows, error: null as string | null };
  });

export const upsertProviderModel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(ModelUpsertInput)
  .handler(async ({ data, context }) => {
    if (!(await hasCreditAdminAccess(context.supabase))) {
      return { ok: false as const, error: "无管理权限" };
    }
    const table = (supabaseAdmin.from as any)("ai_provider_models");
    const payload = {
      provider_id: data.providerId,
      model_id: data.modelId,
      label: data.label,
      kind: data.kind,
      capabilities: data.capabilities,
      listed: data.listed,
      enabled: data.enabled,
      is_default: data.isDefault,
      sort_order: data.sortOrder,
      note: data.note || null,
      updated_at: new Date().toISOString(),
    };
    const { error } = data.id
      ? await table.update(payload).eq("id", data.id)
      : await table.insert(payload);
    if (error) {
      console.error("[aiProviders] upsertProviderModel failed:", error);
      return { ok: false as const, error: error.message };
    }
    invalidateProviderCaches();
    return { ok: true as const, error: null as string | null };
  });

export const deleteProviderModel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(ModelDeleteInput)
  .handler(async ({ data, context }) => {
    if (!(await hasCreditAdminAccess(context.supabase))) {
      return { ok: false as const, error: "无管理权限" };
    }
    const { error } = await (supabaseAdmin.from as any)("ai_provider_models")
      .delete()
      .eq("id", data.id);
    if (error) {
      console.error("[aiProviders] deleteProviderModel failed:", error);
      return { ok: false as const, error: error.message };
    }
    invalidateProviderCaches();
    return { ok: true as const, error: null as string | null };
  });

export const toggleModelListing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(ToggleModelInput)
  .handler(async ({ data, context }) => {
    if (!(await hasCreditAdminAccess(context.supabase))) {
      return { ok: false as const, error: "无管理权限" };
    }
    const { error } = await (supabaseAdmin.from as any)("ai_provider_models")
      .update({ listed: data.value, updated_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) return { ok: false as const, error: error.message };
    invalidateProviderCaches();
    return { ok: true as const, error: null as string | null };
  });

export const toggleModelEnabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(ToggleModelInput)
  .handler(async ({ data, context }) => {
    if (!(await hasCreditAdminAccess(context.supabase))) {
      return { ok: false as const, error: "无管理权限" };
    }
    const { error } = await (supabaseAdmin.from as any)("ai_provider_models")
      .update({ enabled: data.value, updated_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) return { ok: false as const, error: error.message };
    invalidateProviderCaches();
    return { ok: true as const, error: null as string | null };
  });

// --------------------------------------------------------------------
// 管理端：连通性测试（最小请求 + 超时，密钥不落日志）
// --------------------------------------------------------------------

export const TEST_PROVIDER_TIMEOUT_MS = 10_000;

export const testProviderConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(TestConnectionInput)
  .handler(async ({ data, context }) => {
    if (!(await hasCreditAdminAccess(context.supabase))) {
      return { ok: false as const, error: "无管理权限" };
    }
    const { resolveProviderCredentials } = await import("./dynamicProvider.functions");
    const creds = await resolveProviderCredentials(data.id);
    if (!creds.ok) return { ok: false as const, error: creds.error };

    const startedAt = Date.now();
    try {
      // 最小请求：OpenAI 兼容网关普遍提供 GET /v1/models
      const res = await fetch(`${creds.baseUrl}/v1/models`, {
        headers: creds.headers,
        signal: AbortSignal.timeout(TEST_PROVIDER_TIMEOUT_MS),
      });
      const durationMs = Date.now() - startedAt;
      // 只消费状态码，不记录响应体（可能含账户信息）
      await res.arrayBuffer().catch(() => {});
      const ok = res.status >= 200 && res.status < 300;
      return {
        ok: ok as boolean,
        status: res.status,
        durationMs,
        error: ok ? null : `上游返回 HTTP ${res.status}`,
      };
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const message =
        (error as Error)?.name === "TimeoutError" || (error as Error)?.name === "AbortError"
          ? `连接超时（>${TEST_PROVIDER_TIMEOUT_MS / 1000}s）`
          : `网络错误: ${(error as Error)?.message ?? "fetch failed"}`;
      return { ok: false as const, status: null, durationMs, error: message };
    }
  });

// --------------------------------------------------------------------
// 用户端：已上架模型目录（登录可读，supabaseAdmin 读，脱敏，60s 缓存）
// --------------------------------------------------------------------

/** 直接读库并刷新模块级缓存（普通函数，便于复用与测试） */
export async function fetchListedModelsFromDb(): Promise<ListedModelEntry[]> {
  const [{ data: providers, error: pErr }, { data: models, error: mErr }, pricingRows] =
    await Promise.all([
      (supabaseAdmin.from as any)("ai_providers")
        .select("id, code, name, kind, enabled, sort_order")
        .eq("enabled", true)
        .order("sort_order", { ascending: true }),
      (supabaseAdmin.from as any)("ai_provider_models")
        .select("provider_id, model_id, label, kind, capabilities, is_default, sort_order, note")
        .eq("listed", true)
        .eq("enabled", true)
        .order("sort_order", { ascending: true }),
      ensurePricingRows(),
    ]);
  if (pErr) throw new Error(pErr.message);
  if (mErr) throw new Error(mErr.message);

  const providerById = new Map<string, any>((providers ?? []).map((p: any) => [p.id, p]));
  const rows: ListedModelEntry[] = [];
  for (const m of models ?? []) {
    const provider = providerById.get(m.provider_id);
    if (!provider) continue; // 供应商已停用
    const key = buildCatalogKey({ code: provider.code, kind: provider.kind }, m.model_id);
    rows.push({
      key,
      label: m.label,
      sub: m.note ?? `[${provider.name}]`,
      kind: m.kind,
      providerCode: provider.code,
      providerName: provider.name,
      capabilities: (m.capabilities ?? {}) as ModelCapabilities,
      isDefault: m.is_default === true,
      sortOrder: Number(m.sort_order ?? 0),
      pricing: pricingSummary(pricingRows, m.kind, key),
    });
  }
  setListedModelsCache(rows);
  return rows;
}

export const listListedModels = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(ListListedModelsInput)
  .handler(async ({ data }) => {
    let rows = getListedModelsCache();
    if (!rows || isListedModelsCacheStale()) {
      try {
        rows = await fetchListedModelsFromDb();
      } catch (error) {
        console.error("[aiProviders] listListedModels failed:", error);
        return { models: [] as ListedModelEntry[], error: (error as Error).message };
      }
    }
    const models = data.kind ? rows.filter((row) => row.kind === data.kind) : rows;
    return { models, error: null as string | null };
  });
