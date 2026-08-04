// ====================================================================
//  供应商目录共享类型 + 内置路由前缀清单 + 已上架目录模块级缓存（60s TTL）
//
//  独立成无依赖模块（与 modelPricingCache.ts 同款模式），供
//  aiProviders.functions.ts（服务端读写）、dynamicProvider.functions.ts
//  （动态适配器兜底路由）与单元测试共用。
// ====================================================================

// --------------------------------------------------------------------
// 内置路由前缀清单 —— 从 seedream.functions.ts 的图像分发链与
// videoGenerate.functions.ts 的 getVideoBackend 提取。
//
// 动态供应商（kind='openai_compatible'）的 code 是用户侧路由 key 的前缀
// （<code>/<model_id>），若与内置前缀冲突会劫持既有内置路由，因此：
//   - upsertProvider 校验 code 不与此清单冲突（小写归一）
//   - 动态兜底分发时前缀命中此清单一律跳过（双保险）
// --------------------------------------------------------------------
export const BUILTIN_ROUTE_PREFIXES: readonly string[] = [
  // 图像 · seedream.functions.ts 分发链（含归一化别名 openai/gpt-image-2）
  "pixflow",
  "claude360",
  "tokenflash",
  "revora",
  "aigcfamily",
  "shuci",
  "azure",
  "azure2",
  "azure3",
  "azure0716",
  "onetoken",
  "otu",
  "aitokenvibe",
  "thhtcloud",
  "ailinzi",
  "vapeur",
  "agentearth",
  "tokenhub",
  "nagora",
  "meridian",
  "confluo",
  "lingmeng",
  "lovable",
  "openai",
  // 图像 · DashScope / ARK 无前缀模型族（路由按 id 前缀匹配）
  "qwen",
  "wan",
  "wanx",
  "doubao",
  "seedream",
  // 视频 · videoGenerate.functions.ts getVideoBackend
  "earth",
  "dreamina",
  "seedance",
  "jimeng",
  "kuaizi",
  "toapis",
  "k99",
  "kling",
  "topenrouter",
  "hongmeng",
  "keyiyun",
  "ycore",
  "neiwen",
  "happyhorse",
  "ark",
  "dashscope",
];

const BUILTIN_PREFIX_SET = new Set(BUILTIN_ROUTE_PREFIXES.map((p) => p.toLowerCase()));

/** code 是否与内置路由前缀冲突（小写归一） */
export function isBuiltinRoutePrefix(code: string): boolean {
  return BUILTIN_PREFIX_SET.has((code || "").trim().toLowerCase());
}

// --------------------------------------------------------------------
// 类型
// --------------------------------------------------------------------
export type AiProviderKind = "openai_compatible" | "builtin";
export type AiProviderModelKind = "image" | "video" | "text";

/**
 * 模型能力声明。edits_protocol 与 auth_header 为强制字段（correction #4）：
 * 动态适配器按声明组请求，不猜协议。
 */
export type ModelCapabilities = {
  t2i?: boolean;
  i2i?: boolean;
  max_reference_images?: number;
  sizes?: string[];
  resolutions?: string[];
  /** 图像编辑（I2I）协议：json=参考图放 JSON body；multipart=OpenAI 风格表单 */
  edits_protocol: "json" | "multipart";
  /** 认证头：bearer=Authorization: Bearer；x-api-key=api-key: <key> */
  auth_header: "bearer" | "x-api-key";
  /** 生图走 /v1/chat/completions（gemini 风格）而非 /v1/images/* */
  api?: "images" | "chat";
};

export type AiProviderRow = {
  id: string;
  code: string;
  name: string;
  kind: AiProviderKind;
  baseUrl: string | null;
  apiKeyHint: string | null;
  envKeyName: string | null;
  hasApiKey: boolean;
  enabled: boolean;
  sortOrder: number;
};

