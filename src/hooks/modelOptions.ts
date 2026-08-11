// ====================================================================
// modelOptions —— 全站模型选择展示统一的纯函数（可单测）
//
// 统一规格（2026/08 全站统一）：
//   - label 格式（原生 select 纯文本）：{label} — {sub} · {价格|暂未计费} · {徽标}；
//   - 徽标只显示一个，优先级：暂未计费 > 默认 > 素材库预审（转绘视频专属，
//     由调用方经 assetLibrarySupported 传入）；未计费已由价格段承担，不重复徽标；
//   - 排序：调用方附加优先级（如转绘素材库预审排前）→ isDefault 靠前 →
//     catalog sortOrder；NewProjectDialog 旧的推荐前缀/✨/🕐 全部废除；
//   - 默认值链：已保存值（须仍在列表）→ 库内 is_default 行 → sortOrder 最前 →
//     硬编码常量兜底。
// ====================================================================

export interface ModelOptionLike {
  id: string;
  label: string;
  sub?: string;
  priced?: boolean;
  priceRange?: string | null;
  isDefault?: boolean;
  sortOrder?: number;
}

export interface ModelBadgeLabels {
  /** i18n listed_model_unpriced（「暂未计费」）。 */
  unpricedLabel: string;
  /** i18n restyle_setup_col_default（「默认推荐」）。 */
  defaultLabel: string;
  /** 转绘视频专属徽标（i18n restyle_video_model_asset_review）；不传则不评估。 */
  assetLibraryLabel?: string;
}

/**
 * 原生 select 的纯文本 label：
 *   {label} — {sub} · {价格|暂未计费} · {徽标}
 * 徽标只显示一个：未计费（已由价格段承担）> 默认 > 素材库预审。
 */
export function formatModelOptionLabel(
  model: Pick<ModelOptionLike, "label" | "sub" | "priced" | "priceRange" | "isDefault">,
  labels: ModelBadgeLabels,
  opts?: { assetLibrarySupported?: boolean },
): string {
  const head = model.sub ? `${model.label} — ${model.sub}` : model.label;
  const price = model.priceRange ?? (model.priced ? "" : labels.unpricedLabel);
  const badge = !model.priced
    ? "" // 未计费已由价格段承担
    : model.isDefault
      ? labels.defaultLabel
      : opts?.assetLibrarySupported && labels.assetLibraryLabel
        ? labels.assetLibraryLabel
        : "";
  return [head, price, badge].filter(Boolean).join(" · ");
}

/**
 * 统一排序：priorityOf（调用方附加优先级，值大者排前，如转绘素材库预审=1）→
 * isDefault 靠前 → catalog sortOrder 升序。稳定排序（同档保持原顺序）。
 */
export function sortListedModels<T extends Pick<ModelOptionLike, "isDefault" | "sortOrder">>(
  models: readonly T[],
  priorityOf?: (model: T) => number,
): T[] {
  return [...models].sort(
    (a, b) =>
      (priorityOf ? priorityOf(b) - priorityOf(a) : 0) ||
      Number(b.isDefault ?? false) - Number(a.isDefault ?? false) ||
      (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
  );
}

/**
 * 默认值统一优先级：已保存值（须仍在列表中）→ 库内 is_default 行（sortOrder 最前）→
 * sortOrder 最前 → 硬编码常量兜底（列表为空或全部兜不住时）。
 */
export function resolveDefaultModel(
  models: ReadonlyArray<Pick<ModelOptionLike, "id" | "isDefault" | "sortOrder">>,
  savedId: string | undefined,
  hardFallback: string,
): string {
  if (savedId && models.some((m) => m.id === savedId)) return savedId;
  const defaults = models
    .filter((m) => m.isDefault)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  if (defaults.length) return defaults[0].id;
  const sorted = [...models].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  return sorted[0]?.id ?? hardFallback;
}
