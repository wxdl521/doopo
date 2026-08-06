// ====================================================================
// imageModelFallback —— 资产生图渠道自动降级（纯函数，可单测）
//
// 线上事故：默认渠道（tokenflash/gpt-image-2）余额 $0 全部 403，资产
// 生图逐张失败后流程静默卡死。修复分两部分，本模块提供判定逻辑：
//   - isQuotaLikeImageError：只认配额/余额/权限类错误（403/401/quota/
//     balance/billing 等）为可换渠道；内容审核类失败各渠道口径趋同，
//     换渠道无意义，明确排除。
//   - imageModelFallbackCandidates：按可用模型列表顺序给出 fallback
//     候选（排除当前与已知不可用渠道），供逐渠道重试。
// ====================================================================

/** 内容审核类错误特征（换渠道重试无意义，直接判失败）。 */
const SENSITIVE_ERROR_PATTERN =
  /敏感|审核|违规|nsfw|sensitive|moderation|content.?policy|不适宜|real person/i;

/** 配额/余额/权限类错误特征（换渠道可能成功）。 */
const QUOTA_ERROR_PATTERN =
  /403|401|余额|配额|欠费|额度|超限|quota|balance|insufficient|credit|billing|payment|permission|forbidden|unauthorized/i;

/**
 * 是否「可换渠道重试」的配额/权限类失败。
 * 内容审核类优先判否（即使报错里同时带 403）。
 */
export function isQuotaLikeImageError(error: string | undefined | null): boolean {
  if (!error) return false;
  if (SENSITIVE_ERROR_PATTERN.test(error)) return false;
  return QUOTA_ERROR_PATTERN.test(error);
}

/**
 * 按可用模型列表顺序给出 fallback 候选：排除当前模型与 excluded
 * （本轮已判定不可用的渠道），保持列表原始顺序（列表本身已按
 * 上架目录排序，与下拉框同序）。
 */
export function imageModelFallbackCandidates(
  currentModel: string,
  availableModelIds: string[],
  excluded: ReadonlySet<string> = new Set(),
): string[] {
  return availableModelIds.filter((id) => id !== currentModel && !excluded.has(id));
}
