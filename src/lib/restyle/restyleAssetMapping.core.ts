// ====================================================================
//  转绘 v2 阶段 B（第一步）· 原片→目标资产映射 + 身份锁定
//
//  流程（generateAssetMappingCore）：
//    1. 积分预校验 ensureEnoughCredits(1)
//    2. 阶段闸门：stage="analysis" 产物须全部 user_approved，否则
//       STAGE_NOT_APPROVED（不调模型，与 restyleReview 同口径）。
//    3. 读项目画风 + 源资产（restyle_source_assets，可按 episodeIds 过滤）。
//    4. 调导演模型（composePrompt(["character-bible"], context)，主模型
//       失败回退一次）产出映射建议；normalizeLlmSuggestions 归一化。
//    5. mapSourceToTarget 合并/去重/跨集归并 + validateCharacterBible
//       关系表闭合校验（校验问题写进产物 issues，不阻断写表）。
//    6. 写 restyle_characters（按 project_id+name upsert）/ relations /
//       scenes / props / ignored_assets。
//    7. 产物 upsert restyle_artifacts（stage="asset_mapping",
//       node_key="project"），走 artifactState 状态机。
//    8. 成功 chargeCredits 1 分，幂等键 asset-mapping:{projectId}:{scopeHash}。
//
//  本步只做准备：不生图、不换装、不分组。context 收窄为
//  { supabase: any; userId }（同 restyleArtifacts.functions.ts 惯例）。
// ====================================================================

import { z } from "zod";
import { ensureEnoughCredits } from "../creditsGuard";
import { logGenerationError } from "../errorLogs.server";
import {
  callLovableChat,
  INTERNAL_DIRECTOR_FALLBACK_MODEL,
  INTERNAL_DIRECTOR_MODEL,
  type ChatMessage,
  type GatewayChatResult,
} from "./lovableGateway";
import { composePrompt } from "./skills";
import { resignMediaDeep } from "../mediaResign.server";
import { extractJson } from "./restyleVideoAnalysis.functions";
import {
  createInitialArtifact,
  transitionArtifact,
  type ArtifactState,
  type JsonValue,
} from "./artifactState";
import {
  computeAssetScopeHash,
  mapSourceToTarget,
  normalizeLlmSuggestions,
  validateCharacterBible,
  type AssetMappingResult,
  type CharacterBibleIssue,
  type SourceAssetInput,
} from "./assetMapping";

type SupabaseContext = { supabase: any; userId: string };

export const ASSET_MAPPING_STAGE = "asset_mapping";
export const ASSET_MAPPING_NODE_KEY = "project";
const MAPPING_CREDIT_COST = 1;

export const GenerateMappingInputSchema = z.object({
  projectId: z.string().min(1).max(128),
  episodeIds: z.array(z.string().min(1).max(128)).max(200).optional(),
});

export const ConfirmMappingInputSchema = z.object({
  projectId: z.string().min(1).max(128),
  userContent: z.unknown().optional(),
});

export const ListMappingInputSchema = z.object({
  projectId: z.string().min(1).max(128),
});

// --------------------------------------------------------------------
// 依赖注入（测试可替换 callChat / ensureCredits / chargeCredits）
// --------------------------------------------------------------------

export interface AssetMappingDeps {
  supabase: any;
  userId: string;
  callChat?: (opts: {
    model: string;
    messages: ChatMessage[];
    maxTokens?: number;
    timeoutMs?: number;
    jsonMode?: boolean;
  }) => Promise<GatewayChatResult>;
  ensureCredits?: typeof ensureEnoughCredits;
  chargeCredits?: (params: {
    amount: number;
    model?: string;
    description: string;
    idempotencyKey?: string;
  }) => Promise<{ ok: boolean; balanceAfter: number | null; deduped?: boolean }>;
}

export type GenerateMappingResult =
  | {
      ok: true;
      projectId: string;
      scopeHash: string;
      counts: { characters: number; relations: number; scenes: number; props: number; ignored: number };
      validationIssues: CharacterBibleIssue[];
      unmappedSourceNames: string[];
      model: string;
      usedFallback: boolean;
    }
  | { ok: false; code: string; error?: string; pending?: string[] };