export type AiProviderModelRow = {
  id: string;
  providerId: string;
  modelId: string;
  label: string;
  kind: AiProviderModelKind;
  capabilities: ModelCapabilities;
  listed: boolean;
  enabled: boolean;
  isDefault: boolean;
  sortOrder: number;
  note: string | null;
  /** 该模型在 model_pricing 是否有有效价目行（管理端「定价状态」列用） */
  priced?: boolean;
};

/** 用户端目录条目（脱敏：不含 base_url / 密钥） */
export type ListedModelEntry = {
  /** 路由 key：内置供应商 = 现有路由 id；动态供应商 = <code>/<model_id> */
  key: string;
  label: string;
  sub: string | null;
  kind: AiProviderModelKind;
  providerCode: string;
  providerName: string;
  capabilities: ModelCapabilities;
  isDefault: boolean;
  sortOrder: number;
  pricing: { priced: boolean; range: string | null };
};

/**
 * 用户侧路由 key：
 *   - builtin：model_id 即现有路由 id（种子数据按此存储），原样返回
 *   - openai_compatible：<provider.code>/<model_id>
 */
export function buildCatalogKey(
  provider: { code: string; kind: AiProviderKind },
  modelId: string,
): string {
  return provider.kind === "builtin" ? modelId : `${provider.code.toLowerCase()}/${modelId}`;
}

// --------------------------------------------------------------------
// 价目匹配（与 creditsCost.ts 的 dbImageCost / dbVideoUnitCost 同规则）
// 供 aiProviders.functions（目录定价状态）与 dynamicProvider.functions
// （未定价禁提交闸门）共用；仅依赖 modelPricingCache 的类型。
// --------------------------------------------------------------------
import type { ModelPricingRow } from "./modelPricingCache";

/** 图像价目：前缀最长匹配，无命中 -> null */
export function imagePricingFor(rows: ModelPricingRow[], key: string): number | null {
  const m = key.toLowerCase();
  let best: { credits: number; prefixLen: number } | null = null;
  for (const row of rows) {
    if (row.kind !== "image" || !row.enabled) continue;
    if (!m.startsWith(row.modelId.toLowerCase())) continue;
    if (!best || row.modelId.length > best.prefixLen) {
      best = { credits: row.credits, prefixLen: row.modelId.length };
    }
  }
  return best?.credits ?? null;
}

/** 视频价目：模型精确匹配的全部启用档位单价 */
export function videoPricingFor(rows: ModelPricingRow[], key: string): number[] {
  return rows
    .filter((row) => row.kind === "video" && row.enabled && row.modelId === key)
    .map((row) => row.credits);
}

/** 目录条目 / 管理端「定价状态」列的展示摘要 */
export function pricingSummary(
  rows: ModelPricingRow[],
  kind: "image" | "video" | "text",
  key: string,
): { priced: boolean; range: string | null } {
  if (kind === "image") {
    const cost = imagePricingFor(rows, key);
    return cost == null
      ? { priced: false, range: null }
      : { priced: true, range: `${cost}积分/张` };
  }
  if (kind === "video") {
    const costs = videoPricingFor(rows, key);
    if (costs.length === 0) return { priced: false, range: null };
    const min = Math.min(...costs);
    const max = Math.max(...costs);
    return {
      priced: true,
      range: min === max ? `${min}积分/10s` : `${min}-${max}积分/10s`,
    };
  }
  return { priced: false, range: null };
}

// --------------------------------------------------------------------
// 已上架目录模块级缓存（60s TTL，写操作后由 aiProviders.functions 失效）
// --------------------------------------------------------------------
export const LISTED_MODELS_CACHE_TTL_MS = 60_000;

let cache: { rows: ListedModelEntry[]; fetchedAt: number } | null = null;

export function getListedModelsCache(): ListedModelEntry[] | null {
  return cache?.rows ?? null;
}

export function isListedModelsCacheStale(): boolean {
  return !cache || Date.now() - cache.fetchedAt > LISTED_MODELS_CACHE_TTL_MS;
}

export function setListedModelsCache(rows: ListedModelEntry[]): void {
  cache = { rows, fetchedAt: Date.now() };
}

export function invalidateListedModelsCache(): void {
  cache = null;
}
