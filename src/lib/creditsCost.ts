// ====================================================================
//  模型调用积分消耗价目表 + 计算
//
//  - 优先读数据库 public.model_pricing（模块级缓存 60s，由 listModelPricing /
//    refreshModelPricingCache 预热），查不到再回落下面的静态价目表兜底
//  - 生图:按张固定价,前缀匹配(tokenflash / revora / azure)
//  - 视频:按 mode + 分辨率(每10秒单价),实际按 duration/10 比例
//  - 不在表内的模型返回 null(不扣分)
//
//  价目由产品定义,见 .claude/plans/credits-consumption.md
// ====================================================================

import { getModelPricingRows, isModelPricingCacheStale } from "./modelPricingCache";

// 生图:前缀 -> 积分/张(兜底表,数据库无缓存或未命中时使用)
const IMAGE_CREDITS: { prefix: string; cost: number }[] = [
  { prefix: "tokenflash/", cost: 5 },
  { prefix: "revora/", cost: 4 },
  { prefix: "azure/", cost: 9 },
  { prefix: "azure2/", cost: 9 },
  { prefix: "azure3/", cost: 9 },
  { prefix: "azure0716/", cost: 9 },
];

// 视频:模型 id -> { 分辨率 -> 每10秒单价 }(兜底表)
const VIDEO_CREDITS: Record<string, Record<string, number>> = {
  "kuaizi-lizhen-fast": { "480P": 89, "720P": 192 },
  "kuaizi-lizhen-pro": { "480P": 110.4, "720P": 118, "1080P": 593 },
  "kuaizi-lizhen-mini": { "480P": 56, "720P": 120 },
  "doubao-seedance-2-0-fast-260128": { "480P": 192, "720P": 192 },
  "doubao-seedance-2-0-260128": { "480P": 237.6, "720P": 237.6 },
};

// 同步扣费路径拿不到请求上下文:缓存过期时用最近注册的登录客户端后台刷新,
// 本次调用仍用旧缓存/兜底表,下一次起按新价目。
let refreshing = false;
function ensurePricingFresh(): void {
  if (!isModelPricingCacheStale() || refreshing) return;
  refreshing = true;
  void import("./modelPricing.functions")
    .then((m) => m.refreshModelPricingCache())
    .catch(() => {})
    .finally(() => {
      refreshing = false;
    });
}

/** 数据库价目:生图按张(前缀匹配,最长前缀优先),无缓存或未启用 -> null */
function dbImageCost(model: string): number | null {
  const rows = getModelPricingRows();
  if (!rows) return null;
  const m = model.toLowerCase();
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

/** 数据库价目:视频每10秒单价(模型 + 分辨率精确匹配),未命中 -> null */
function dbVideoUnitCost(model: string, resolution: string): number | null {
  const rows = getModelPricingRows();
  if (!rows) return null;
  for (const row of rows) {
    if (row.kind !== "video" || !row.enabled) continue;
    if (row.modelId !== model) continue;
    if ((row.resolution || "").toUpperCase() !== resolution) continue;
    return row.credits;
  }
  return null;
}

/** 生图积分(按张)。模型不在价目表 -> null(不扣分) */
export function imageCost(model: string | undefined | null): number | null {
  if (!model) return null;
  ensurePricingFresh();
  const dbCost = dbImageCost(model);
  if (dbCost != null) return dbCost;
  const m = model.toLowerCase();
  for (const { prefix, cost } of IMAGE_CREDITS) {
    if (m.startsWith(prefix.toLowerCase())) return cost;
  }
  return null;
}

/** 视频积分(按 duration 比例)。模型+分辨率不在价目表 -> null(不扣分) */
export function videoCost(
  model: string | undefined | null,
  resolution: string | undefined | null,
  duration: number,
): number | null {
  if (!model) return null;
  ensurePricingFresh();
  const res = (resolution || "720P").toUpperCase();
  const unit = dbVideoUnitCost(model, res) ?? VIDEO_CREDITS[model]?.[res];
  if (unit == null) return null;
  // 价目表是每10秒单价,按 duration 比例;保留2位小数
  const seconds = duration > 0 ? duration : 10;
  return Math.round(unit * (seconds / 10) * 100) / 100;
}

/** 视频模型可选档位的积分范围(下拉框标注用),如 "56-593积分/10s" */
export function videoCostRange(model: string | undefined | null): string | null {
  if (!model) return null;
  ensurePricingFresh();
  const dbRows = (getModelPricingRows() ?? []).filter(
    (row) => row.kind === "video" && row.enabled && row.modelId === model,
  );
  const costs =
    dbRows.length > 0 ? dbRows.map((row) => row.credits) : Object.values(VIDEO_CREDITS[model] ?? {});
  if (costs.length === 0) return null;
  const min = Math.min(...costs);
  const max = Math.max(...costs);
  if (min === max) return `${min}积分/10s`;
  return `${min}-${max}积分/10s`;
}