export type ConfirmMappingResult =
  | { ok: true; artifact: ArtifactState }
  | { ok: false; code: string; error: string };

// --------------------------------------------------------------------
// 读库
// --------------------------------------------------------------------

interface SourceAssetRow {
  episode_id: string;
  kind: string;
  source_name: string;
  aliases: unknown;
  appearance: string | null;
  wardrobe: string | null;
  description: string | null;
  uncertainty: unknown;
}

/** 与 assertStageApprovedFn 同口径：查询失败、无产物、存在未确认产物均不放行。 */
async function checkAnalysisStageGate(
  supabase: any,
  projectId: string,
): Promise<{ ok: true } | { ok: false; pending: string[] }> {
  const { data: rows, error } = await supabase
    .from("restyle_artifacts")
    .select("node_key, status")
    .eq("project_id", projectId)
    .eq("stage", "analysis");
  if (error) return { ok: false, pending: [] };
  const list = (rows ?? []) as Array<{ node_key: string; status: string }>;
  const pending = list.filter((r) => r.status !== "user_approved").map((r) => r.node_key);
  if (list.length === 0 || pending.length > 0) return { ok: false, pending };
  return { ok: true };
}

function toSourceAssetInputs(rows: SourceAssetRow[], episodeNoById: Map<string, number | null>): SourceAssetInput[] {
  return rows
    .filter(
      (row): row is SourceAssetRow & { kind: "character" | "scene" | "prop" } =>
        row.kind === "character" || row.kind === "scene" || row.kind === "prop",
    )
    .map((row) => ({
      episodeId: row.episode_id,
      episodeNo: episodeNoById.get(row.episode_id) ?? null,
      kind: row.kind,
      sourceName: row.source_name,
      aliases: Array.isArray(row.aliases) ? (row.aliases as string[]) : [],
      appearance: row.appearance,
      wardrobe: row.wardrobe,
      description: row.description,
      uncertainty: Array.isArray(row.uncertainty) ? (row.uncertainty as string[]) : [],
    }));
}

// --------------------------------------------------------------------
// prompt
// --------------------------------------------------------------------

const MAPPING_USER_INSTRUCTION = `请基于 [CONTEXT] 中的原片资产（restyle_source_assets，可能跨多集）执行原片→目标资产映射：
1. 按 character-bible 契约产出目标角色人设：name / identity_lock / description / clothing / source_description / asset_origin；跨集同一人物必须归并为同一目标角色（sourceAssetAliases 列出合并来源）。
2. 产出成对闭合关系表 relations（A→B 必有 B→A，禁自指/悬空）。
3. 场景 scenes、道具 props 同样给 asset_origin 映射；无剧情作用的原片资产列入 ignored_assets（附 reason）。
4. 目标命名遵循 style_brief 的目标市场/语言要求；未要求改名时保留原片名。
只输出一个 JSON 对象，字段：characters / relations / scenes / props / ignored_assets。`;

function buildMappingMessages(context: Record<string, unknown>): ChatMessage[] {
  const system = composePrompt(["character-bible"], JSON.stringify(context, null, 2));
  return [
    { role: "system", content: system },
    { role: "user", content: MAPPING_USER_INSTRUCTION },
  ];
}

// --------------------------------------------------------------------
// 写表
// --------------------------------------------------------------------

interface CharacterRowLike {
  id: string;
  name: string;
}

