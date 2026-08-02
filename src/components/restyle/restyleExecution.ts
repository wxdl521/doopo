// ====================================================================
//  转绘执行逻辑（纯函数，可测）
//
//  - GATES：11 个人工审核环节 id ↔ 流水线节点映射
//  - shouldPauseAt(config, gate)：极速全自动 → false；分步护航 → true；
//    自定义干预 → 按 manualGates 勾选
//  - isOverBudget(spent, budget)：自动执行总预算校验
//  - isInsufficientCreditsError：余额不足错误识别（强制暂停信号）
// ====================================================================

export type RestyleExecutionMode = "auto" | "guided" | "custom";
export type RestyleAssetImageSource = "system" | "upload" | "mixed";
export type RestyleVoiceSource = "auto" | "voice_pick" | "upload";
export type RestyleAspect = "16:9" | "4:3" | "3:4" | "9:16";

export const RESTYLE_ASPECTS: readonly RestyleAspect[] = ["16:9", "4:3", "3:4", "9:16"];

export const DEFAULT_EXECUTION_MODE: RestyleExecutionMode = "guided";
export const DEFAULT_AUTO_BUDGET = 100_000;
export const DEFAULT_ASSET_IMAGE_SOURCE: RestyleAssetImageSource = "system";
export const DEFAULT_VOICE_SOURCE: RestyleVoiceSource = "auto";
export const DEFAULT_ASPECT: RestyleAspect = "9:16";

/** 转绘流水线节点：环节审核挂到的实际流程位置。 */
export type RestylePipelineNode =
  | "analysis" // 原片分析产出资产表
  | "asset_images" // 资产图片生成
  | "voice" // 角色音色与声音（v1 流水线尚未接入，占位）
  | "plan" // 转绘方案 / 分镜
  | "render" // 视频分组、报价与生成
  | "stitch"; // 字幕与最终合成

export type RestyleGate = {
  id: string;
  /** 对应的流水线节点，执行侧按节点找到暂停点。 */
  node: RestylePipelineNode;
};

/** 11 个需要人工审核的环节（顺序即流水线顺序）。 */
export const GATES: readonly RestyleGate[] = [
  { id: "asset_setting", node: "analysis" }, // 目标资产设定
  { id: "storyboard", node: "plan" }, // 生成目标分镜
  { id: "storyboard_review", node: "plan" }, // 分镜字幕与时长审核
  { id: "asset_image_source", node: "asset_images" }, // 资产图片来源
  { id: "character_images", node: "asset_images" }, // 角色主图与三视图
  { id: "all_asset_images", node: "asset_images" }, // 全部目标资产图片
  { id: "voice_plan", node: "voice" }, // 角色音色方案
  { id: "voice_files", node: "voice" }, // 角色声音文件
  { id: "video_grouping", node: "render" }, // 视频分组方案
  { id: "video_quote", node: "render" }, // 视频生成报价
  { id: "subtitle_final", node: "stitch" }, // 字幕与最终合成
] as const;

export type RestyleGateId = (typeof GATES)[number]["id"];

export function isRestyleGateId(value: unknown): value is RestyleGateId {
  return typeof value === "string" && GATES.some((gate) => gate.id === value);
}

/** 执行配置：与 RestyleProject 上的持久化字段一一对应。 */
export type RestyleExecutionConfig = {
  executionMode?: RestyleExecutionMode;
  autoBudget?: number;
  assetImageSource?: RestyleAssetImageSource;
  voiceSource?: RestyleVoiceSource;
  manualGates?: string[];
};

/** 填充默认值后的执行配置。 */
export function resolveExecutionConfig(config?: RestyleExecutionConfig | null): Required<RestyleExecutionConfig> {
  return {
    executionMode: config?.executionMode ?? DEFAULT_EXECUTION_MODE,
    autoBudget:
      typeof config?.autoBudget === "number" && config.autoBudget > 0
        ? config.autoBudget
        : DEFAULT_AUTO_BUDGET,
    assetImageSource: config?.assetImageSource ?? DEFAULT_ASSET_IMAGE_SOURCE,
    voiceSource: config?.voiceSource ?? DEFAULT_VOICE_SOURCE,
    manualGates: (config?.manualGates ?? []).filter(isRestyleGateId),
  };
}

/**
 * 该环节完成后是否暂停等待人工确认：
 * - 极速全自动：从不暂停（异常 / 预算超限 / 余额不足仍由执行侧强制暂停）
 * - 分步护航（默认）：每个环节都暂停
 * - 自定义干预：仅暂停勾选了的环节
 */
export function shouldPauseAt(
  config: RestyleExecutionConfig | null | undefined,
  gate: RestyleGateId,
): boolean {
  const resolved = resolveExecutionConfig(config);
  if (resolved.executionMode === "auto") return false;
  if (resolved.executionMode === "custom") return resolved.manualGates.includes(gate);
  return true;
}

/** 累计消耗是否已达预算上限。budget 非正数视为未设置预算，不拦截。 */
export function isOverBudget(spent: number, budget?: number | null): boolean {
  if (typeof budget !== "number" || !Number.isFinite(budget) || budget <= 0) return false;
  return spent >= budget;
}

/** 余额不足错误：任何模式下都强制暂停。兼容 code 与错误文案两种形态。 */
export function isInsufficientCreditsError(error?: string | null): boolean {
  return Boolean(error && /INSUFFICIENT_CREDITS|余额不足|insufficient credits/i.test(error));
}
