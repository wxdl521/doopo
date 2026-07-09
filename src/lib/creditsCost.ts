// ====================================================================
//  模型调用积分消耗价目表 + 计算
//
//  - 生图:按张固定价,前缀匹配(tokenflash / revora / azure)
//  - 视频:按 mode + 分辨率(每10秒单价),实际按 duration/10 比例
//  - 不在表内的模型返回 null(不扣分)
//
//  价目由产品定义,见 .claude/plans/credits-consumption.md
// ====================================================================

// 生图:前缀 -> 积分/张
const IMAGE_CREDITS: { prefix: string; cost: number }[] = [
  { prefix: "tokenflash/", cost: 5 },
  { prefix: "revora/", cost: 4 },
  { prefix: "azure/", cost: 9 },
  { prefix: "azure2/", cost: 9 },
  { prefix: "azure3/", cost: 9 },
];

// 视频:模型 id -> { 分辨率 -> 每10秒单价 }
const VIDEO_CREDITS: Record<string, Record<string, number>> = {
  "kuaizi-lizhen-fast": { "480P": 89, "720P": 192 },
  "kuaizi-lizhen-pro": { "480P": 110.4, "720P": 118, "1080P": 593 },
  "kuaizi-lizhen-mini": { "480P": 56, "720P": 120 },
  "doubao-seedance-2-0-fast-260128": { "480P": 52, "720P": 114 },
  "doubao-seedance-2-0-260128": { "480P": 69, "720P": 146 },
};

/** 生图积分(按张)。模型不在价目表 -> null(不扣分) */
export function imageCost(model: string | undefined | null): number | null {
  if (!model) return null;
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
  const tiers = VIDEO_CREDITS[model];
  if (!tiers) return null;
  const res = (resolution || "720P").toUpperCase();
  const unit = tiers[res];
  if (unit == null) return null;
  // 价目表是每10秒单价,按 duration 比例;保留2位小数
  const seconds = duration > 0 ? duration : 10;
  return Math.round(unit * (seconds / 10) * 100) / 100;
}

/** 视频模型可选档位的积分范围(下拉框标注用),如 "56-593积分/10s" */
export function videoCostRange(model: string | undefined | null): string | null {
  if (!model) return null;
  const tiers = VIDEO_CREDITS[model];
  if (!tiers) return null;
  const costs = Object.values(tiers);
  if (costs.length === 0) return null;
  const min = Math.min(...costs);
  const max = Math.max(...costs);
  if (min === max) return `${min}积分/10s`;
  return `${min}-${max}积分/10s`;
}