/** 按 project_id+name upsert 目标角色；返回 目标名 → 角色行 id。 */
async function upsertCharacters(
  supabase: any,
  userId: string,
  projectId: string,
  mapping: AssetMappingResult,
  now: string,
): Promise<{ idByName?: Map<string, string>; error?: string }> {
  const { data: existingRows, error: selectError } = await supabase
    .from("restyle_characters")
    .select("id, name")
    .eq("project_id", projectId);
  if (selectError) return { error: selectError.message };

  const idByName = new Map<string, string>(
    ((existingRows ?? []) as CharacterRowLike[]).map((row) => [row.name, row.id]),
  );

  for (const draft of mapping.characters) {
    const payload = {
      user_id: userId,
      project_id: projectId,
      name: draft.name,
      identity_lock: draft.identityLock,
      description: draft.description,
      clothing: draft.clothing,
      source_description: draft.sourceDescription,
      asset_origin: draft.assetOrigin,
      updated_at: now,
    };
    const existingId = idByName.get(draft.name);
    if (existingId) {
      const { error } = await supabase
        .from("restyle_characters")
        .update(payload)
        .eq("id", existingId);
      if (error) return { error: error.message };
    } else {
      const id = `chr_${crypto.randomUUID()}`;
      const { error } = await supabase.from("restyle_characters").insert({
        id,
        ...payload,
        status: "draft",
        created_at: now,
      });
      if (error) return { error: error.message };
      idByName.set(draft.name, id);
    }
  }
  return { idByName };
}

/** 关系表整表替换：先删该项目角色的全部旧边，再插新边。 */
async function replaceRelations(
  supabase: any,
  userId: string,
  mapping: AssetMappingResult,
  idByName: Map<string, string>,
  now: string,
): Promise<{ error?: string }> {
  const characterIds = [...idByName.values()];
  if (characterIds.length > 0) {
    const { error } = await supabase
      .from("restyle_character_relations")
      .delete()
      .in("character_id", characterIds);
    if (error) return { error: error.message };
  }
  const rows = mapping.relations
    .map((relation) => ({
      id: `rel_${crypto.randomUUID()}`,
      user_id: userId,
      character_id: idByName.get(relation.character),
      related_character_id: idByName.get(relation.related),
      relation: relation.relation,
      created_at: now,
    }))
    .filter((row) => row.character_id && row.related_character_id);
  if (rows.length === 0) return {};
  const { error } = await supabase.from("restyle_character_relations").insert(rows);
  if (error) return { error: error.message };
  return {};
}

/** 场景/道具按 project_id+name upsert（两表字段同构）。 */
async function upsertNamedAssets(
  supabase: any,
  userId: string,
  projectId: string,
  table: "restyle_scenes" | "restyle_props",
  drafts: AssetMappingResult["scenes"],
  now: string,
): Promise<{ error?: string }> {
  const idPrefix = table === "restyle_scenes" ? "scn" : "prp";
  const { data: existingRows, error: selectError } = await supabase
    .from(table)
    .select("id, name")
    .eq("project_id", projectId);
  if (selectError) return { error: selectError.message };
  const idByName = new Map<string, string>(
    ((existingRows ?? []) as CharacterRowLike[]).map((row) => [row.name, row.id]),
  );
  for (const draft of drafts) {
    const payload = {
      user_id: userId,
      project_id: projectId,
      name: draft.name,
      description: draft.description,
      source_description: draft.sourceDescription,
      asset_origin: draft.assetOrigin,
    };
    const existingId = idByName.get(draft.name);
    if (existingId) {
      const { error } = await supabase.from(table).update(payload).eq("id", existingId);
      if (error) return { error: error.message };
    } else {
      const { error } = await supabase.from(table).insert({
        id: `${idPrefix}_${crypto.randomUUID()}`,
        ...payload,
        status: "draft",
        created_at: now,
      });
      if (error) return { error: error.message };
    }
  }
  return {};
}

/** 忽略清单整表替换。 */
async function replaceIgnoredAssets(
  supabase: any,
  userId: string,
  projectId: string,
  mapping: AssetMappingResult,
  now: string,
): Promise<{ error?: string }> {
  const { error: deleteError } = await supabase
    .from("restyle_ignored_assets")
    .delete()
    .eq("project_id", projectId);
  if (deleteError) return { error: deleteError.message };
  if (mapping.ignoredAssets.length === 0) return {};
  const rows = mapping.ignoredAssets.map((item) => ({
    id: `ign_${crypto.randomUUID()}`,
    user_id: userId,
    project_id: projectId,
    kind: item.kind,
    name: item.name,
    reason: item.reason || null,
    created_at: now,
  }));
  const { error } = await supabase.from("restyle_ignored_assets").insert(rows);
  if (error) return { error: error.message };
  return {};
}

// --------------------------------------------------------------------
// 产物 upsert（复用 artifactState 状态机，与 upsertArtifactFn 同规则）
// --------------------------------------------------------------------

