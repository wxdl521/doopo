// ====================================================================
// 转绘 v2 · 阶段 B 第三步（按集分组 + 连贯性核对）服务端壳。
// 核心逻辑在 restyleGrouping.core.ts，拆开是为了避免 import-protection
// 把服务端依赖带进客户端图（同 restyleImageGen.functions.ts 模式）。
// ====================================================================
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  GenerateGroupingInputSchema,
  ListGroupingInputSchema,
  UpdateGroupingInputSchema,
  generateGroupingCore,
  listGroupingCore,
  updateGroupingCore,
  type GenerateGroupingResult,
  type ListGroupingResult,
  type UpdateGroupingResult,
} from "./restyleGrouping.core";

type SupabaseContext = { supabase: any; userId: string };

export type {
  EpisodeGroupingData,
  GenerateGroupingResult,
  GroupingArtifactInfo,
  GroupingGroupRow,
  GroupingIssue,
  GroupingLookInfo,
  GroupingShotInfo,
  ListGroupingResult,
  UpdateGroupingResult,
} from "./restyleGrouping.core";

/**
 * 生成分组：闸门（image_gen 阶段产物全 user_approved）→ 导演模型
 * （shot-to-segment skill）产出带 reason 的分组建议 → validateGroups
 * 校验兜底修正（packShotsIntoGroups）→ 整表按集替换 restyle_groups →
 * 写分组确认记录（artifacts stage="grouping"，node_key=episodeId，含
 * scope_hash/groupCount/totalDurationSeconds）→ 连贯性核对
 * （ai-output-review）结果进产物 issues → 成功扣 1 分（幂等键
 * grouping:{projectId}:{episodeId}:{scopeHash}）。
 */
export const generateGroupingFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => GenerateGroupingInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<GenerateGroupingResult> => {
    const { supabase, userId } = context as SupabaseContext;
    return generateGroupingCore(data, { supabase, userId });
  });

/**
 * 保存手动调整：validateGroups 校验（覆盖/重叠/时长/归属）通过后整表
 * 替换；上游分镜变化导致 scope_hash 失效时返回 SCOPE_STALE（面板高亮
 * 「需重新确认」）；保存后产物回落 draft 待重新确认。
 */
export const updateGroupingFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => UpdateGroupingInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<UpdateGroupingResult> => {
    const { supabase, userId } = context as SupabaseContext;
    return updateGroupingCore(data, { supabase, userId });
  });

/** 读回分镜/分组行/产物状态/scope 失效率高亮（GroupingPanel 数据源）。 */
export const listGroupingFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => ListGroupingInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<ListGroupingResult> => {
    const { supabase, userId } = context as SupabaseContext;
    return listGroupingCore(data, { supabase, userId });
  });
