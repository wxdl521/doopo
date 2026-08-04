// ====================================================================
// 转绘 v2 · 阶段 B 资产映射（服务端壳）。核心逻辑在
// restyleAssetMapping.core.ts，拆开是为了避免 import-protection
// 把服务端依赖带进客户端图（同 restyleReview.functions.ts 模式）。
// ====================================================================
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  confirmAssetMappingCore,
  generateAssetMappingCore,
  listAssetMappingCore,
  ConfirmMappingInputSchema,
  GenerateMappingInputSchema,
  ListMappingInputSchema,
  type ConfirmMappingResult,
  type GenerateMappingResult,
  type ListMappingResult,
} from "./restyleAssetMapping.core";

type SupabaseContext = { supabase: any; userId: string };

export type {
  AssetMappingData,
  ConfirmMappingResult,
  GenerateMappingResult,
  ListMappingResult,
} from "./restyleAssetMapping.core";

/**
 * 生成原片→目标资产映射：闸门（analysis 全 user_approved）→ 导演模型
 * （character-bible skill）→ 写目标资产四表 + 关系表 → 产物
 * （stage="asset_mapping"）走状态机 → 成功扣 1 分（幂等键防重复）。
 */
export const generateAssetMappingFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => GenerateMappingInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<GenerateMappingResult> => {
    const { supabase, userId } = context as SupabaseContext;
    return generateAssetMappingCore(data, { supabase, userId });
  });

/**
 * 人工确认资产映射：产物置 user_approved（可带 userContent 改写），
 * 改写的角色字段同步回写 restyle_characters。
 */
export const confirmAssetMappingFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => ConfirmMappingInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<ConfirmMappingResult> => {
    const { supabase, userId } = context as SupabaseContext;
    return confirmAssetMappingCore(data, { supabase, userId });
  });

/** 读回 characters/relations/scenes/props/ignored + 映射产物状态。 */
export const listAssetMappingFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => ListMappingInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<ListMappingResult> => {
    const { supabase, userId } = context as SupabaseContext;
    return listAssetMappingCore(data, { supabase, userId });
  });