interface ArtifactRowLike {
  id: string;
  status: ArtifactState["status"];
  content: JsonValue;
  user_content: JsonValue;
  scope_hash: string | null;
  revision: number;
  verdict: string | null;
  issues: JsonValue[] | null;
}

async function upsertMappingArtifact(
  supabase: any,
  userId: string,
  projectId: string,
  content: JsonValue,
  scopeHash: string,
): Promise<{ state?: ArtifactState; error?: string }> {
  const { data: row, error } = await supabase
    .from("restyle_artifacts")
    .select("*")
    .eq("project_id", projectId)
    .eq("stage", ASSET_MAPPING_STAGE)
    .eq("node_key", ASSET_MAPPING_NODE_KEY)
    .maybeSingle();
  if (error) return { error: error.message };

  const now = new Date().toISOString();
  const state: ArtifactState = row
    ? transitionArtifact(
        {
          status: (row as ArtifactRowLike).status,
          content: (row as ArtifactRowLike).content,
          userContent: (row as ArtifactRowLike).user_content ?? null,
          scopeHash: (row as ArtifactRowLike).scope_hash ?? "",
          revision: (row as ArtifactRowLike).revision,
          verdict: (row as ArtifactRowLike).verdict,
          issues: (row as ArtifactRowLike).issues ?? [],
        },
        { type: "ai_write", content, scopeHash },
      )
    : createInitialArtifact(content, scopeHash);

  if (!row) {
    const { error: insertError } = await supabase.from("restyle_artifacts").insert({
      id: `art_${crypto.randomUUID()}`,
      user_id: userId,
      project_id: projectId,
      stage: ASSET_MAPPING_STAGE,
      node_key: ASSET_MAPPING_NODE_KEY,
      content: state.content,
      user_content: state.userContent,
      status: state.status,
      verdict: state.verdict,
      issues: state.issues,
      scope_hash: state.scopeHash,
      revision: state.revision,
      created_at: now,
      updated_at: now,
    });
    if (insertError) return { error: insertError.message };
    return { state };
  }

  // user_content 不在更新负载里：AI 重生成永不触碰人工改写。
  const { error: updateError } = await supabase
    .from("restyle_artifacts")
    .update({
      content: state.content,
      status: state.status,
      verdict: state.verdict,
      issues: state.issues,
      scope_hash: state.scopeHash,
      revision: state.revision,
      updated_at: now,
    })
    .eq("id", (row as ArtifactRowLike).id);
  if (updateError) return { error: updateError.message };
  return { state };
}

// --------------------------------------------------------------------
// 核心流程
// --------------------------------------------------------------------

