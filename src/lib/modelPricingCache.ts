// ====================================================================
//  model_pricing 模块级缓存（60s TTL）
//
//  独立成无依赖模块，供 modelPricing.functions.ts（服务端读写）与
//  creditsCost.ts（扣费查询）共用，避免 creditsCost 引入 server-only 依赖。
// ====================================================================

export type ModelPricingKind = "video" | "image";

export type ModelPricingRow = {
  id: string;
  kind: ModelPricingKind;
  modelId: string;
  label: string;
  resolution: string | null;
  credits: number;
  note: string | null;
  isDefault: boolean;
  enabled: boolean;
  sortOrder: number;
};

export const MODEL_PRICING_CACHE_TTL_MS = 60_000;

let cache: { rows: ModelPricingRow[]; fetchedAt: number } | null = null;

// 最近一次 listModelPricing 使用的已登录 supabase 客户端。creditsCost 的
// 同步扣费路径无法自己拿到请求上下文，缓存过期时用它后台刷新（fire-and-forget）。
let refreshClient: unknown = null;

export function getModelPricingRows(): ModelPricingRow[] | null {
  return cache?.rows ?? null;
}

export function isModelPricingCacheStale(): boolean {
  return !cache || Date.now() - cache.fetchedAt > MODEL_PRICING_CACHE_TTL_MS;
}

export function setModelPricingCache(rows: ModelPricingRow[]): void {
  cache = { rows, fetchedAt: Date.now() };
}

export function invalidateModelPricingCache(): void {
  cache = null;
}

export function registerModelPricingClient(client: unknown): void {
  refreshClient = client;
}

export function getRegisteredModelPricingClient(): unknown {
  return refreshClient;
}
