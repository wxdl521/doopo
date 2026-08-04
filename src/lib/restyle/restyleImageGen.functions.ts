// ====================================================================
// 转绘 v2 · 阶段 B 第二步（造型化生图 + 换装区间 + 音色方案）服务端壳。
// 核心逻辑在 restyleImageGen.core.ts，拆开是为了避免 import-protection
// 把服务端依赖带进客户端图（同 restyleAssetMapping.functions.ts 模式）。
// ====================================================================
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  ConfirmArtifactInputSchema,
  EstimateImagesInputSchema,
  GenerateImagesInputSchema,
  GenerateVoiceVideoInputSchema,
  ListImageGenInputSchema,
  PlanLooksInputSchema,
  PlanPromptsInputSchema,
  PlanVoiceInputSchema,
  confirmCharacterLooksCore,
  confirmVoicePlanCore,
  estimateCharacterImagesCore,
  generateCharacterImagesCore,
  generateVoiceReferenceVideoCore,
  listImageGenCore,
  planCharacterLooksCore,
  planImagePromptsCore,
  planVoiceProfilesCore,
  type ConfirmResult,
  type EstimateImagesResult,
  type GenerateImagesResult,
  type GenerateVoiceVideoResult,
  type ListImageGenResult,
  type PlanLooksResult,
  type PlanPromptsResult,
  type PlanVoiceResult,
} from "./restyleImageGen.core";

type SupabaseContext = { supabase: any; userId: string };

export type {
  EstimateImagesResult,
  GenerateImagesResult,
  GenerateVoiceVideoResult,
  ImageGenData,
  ListImageGenResult,
  PlanLooksResult,
  PlanPromptsResult,
  PlanVoiceResult,
} from "./restyleImageGen.core";

/**
 * 规划换装区间：闸门（asset_mapping 全 user_approved）→ 导演模型
 * （wardrobe-continuity skill）→ 写 restyle_character_looks → 产物
 * （stage="image_gen", node="looks"）走确认关卡 → 成功扣 1 分（幂等键）。
 */
export const planCharacterLooksFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => PlanLooksInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<PlanLooksResult> => {
    const { supabase, userId } = context as SupabaseContext;
    return planCharacterLooksCore(data, { supabase, userId });
  });

/** 确认换装方案：产物置 user_approved；userContent.looks 改写回写 looks 表。 */
export const confirmCharacterLooksFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => ConfirmArtifactInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<ConfirmResult> => {
    const { supabase, userId } = context as SupabaseContext;
    return confirmCharacterLooksCore(data, { supabase, userId });
  });

/**
 * 组装生图提示词列表：looks 确认后，确定性产出「主图 + 三视图 + 逐 look
 * 主图/正/背/侧」提示词，产物（node="prompts"）走提示词确认关卡——
 * 用户确认/修改前 generateCharacterImagesFn 一律 STAGE_NOT_APPROVED。
 */
export const planImagePromptsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => PlanPromptsInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<PlanPromptsResult> => {
    const { supabase, userId } = context as SupabaseContext;
    return planImagePromptsCore(data, { supabase, userId });
  });

/** 生图积分预估（确认弹窗展示总积分；模型未计价时 credits 为 null）。 */
export const estimateCharacterImagesFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => EstimateImagesInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<EstimateImagesResult> => {
    const { supabase, userId } = context as SupabaseContext;
    return estimateCharacterImagesCore(data, { supabase, userId });
  });

/**
 * 造型化生图：双闸门（asset_mapping + image_gen/prompts 均 user_approved）
 * 后才真实调用生图；逐张积分预校验，成功按张 chargeCredits（幂等键
 * img:{projectId}:{characterId}:{lookId}:{scopeHash}），失败写
 * generation_error_logs 并继续后续张。characterIds 传子集即单角色重跑。
 */
export const generateCharacterImagesFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => GenerateImagesInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<GenerateImagesResult> => {
    const { supabase, userId } = context as SupabaseContext;
    return generateCharacterImagesCore(data, { supabase, userId });
  });

/**
 * 音色方案：按分镜数/分组数排角色重要度，导演模型产出音色描述，写
 * restyle_characters.voice_profile + 产物（stage="voice_plan"）确认关卡。
 */
export const planVoiceProfilesFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => PlanVoiceInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<PlanVoiceResult> => {
    const { supabase, userId } = context as SupabaseContext;
    return planVoiceProfilesCore(data, { supabase, userId });
  });

/** 确认音色方案：产物置 user_approved；userContent.profiles 改写回写 voice_profile。 */
export const confirmVoicePlanFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => ConfirmArtifactInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<ConfirmResult> => {
    const { supabase, userId } = context as SupabaseContext;
    return confirmVoicePlanCore(data, { supabase, userId });
  });

/**
 * 生成音色参考视频：仅重点角色（服务端再校验 tier），闸门为 voice_plan
 * 已确认；调现有视频通道（默认视频模型，图生视频 + 出声），视频通道
 * 成功时按 taskId 幂等扣费；结果 URL 回写 voice_profile。
 */
export const generateVoiceReferenceVideoFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => GenerateVoiceVideoInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<GenerateVoiceVideoResult> => {
    const { supabase, userId } = context as SupabaseContext;
    return generateVoiceReferenceVideoCore(data, { supabase, userId });
  });

/** 读回角色/换装区间/三类产物状态（ImageGenPanel 数据源）。 */
export const listImageGenFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => ListImageGenInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<ListImageGenResult> => {
    const { supabase, userId } = context as SupabaseContext;
    return listImageGenCore(data, { supabase, userId });
  });