export async function generateAssetMappingCore(
  input: z.infer<typeof GenerateMappingInputSchema>,
  deps: AssetMappingDeps,
): Promise<GenerateMappingResult> {
  const { supabase, userId } = deps;
  const callChat = deps.callChat ?? callLovableChat;
  const ensureCredits = deps.ensureCredits ?? ensureEnoughCredits;

  // ---- 1. 积分预校验 ----
  const guard = await ensureCredits(MAPPING_CREDIT_COST, {
    kind: "image",
    model: INTERNAL_DIRECTOR_MODEL,
  });
  if (!guard.ok) return { ok: false, code: "INSUFFICIENT_CREDITS", error: guard.error };

  // ---- 2. 阶段闸门：analysis 全部 user_approved 才放行 ----
  const gate = await checkAnalysisStageGate(supabase, input.projectId);
  if (!gate.ok) {
    return { ok: false, code: "STAGE_NOT_APPROVED", pending: gate.pending };
  }

  // ---- 3. 读项目画风 + 集 + 源资产 ----
  const { data: projectRow, error: projectError } = await supabase
    .from("restyle_projects")
    .select("id, style_brief")
    .eq("id", input.projectId)
    .maybeSingle();
  if (projectError) return { ok: false, code: "DB_ERROR", error: projectError.message };
  if (!projectRow) return { ok: false, code: "PROJECT_NOT_FOUND", error: "项目不存在。" };

  let episodeQuery = supabase
    .from("restyle_episodes")
    .select("id, episode_no")
    .eq("project_id", input.projectId)
    .order("episode_no", { ascending: true });
  if (input.episodeIds?.length) episodeQuery = episodeQuery.in("id", input.episodeIds);
  const { data: episodeRows, error: episodeError } = await episodeQuery;
  if (episodeError) return { ok: false, code: "DB_ERROR", error: episodeError.message };
  const episodes = (episodeRows ?? []) as Array<{ id: string; episode_no: number | null }>;
  if (episodes.length === 0) {
    return { ok: false, code: "NO_EPISODES", error: "项目下没有可映射的集。" };
  }
  const episodeIds = episodes.map((episode) => episode.id);
  const episodeNoById = new Map(episodes.map((episode) => [episode.id, episode.episode_no]));

  const { data: assetRows, error: assetError } = await supabase
    .from("restyle_source_assets")
    .select(
      "episode_id, kind, source_name, aliases, appearance, wardrobe, description, uncertainty",
    )
    .in("episode_id", episodeIds);
  if (assetError) return { ok: false, code: "DB_ERROR", error: assetError.message };
  const sourceAssets = toSourceAssetInputs((assetRows ?? []) as SourceAssetRow[], episodeNoById);
  if (sourceAssets.length === 0) {
    return { ok: false, code: "NO_SOURCE_ASSETS", error: "所选集没有原片资产，请先完成分析。" };
  }

  // ---- 4. scope 指纹（上游源资产/集范围/画风变化即失效）----
  const scopeHash = computeAssetScopeHash({
    projectId: input.projectId,
    episodeIds,
    styleBrief: (projectRow as { style_brief: string | null }).style_brief ?? null,
    sourceAssets: sourceAssets.map((asset) => ({
      kind: asset.kind,
      sourceName: asset.sourceName,
      aliases: asset.aliases,
      appearance: asset.appearance,
      wardrobe: asset.wardrobe,
      description: asset.description,
    })),
  });

  // ---- 5. 调导演模型（主模型失败回退一次）----
  const context = {
    scope: { projectId: input.projectId, episodeIds },
    styleBrief: (projectRow as { style_brief: string | null }).style_brief ?? null,
    episodes: episodes.map((episode) => ({
      episodeId: episode.id,
      episodeNo: episode.episode_no,
      sourceAssets: sourceAssets.filter((asset) => asset.episodeId === episode.id),
    })),
  };
  const messages = buildMappingMessages(context);

  let aiResult = await callChat({
    model: INTERNAL_DIRECTOR_MODEL,
    messages,
    maxTokens: 16_000,
    timeoutMs: 300_000,
    jsonMode: true,
  });
  let usedFallback = false;
  if (!aiResult.ok) {
    usedFallback = true;
    aiResult = await callChat({
      model: INTERNAL_DIRECTOR_FALLBACK_MODEL,
      messages,
      maxTokens: 16_000,
      timeoutMs: 300_000,
      jsonMode: true,
    });
  }
  if (!aiResult.ok) {
    logGenerationError({
      kind: "image",
      provider: "lovable",
      model: INTERNAL_DIRECTOR_MODEL,
      errorMessage: `资产映射调用失败（含回退）: ${aiResult.error}`,
      requestPayload: { projectId: input.projectId, stage: ASSET_MAPPING_STAGE },
      userId,
    });
    return { ok: false, code: "AI_CALL_FAILED", error: aiResult.error };
  }

  let parsed: unknown;
  try {
    parsed = extractJson(aiResult.text);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logGenerationError({
      kind: "image",
      provider: "lovable",
      model: aiResult.model,
      errorMessage: `资产映射输出解析失败: ${msg}`,
      requestPayload: { projectId: input.projectId, stage: `${ASSET_MAPPING_STAGE}_parse` },
      responseBody: aiResult.text.slice(0, 2_000),
      userId,
    });
    return { ok: false, code: "AI_OUTPUT_INVALID", error: msg };
  }

  // ---- 6. 合并 + 关系表闭合校验 ----
  const suggestions = normalizeLlmSuggestions(parsed);
  const mapping = mapSourceToTarget(sourceAssets, suggestions);
  const validationIssues = validateCharacterBible(
    mapping.characters.map((character) => ({ name: character.name })),
    mapping.relations,
  );

  // ---- 7. 写目标资产表 ----
  const now = new Date().toISOString();
  const charactersResult = await upsertCharacters(supabase, userId, input.projectId, mapping, now);
  if (charactersResult.error) {
    return { ok: false, code: "DB_ERROR", error: charactersResult.error };
  }
  const idByName = charactersResult.idByName!;
  const relationsResult = await replaceRelations(supabase, userId, mapping, idByName, now);
  if (relationsResult.error) return { ok: false, code: "DB_ERROR", error: relationsResult.error };
  const scenesResult = await upsertNamedAssets(
    supabase, userId, input.projectId, "restyle_scenes", mapping.scenes, now,
  );
  if (scenesResult.error) return { ok: false, code: "DB_ERROR", error: scenesResult.error };
  const propsResult = await upsertNamedAssets(
    supabase, userId, input.projectId, "restyle_props", mapping.props, now,
  );
  if (propsResult.error) return { ok: false, code: "DB_ERROR", error: propsResult.error };
  const ignoredResult = await replaceIgnoredAssets(supabase, userId, input.projectId, mapping, now);
  if (ignoredResult.error) return { ok: false, code: "DB_ERROR", error: ignoredResult.error };

  // ---- 8. 产物 upsert（stage="asset_mapping"）----
  const artifactContent: JsonValue = {
    version: 1,
    generatedAt: now,
    model: aiResult.model,
    usedFallback,
    scope: { episodeIds },
    characters: mapping.characters as unknown as JsonValue,
    relations: mapping.relations as unknown as JsonValue,
    scenes: mapping.scenes as unknown as JsonValue,
    props: mapping.props as unknown as JsonValue,
    ignoredAssets: mapping.ignoredAssets as unknown as JsonValue,
    unmappedSourceNames: mapping.unmappedSourceNames as unknown as JsonValue,
    validationIssues: validationIssues as unknown as JsonValue,
  };
  const upserted = await upsertMappingArtifact(
    supabase, userId, input.projectId, artifactContent, scopeHash,
  );
  if (upserted.error) return { ok: false, code: "DB_ERROR", error: upserted.error };

  // ---- 9. 成功扣费（1 分/次）；幂等键防重复扣费，扣失败不阻断主流程 ----
  const charge =
    deps.chargeCredits ??
    (async (params: { amount: number; model?: string; description: string; idempotencyKey?: string }) => {
      const { chargeCredits } = await import("../userCredits.functions");
      return chargeCredits(supabase, userId, params);
    });
  await charge({
    amount: MAPPING_CREDIT_COST,
    model: aiResult.model,
    description: "转绘资产映射",
    idempotencyKey: `asset-mapping:${input.projectId}:${scopeHash}`,
  });

  return {
    ok: true,
    projectId: input.projectId,
    scopeHash,
    counts: {
      characters: mapping.characters.length,
      relations: mapping.relations.length,
      scenes: mapping.scenes.length,
      props: mapping.props.length,
      ignored: mapping.ignoredAssets.length,
    },
    validationIssues,
    unmappedSourceNames: mapping.unmappedSourceNames,
    model: aiResult.model,
    usedFallback,
  };
}

// --------------------------------------------------------------------
// 确认 / 读回
// --------------------------------------------------------------------

/** 用户改写的字段（name 为键，不可改）；确认时同步回目标资产表。 */
interface CharacterEdit {
  name: string;
  identityLock?: string;
  description?: string;
  clothing?: string;
  sourceDescription?: string;
}

function asEditArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is Record<string, unknown> =>
      !!item && typeof item === "object" && !Array.isArray(item),
  );
}

function editString(row: Record<string, unknown>, camel: string, snake: string): string | undefined {
  const value = row[camel] ?? row[snake];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** 把 userContent 中的行内编辑回写目标资产表（按 project_id+name 匹配）。 */
async function applyUserContentEdits(
  supabase: any,
  projectId: string,
  userContent: unknown,
  now: string,
): Promise<{ error?: string }> {
  const root =
    userContent && typeof userContent === "object" && !Array.isArray(userContent)
      ? (userContent as Record<string, unknown>)
      : {};
  const characterEdits = asEditArray(root.characters)
    .map((row) => {
      const name = typeof row.name === "string" ? row.name.trim() : "";
      if (!name) return null;
      const edit: CharacterEdit = {
        name,
        identityLock: editString(row, "identityLock", "identity_lock"),
        description: editString(row, "description", "description"),
        clothing: editString(row, "clothing", "clothing"),
        sourceDescription: editString(row, "sourceDescription", "source_description"),
      };
      return edit;
    })
    .filter((edit): edit is CharacterEdit => edit !== null);

  for (const edit of characterEdits) {
    const payload: Record<string, unknown> = { updated_at: now };
    if (edit.identityLock !== undefined) payload.identity_lock = edit.identityLock;
    if (edit.description !== undefined) payload.description = edit.description;
    if (edit.clothing !== undefined) payload.clothing = edit.clothing;
    if (edit.sourceDescription !== undefined) payload.source_description = edit.sourceDescription;
    const { error } = await supabase
      .from("restyle_characters")
      .update(payload)
      .eq("project_id", projectId)
      .eq("name", edit.name);
    if (error) return { error: error.message };
  }
  return {};
}

/**
 * 人工确认资产映射：产物状态机推进到 user_approved（可带 userContent），
 * 用户改写的角色字段同步回写 restyle_characters。
 */
export async function confirmAssetMappingCore(
  input: z.infer<typeof ConfirmMappingInputSchema>,
  deps: AssetMappingDeps,
): Promise<ConfirmMappingResult> {
  const { supabase, userId } = deps;
  const { data: row, error } = await supabase
    .from("restyle_artifacts")
    .select("*")
    .eq("project_id", input.projectId)
    .eq("stage", ASSET_MAPPING_STAGE)
    .eq("node_key", ASSET_MAPPING_NODE_KEY)
    .maybeSingle();
  if (error) return { ok: false, code: "DB_ERROR", error: error.message };
  if (!row) {
    return { ok: false, code: "ARTIFACT_NOT_FOUND", error: "资产映射产物不存在，请先生成映射。" };
  }

  const state = transitionArtifact(
    {
      status: (row as ArtifactRowLike).status,
      content: (row as ArtifactRowLike).content,
      userContent: (row as ArtifactRowLike).user_content ?? null,
      scopeHash: (row as ArtifactRowLike).scope_hash ?? "",
      revision: (row as ArtifactRowLike).revision,
      verdict: (row as ArtifactRowLike).verdict,
      issues: (row as ArtifactRowLike).issues ?? [],
    },
    { type: "approve", userContent: input.userContent as JsonValue | undefined },
  );
  const now = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("restyle_artifacts")
    .update({
      status: state.status,
      user_content: state.userContent,
      revision: state.revision,
      approved_by: userId,
      approved_at: now,
      updated_at: now,
    })
    .eq("id", (row as ArtifactRowLike).id);
  if (updateError) return { ok: false, code: "DB_ERROR", error: updateError.message };

  if (input.userContent !== undefined) {
    const edits = await applyUserContentEdits(supabase, input.projectId, input.userContent, now);
    if (edits.error) return { ok: false, code: "DB_ERROR", error: edits.error };
  }
  return { ok: true, artifact: state };
}

// --------------------------------------------------------------------
// 读回类型（显式字段：createServerFn 返回值受 ValidateSerializable 约束，
// Record<string, unknown> 会让响应类型塌缩成 unknown）
// --------------------------------------------------------------------

export interface MappingCharacterRow {
  id: string;
  name: string;
  identity_lock: string | null;
  description: string | null;
  clothing: string | null;
  source_description: string | null;
  asset_origin: JsonValue;
  status: string;
}

export interface MappingNamedAssetRow {
  id: string;
  name: string;
  description: string | null;
  source_description: string | null;
  asset_origin: JsonValue;
  status: string;
}

export interface MappingRelationRow {
  id: string;
  character_id: string;
  related_character_id: string;
  relation: string;
  /** 由 character_id 反查的目标角色名（面板展示用）。 */
  character: string | null;
  related: string | null;
}

export interface MappingIgnoredRow {
  id: string;
  kind: string;
  name: string;
  reason: string | null;
}

export interface MappingArtifactInfo {
  status: string;
  verdict: string | null;
  issues: JsonValue[] | null;
  content: JsonValue;
  user_content: JsonValue;
  revision: number;
  scope_hash: string | null;
}

export interface AssetMappingData {
  characters: MappingCharacterRow[];
  relations: MappingRelationRow[];
  scenes: MappingNamedAssetRow[];
  props: MappingNamedAssetRow[];
  ignoredAssets: MappingIgnoredRow[];
  artifact: MappingArtifactInfo | null;
}

export type ListMappingResult =
  | { ok: true; error: null; data: AssetMappingData }
  | { ok: false; error: string };

/** 读回目标资产四表 + 关系表 + 映射产物状态（面板数据源）。 */
export async function listAssetMappingCore(
  input: z.infer<typeof ListMappingInputSchema>,
  deps: AssetMappingDeps,
): Promise<ListMappingResult> {
  const { supabase } = deps;
  const [charactersRes, scenesRes, propsRes, ignoredRes, artifactRes] = await Promise.all([
    supabase
      .from("restyle_characters")
      .select("id, name, identity_lock, description, clothing, source_description, asset_origin, status")
      .eq("project_id", input.projectId)
      .order("created_at", { ascending: true }),
    supabase
      .from("restyle_scenes")
      .select("id, name, description, source_description, asset_origin, status")
      .eq("project_id", input.projectId)
      .order("created_at", { ascending: true }),
    supabase
      .from("restyle_props")
      .select("id, name, description, source_description, asset_origin, status")
      .eq("project_id", input.projectId)
      .order("created_at", { ascending: true }),
    supabase
      .from("restyle_ignored_assets")
      .select("id, kind, name, reason")
      .eq("project_id", input.projectId)
      .order("created_at", { ascending: true }),
    supabase
      .from("restyle_artifacts")
      .select("status, verdict, issues, content, user_content, revision, scope_hash")
      .eq("project_id", input.projectId)
      .eq("stage", ASSET_MAPPING_STAGE)
      .eq("node_key", ASSET_MAPPING_NODE_KEY)
      .maybeSingle(),
  ]);
  const firstError =
    charactersRes.error ?? scenesRes.error ?? propsRes.error ?? ignoredRes.error ?? artifactRes.error;
  if (firstError) return { ok: false, error: firstError.message };

  const characters = (charactersRes.data ?? []) as MappingCharacterRow[];
  const characterIds = characters.map((row) => row.id);
  let relations: MappingRelationRow[] = [];
  if (characterIds.length > 0) {
    const { data: relationRows, error: relationError } = await supabase
      .from("restyle_character_relations")
      .select("id, character_id, related_character_id, relation")
      .in("character_id", characterIds);
    if (relationError) return { ok: false, error: relationError.message };
    const nameById = new Map(characters.map((row) => [row.id, row.name]));
    relations = (
      (relationRows ?? []) as Array<Omit<MappingRelationRow, "character" | "related">>
    ).map((row) => ({
      ...row,
      character: nameById.get(row.character_id) ?? null,
      related: nameById.get(row.related_character_id) ?? null,
    }));
  }

  // 读时重签：库里存的是 7 天签名 URL，过期后会裂图。
  const [resignedCharacters, resignedScenes, resignedProps] = await Promise.all([
    resignMediaDeep(supabase, characters),
    resignMediaDeep(supabase, (scenesRes.data ?? []) as MappingNamedAssetRow[]),
    resignMediaDeep(supabase, (propsRes.data ?? []) as MappingNamedAssetRow[]),
  ]);

  return {
    ok: true,
    error: null,
    data: {
      characters: resignedCharacters,
      relations,
      scenes: resignedScenes,
      props: resignedProps,
      ignoredAssets: (ignoredRes.data ?? []) as MappingIgnoredRow[],
      artifact: (artifactRes.data as MappingArtifactInfo | null) ?? null,
    },
  };
}
