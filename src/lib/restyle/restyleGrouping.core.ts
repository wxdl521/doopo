// ====================================================================
//  转绘 v2 阶段 B（第三步）· 按集分组（核心）
//
//  三个编排入口：
//    1. generateGroupingCore  闸门（image_gen 阶段产物全 user_approved）
//       → 读分镜（角色/场景/道具/台词）→ 导演模型（shot-to-segment skill）
//       产出带 reason 的分组建议 → validateGroups 校验，不通过则
//       packShotsIntoGroups 兜底修正 → 整表按集替换写 restyle_groups →
//       写分组确认记录（artifacts stage="grouping"，node_key=episodeId，
//       含 scope_hash/groupCount/totalDurationSeconds）→ 连贯性核对
//       （ai-output-review skill：服装/伤势/关系变化衔接、时间线不倒置，
//       verdict/issues 进产物）→ 成功扣 1 分（幂等键
//       grouping:{projectId}:{episodeId}:{scopeHash}）。
//    2. updateGroupingCore    面板手动调整 shot 归属/顺序后保存：
//       scope 指纹失效直接 SCOPE_STALE（需重新生成/确认）；
//       validateGroups 通过后整表替换，产物 user_content 记录人工版本
//       并回落 draft 待重新确认。
//    3. listGroupingCore      面板数据源：分镜 + 分组行 + 产物状态 +
//       scope 指纹失效率高亮（需重新确认）。
//
//  纯函数全部在 grouping.ts；副作用走 deps 注入（测试可替换）。
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
import { extractJson } from "./restyleVideoAnalysis.functions";
import {
  createInitialArtifact,
  transitionArtifact,
  type ArtifactState,
  type JsonValue,
} from "./artifactState";
import {
  computeGroupStats,
  groupingScopeHash,
  normalizeGroupingPlan,
  packShotsIntoGroups,
  summarizeGroupCharacters,
  validateGroups,
  type GroupPlan,
  type GroupValidationError,
  type GroupingScopeLook,
  type GroupingShot,
} from "./grouping";

type SupabaseContext = { supabase: any; userId: string };

// --------------------------------------------------------------------
// 常量与 zod 输入
// --------------------------------------------------------------------

export const GROUPING_STAGE = "grouping";
/** 上游闸门阶段：造型化生图（looks + prompts 均须 user_approved）。 */
export const GROUPING_GATE_STAGE = "image_gen";
export const GROUPING_CREDIT_COST = 1;
/** 确认记录 writer 标识（对齐竞品 分组确认记录.json 的 writer 字段）。 */
export const GROUPING_WRITER = "doopoo/restyleGrouping.functions";

export const GenerateGroupingInputSchema = z.object({
  projectId: z.string().min(1).max(128),
  episodeId: z.string().min(1).max(128),
});

export const UpdateGroupingInputSchema = z.object({
  projectId: z.string().min(1).max(128),
  episodeId: z.string().min(1).max(128),
  groups: z
    .array(
      z.object({
        shotIds: z.array(z.string().min(1).max(128)).min(1).max(500),
        reason: z.string().max(4_000),
      }),
    )
    .min(1)
    .max(200),
});

export const ListGroupingInputSchema = z.object({
  projectId: z.string().min(1).max(128),
  episodeId: z.string().min(1).max(128).optional(),
});

// --------------------------------------------------------------------
// 依赖注入（测试可替换 callChat / 积分）
// --------------------------------------------------------------------

export interface GroupingDeps {
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

// --------------------------------------------------------------------
// 结果类型
// --------------------------------------------------------------------

export type GroupingGateFailure = {
  ok: false;
  code: "STAGE_NOT_APPROVED";
  pending: string[];
};

export interface GroupingIssue {
  severity: "blocker" | "major" | "minor";
  type: string;
  description: string;
}

export type GenerateGroupingResult =
  | {
      ok: true;
      projectId: string;
      episodeId: string;
      scopeHash: string;
      groupCount: number;
      totalDurationSeconds: number;
      /** true = AI 方案未通过校验，已用确定性兜底重排。 */
      usedPackerFallback: boolean;
      issues: GroupingIssue[];
      verdict: string | null;
      model: string;
      usedFallback: boolean;
    }
  | GroupingGateFailure
  | { ok: false; code: string; error?: string; errors?: GroupValidationError[] };

export type UpdateGroupingResult =
  | {
      ok: true;
      projectId: string;
      episodeId: string;
      scopeHash: string;
      groupCount: number;
      totalDurationSeconds: number;
    }
  | { ok: false; code: string; error?: string; errors?: GroupValidationError[] };

export interface GroupingShotInfo {
  id: string;
  shot_no: string;
  start_ms: number;
  end_ms: number;
  scene_type: string | null;
  characters: string[];
  dialogue: string | null;
}

export interface GroupingGroupRow {
  id: string;
  group_no: number;
  shot_ids: string[];
  reason: string | null;
  total_seconds: number;
  status: string;
  scope_hash: string | null;
}

export interface GroupingArtifactInfo {
  status: string;
  verdict: string | null;
  issues: JsonValue[] | null;
  content: JsonValue;
  user_content: JsonValue;
  revision: number;
  scope_hash: string | null;
}

export interface EpisodeGroupingData {
  episodeId: string;
  episodeNo: number | null;
  shots: GroupingShotInfo[];
  groups: GroupingGroupRow[];
  artifact: GroupingArtifactInfo | null;
  /** 当前上游指纹；与产物 scope_hash 不一致即 stale（需重新确认）。 */
  currentScopeHash: string;
  stale: boolean;
}

export interface GroupingLookInfo {
  characterId: string;
  characterName: string;
  name: string;
  fromShot: string | null;
  toShot: string | null;
}

export type ListGroupingResult =
  | {
      ok: true;
      error: null;
      data: { episodes: EpisodeGroupingData[]; looks: GroupingLookInfo[] };
    }
  | { ok: false; error: string };

// --------------------------------------------------------------------
// 读库 / 闸门 / 产物 helpers（同 restyleImageGen.core 口径）
// --------------------------------------------------------------------

interface ShotRow {
  id: string;
  shot_no: string;
  start_ms: number;
  end_ms: number;
  scene_type: string | null;
  characters: unknown;
  props: unknown;
  dialogue: string | null;
  emotion: string | null;
  end_state_action: string | null;
}

interface LookRow {
  id: string;
  character_id: string;
  name: string;
  from_shot: string | null;
  to_shot: string | null;
}

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

function toGroupingShot(row: ShotRow): GroupingShot {
  return {
    id: row.id,
    shotNo: row.shot_no,
    startMs: row.start_ms,
    endMs: row.end_ms,
    sceneType: row.scene_type,
    characters: Array.isArray(row.characters)
      ? (row.characters as unknown[]).filter((n): n is string => typeof n === "string")
      : [],
    dialogue: row.dialogue,
    endStateAction: row.end_state_action,
  };
}

function shotNameList(value: unknown): string[] {
  return Array.isArray(value)
    ? (value as unknown[]).filter((n): n is string => typeof n === "string")
    : [];
}

/** 与 assertStageApprovedFn 同口径的阶段闸门。 */
async function checkStageGate(
  supabase: any,
  projectId: string,
  stage: string,
): Promise<{ ok: true } | { ok: false; pending: string[] }> {
  const { data: rows, error } = await supabase
    .from("restyle_artifacts")
    .select("node_key, status")
    .eq("project_id", projectId)
    .eq("stage", stage);
  if (error) return { ok: false, pending: [] };
  const list = (rows ?? []) as Array<{ node_key: string; status: string }>;
  const pending = list.filter((r) => r.status !== "user_approved").map((r) => r.node_key);
  if (list.length === 0 || pending.length > 0) return { ok: false, pending };
  return { ok: true };
}

async function fetchArtifactRow(
  supabase: any,
  projectId: string,
  stage: string,
  nodeKey: string,
): Promise<{ row?: ArtifactRowLike; error?: string }> {
  const { data, error } = await supabase
    .from("restyle_artifacts")
    .select("*")
    .eq("project_id", projectId)
    .eq("stage", stage)
    .eq("node_key", nodeKey)
    .maybeSingle();
  if (error) return { error: error.message };
  return { row: (data as ArtifactRowLike | null) ?? undefined };
}

function stateFromRow(row: ArtifactRowLike): ArtifactState {
  return {
    status: row.status,
    content: row.content,
    userContent: row.user_content ?? null,
    scopeHash: row.scope_hash ?? "",
    revision: row.revision,
    verdict: row.verdict,
    issues: row.issues ?? [],
  };
}

async function persistArtifactState(
  supabase: any,
  userId: string,
  projectId: string,
  stage: string,
  nodeKey: string,
  state: ArtifactState,
  existingId: string | null,
): Promise<string | null> {
  const now = new Date().toISOString();
  if (!existingId) {
    const { error } = await supabase.from("restyle_artifacts").insert({
      id: `art_${crypto.randomUUID()}`,
      user_id: userId,
      project_id: projectId,
      stage,
      node_key: nodeKey,
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
    return error ? error.message : null;
  }
  const { error } = await supabase
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
    .eq("id", existingId);
  return error ? error.message : null;
}

async function readEpisodeShots(
  supabase: any,
  episodeId: string,
): Promise<{ rows?: ShotRow[]; error?: string }> {
  const { data, error } = await supabase
    .from("restyle_shots")
    .select(
      "id, shot_no, start_ms, end_ms, scene_type, characters, props, dialogue, emotion, end_state_action",
    )
    .eq("episode_id", episodeId)
    .order("start_ms", { ascending: true });
  if (error) return { error: error.message };
  return { rows: (data ?? []) as ShotRow[] };
}

async function readProjectLooks(
  supabase: any,
  projectId: string,
): Promise<{ looks?: LookRow[]; characterNames?: Map<string, string>; error?: string }> {
  const { data: characterRows, error: characterError } = await supabase
    .from("restyle_characters")
    .select("id, name")
    .eq("project_id", projectId);
  if (characterError) return { error: characterError.message };
  const characters = (characterRows ?? []) as Array<{ id: string; name: string }>;
  const characterNames = new Map(characters.map((row) => [row.id, row.name]));
  if (characters.length === 0) return { looks: [], characterNames };
  const { data: lookRows, error: lookError } = await supabase
    .from("restyle_character_looks")
    .select("id, character_id, name, from_shot, to_shot")
    .in(
      "character_id",
      characters.map((row) => row.id),
    );
  if (lookError) return { error: lookError.message };
  return { looks: (lookRows ?? []) as LookRow[], characterNames };
}

function toScopeLooks(looks: LookRow[]): GroupingScopeLook[] {
  return looks.map((look) => ({
    characterId: look.character_id,
    name: look.name,
    fromShot: look.from_shot,
    toShot: look.to_shot,
  }));
}

async function defaultCharge(
  supabase: any,
  userId: string,
  params: { amount: number; model?: string; description: string; idempotencyKey?: string },
) {
  const { chargeCredits } = await import("../userCredits.functions");
  return chargeCredits(supabase, userId, params);
}

/** 整表按集替换 restyle_groups（先删后插，同 B2 looks 整表替换惯例）。 */
async function replaceEpisodeGroups(
  supabase: any,
  userId: string,
  episodeId: string,
  groups: GroupPlan[],
  scopeHash: string,
): Promise<string | null> {
  const { error: deleteError } = await supabase
    .from("restyle_groups")
    .delete()
    .eq("episode_id", episodeId);
  if (deleteError) return deleteError.message;
  if (groups.length === 0) return null;
  const now = new Date().toISOString();
  const rows = groups.map((group, index) => ({
    id: `grp_${crypto.randomUUID()}`,
    user_id: userId,
    episode_id: episodeId,
    group_no: index + 1,
    shot_ids: group.shotIds,
    reason: group.reason || null,
    total_seconds: group.totalSeconds,
    status: "needs_confirmation",
    scope_hash: scopeHash,
    created_at: now,
  }));
  const { error: insertError } = await supabase.from("restyle_groups").insert(rows);
  return insertError ? insertError.message : null;
}

/** 组产物明细：分镜号、参与角色及造型、场景、道具、台词（shot-to-segment 契约）。 */
function buildGroupDetails(
  groups: GroupPlan[],
  shots: GroupingShot[],
  shotRows: ShotRow[],
  looks: LookRow[],
  characterNames: Map<string, string>,
) {
  const rowById = new Map(shotRows.map((row) => [row.id, row]));
  const looksWithNames = looks.map((look) => ({
    ...toScopeLooks([look])[0],
    characterName: characterNames.get(look.character_id) ?? look.character_id,
  }));
  return groups.map((group, index) => {
    const groupRows = group.shotIds
      .map((id) => rowById.get(id))
      .filter((row): row is ShotRow => !!row);
    const sets = [...new Set(groupRows.map((row) => row.scene_type).filter((v): v is string => !!v))];
    const props = [
      ...new Set(
        groupRows.flatMap((row) => shotNameList(row.props)),
      ),
    ];
    const dialogues = groupRows
      .map((row) => (row.dialogue ? `${row.shot_no}：${row.dialogue}` : null))
      .filter((v): v is string => !!v);
    return {
      groupNo: index + 1,
      shotIds: group.shotIds,
      shots: groupRows.map((row) => row.shot_no),
      reason: group.reason,
      totalSeconds: group.totalSeconds,
      characters: summarizeGroupCharacters(group, shots, looksWithNames),
      set: sets,
      props,
      dialogueSummary: dialogues.length > 0 ? dialogues : "无",
      /** 段间接续锚点：末镜的 end_state_action（shot-to-segment 规则 5）。 */
      endStateAction: groupRows[groupRows.length - 1]?.end_state_action ?? null,
    };
  });
}

// --------------------------------------------------------------------
// 1) 生成分组
// --------------------------------------------------------------------

const GROUPING_USER_INSTRUCTION = `请基于 [CONTEXT] 中该集的目标分镜时间轴（含时长/角色/场景/道具/台词/情绪/末镜动作）与换装区间，按 shot-to-segment 契约把这集分镜归并为 4–15 秒的分组：
1. 只在镜头边界切分；全组覆盖整集、无重叠、无遗漏；组按时间线升序。
2. 每组给出 reason（叙事/制作理由，禁止纯时长理由）。
3. 分镜引用使用 [CONTEXT] 中的 shotNo（如 EP01_SC01）。
只输出一个 JSON 对象：{ "groups": [{ "group": ["EP01_SC01", …], "reason": "…" }] }。`;

const REVIEW_USER_INSTRUCTION = `请按 ai-output-review 契约对 [CONTEXT] 中的分组方案做连贯性核对，重点检查：
1. 服装/伤势衔接：相邻组同一角色的造型（look）与换装区间是否一致，不一致且换装区间未覆盖时标 continuity_risk。
2. 关系与情绪变化衔接：组间人物关系、情绪走向是否符合事件链，有无跳变。
3. 时间线不倒置：组内与组间是否严格按分镜时间升序，回忆/闪回段落是否在 reason 标注。
只输出一个 JSON 对象：{ "verdict": "pass | warn | fail", "issues": [...] }。`;

function buildReviewIssues(parsed: unknown): { verdict: string | null; issues: GroupingIssue[] } {
  const root =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  const verdictRaw = typeof root.verdict === "string" ? root.verdict : null;
  const issues: GroupingIssue[] = [];
  const rows = Array.isArray(root.issues) ? root.issues : [];
  for (const item of rows) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const severityRaw = typeof record.severity === "string" ? record.severity : "minor";
    issues.push({
      severity:
        severityRaw === "blocker" || severityRaw === "major" || severityRaw === "minor"
          ? severityRaw
          : "minor",
      type: typeof record.type === "string" ? record.type : "other",
      description:
        typeof record.description === "string" ? record.description : JSON.stringify(record),
    });
  }
  return { verdict: verdictRaw, issues };
}

export async function generateGroupingCore(
  input: z.infer<typeof GenerateGroupingInputSchema>,
  deps: GroupingDeps,
): Promise<GenerateGroupingResult> {
  const { supabase, userId } = deps;
  const callChat = deps.callChat ?? callLovableChat;
  const ensureCredits = deps.ensureCredits ?? ensureEnoughCredits;

  // ---- 1. 积分预校验（导演模型调用，1 分/次）----
  const guard = await ensureCredits(GROUPING_CREDIT_COST, {
    kind: "image",
    model: INTERNAL_DIRECTOR_MODEL,
  });
  if (!guard.ok) return { ok: false, code: "INSUFFICIENT_CREDITS", error: guard.error };

  // ---- 2. 阶段闸门：造型化生图（image_gen）产物须全部 user_approved ----
  const gate = await checkStageGate(supabase, input.projectId, GROUPING_GATE_STAGE);
  if (!gate.ok) return { ok: false, code: "STAGE_NOT_APPROVED", pending: gate.pending };

  // ---- 3. 读集 + 分镜 + 角色/换装区间 ----
  const { data: episodeRow, error: episodeError } = await supabase
    .from("restyle_episodes")
    .select("id, episode_no, project_id")
    .eq("id", input.episodeId)
    .maybeSingle();
  if (episodeError) return { ok: false, code: "DB_ERROR", error: episodeError.message };
  if (!episodeRow || (episodeRow as { project_id: string }).project_id !== input.projectId) {
    return { ok: false, code: "EPISODE_NOT_FOUND", error: "集不存在或不属于该项目。" };
  }
  const episodeNo = (episodeRow as { episode_no: number | null }).episode_no;

  const shotsResult = await readEpisodeShots(supabase, input.episodeId);
  if (shotsResult.error) return { ok: false, code: "DB_ERROR", error: shotsResult.error };
  const shotRows = shotsResult.rows!;
  if (shotRows.length === 0) {
    return { ok: false, code: "NO_SHOTS", error: "该集还没有分镜，请先完成分析与审核。" };
  }
  const shots = shotRows.map(toGroupingShot);

  const looksResult = await readProjectLooks(supabase, input.projectId);
  if (looksResult.error) return { ok: false, code: "DB_ERROR", error: looksResult.error };
  const looks = looksResult.looks!;
  const characterNames = looksResult.characterNames!;
  const scopeLooks = toScopeLooks(looks);

  // ---- 4. scope 指纹（分镜/换装区间变化即失效，需重新确认）----
  const scopeHash = groupingScopeHash(input.episodeId, shots, scopeLooks);

  // ---- 5. 导演模型产出分组建议（shot-to-segment，主模型失败回退一次）----
  const epPrefix = `EP${String(episodeNo ?? 0).padStart(2, "0")}`;
  const context = {
    scope: { projectId: input.projectId, episodeId: input.episodeId, episodeNo },
    shots: shotRows.map((row) => ({
      shotNo: `${epPrefix}_${row.shot_no}`,
      durationSec: Math.max(0, (row.end_ms - row.start_ms) / 1000),
      characters: shotNameList(row.characters),
      sceneType: row.scene_type,
      props: shotNameList(row.props),
      dialogue: row.dialogue,
      emotion: row.emotion,
      endStateAction: row.end_state_action,
    })),
    looks: looks.map((look) => ({
      character: characterNames.get(look.character_id) ?? look.character_id,
      name: look.name,
      fromShot: look.from_shot,
      toShot: look.to_shot,
    })),
  };
  const messages: ChatMessage[] = [
    { role: "system", content: composePrompt(["shot-to-segment"], JSON.stringify(context, null, 2)) },
    { role: "user", content: GROUPING_USER_INSTRUCTION },
  ];

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
      errorMessage: `按集分组调用失败（含回退）: ${aiResult.error}`,
      requestPayload: { projectId: input.projectId, episodeId: input.episodeId, stage: GROUPING_STAGE },
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
      errorMessage: `按集分组输出解析失败: ${msg}`,
      requestPayload: { projectId: input.projectId, stage: `${GROUPING_STAGE}_parse` },
      responseBody: aiResult.text.slice(0, 2_000),
      userId,
    });
    return { ok: false, code: "AI_OUTPUT_INVALID", error: msg };
  }

  // ---- 6. 校验 AI 方案，不通过则确定性兜底修正 ----
  const issues: GroupingIssue[] = [];
  const normalized = normalizeGroupingPlan(parsed, shots);
  const validation = validateGroups(normalized.groups, shots);
  let groups: GroupPlan[];
  let usedPackerFallback = false;
  if (normalized.unknownRefs.length > 0 || !validation.ok || normalized.groups.length === 0) {
    usedPackerFallback = true;
    const packed = packShotsIntoGroups(shots);
    groups = packed.groups;
    issues.push({
      severity: "major",
      type: "ai_plan_fallback",
      description: `AI 分组方案未通过校验（${
        [
          normalized.unknownRefs.length > 0 ? `未知分镜引用 ${normalized.unknownRefs.join("、")}` : "",
          ...validation.errors.map((error) => error.description),
          normalized.groups.length === 0 ? "AI 未输出任何分组" : "",
        ]
          .filter(Boolean)
          .join("；") || "未知原因"
      }），已按镜头边界规则兜底重排。`,
    });
    for (const warning of packed.warnings) {
      issues.push({ severity: "minor", type: "packer_warning", description: warning });
    }
  } else {
    groups = normalized.groups;
  }

  // ---- 7. 整表按集替换 restyle_groups ----
  const replaceError = await replaceEpisodeGroups(supabase, userId, input.episodeId, groups, scopeHash);
  if (replaceError) return { ok: false, code: "DB_ERROR", error: replaceError };

  // ---- 8. 分组确认记录（artifacts stage="grouping"，node_key=episodeId）----
  const stats = computeGroupStats(groups);
  const now = new Date().toISOString();
  const artifactContent: JsonValue = {
    version: 1,
    status: "needs_confirmation",
    writer: GROUPING_WRITER,
    updatedAt: now,
    model: aiResult.model,
    usedFallback,
    usedPackerFallback,
    episodeId: input.episodeId,
    episodeNo,
    groupCount: stats.groupCount,
    totalDurationSeconds: stats.totalDurationSeconds,
    scopeHash,
    groups: buildGroupDetails(groups, shots, shotRows, looks, characterNames) as unknown as JsonValue,
  };

  const existing = await fetchArtifactRow(supabase, input.projectId, GROUPING_STAGE, input.episodeId);
  if (existing.error) return { ok: false, code: "DB_ERROR", error: existing.error };
  let state = existing.row
    ? transitionArtifact(stateFromRow(existing.row), { type: "ai_write", content: artifactContent, scopeHash })
    : createInitialArtifact(artifactContent, scopeHash);

  // ---- 9. 连贯性核对（ai-output-review；失败不阻断，记录 issue）----
  let verdict: string | null = null;
  const reviewContext = {
    scope: context.scope,
    groups: (artifactContent as { groups: unknown }).groups,
    looks: context.looks,
    shots: context.shots,
  };
  const reviewMessages: ChatMessage[] = [
    { role: "system", content: composePrompt(["ai-output-review"], JSON.stringify(reviewContext, null, 2)) },
    { role: "user", content: REVIEW_USER_INSTRUCTION },
  ];
  const reviewResult = await callChat({
    model: INTERNAL_DIRECTOR_MODEL,
    messages: reviewMessages,
    maxTokens: 8_000,
    timeoutMs: 300_000,
    jsonMode: true,
  });
  if (reviewResult.ok) {
    try {
      const review = buildReviewIssues(extractJson(reviewResult.text));
      verdict = review.verdict;
      issues.push(...review.issues);
    } catch {
      issues.push({
        severity: "minor",
        type: "review_unavailable",
        description: "连贯性核对输出解析失败，本次未出具结论（待人工复核）。",
      });
    }
  } else {
    issues.push({
      severity: "minor",
      type: "review_unavailable",
      description: `连贯性核对调用失败：${reviewResult.error}（待人工复核）。`,
    });
  }
  state = transitionArtifact(state, { type: "ai_check", verdict: verdict ?? "warn", issues: issues as unknown as JsonValue[] });

  const persistError = await persistArtifactState(
    supabase, userId, input.projectId, GROUPING_STAGE, input.episodeId, state, existing.row?.id ?? null,
  );
  if (persistError) return { ok: false, code: "DB_ERROR", error: persistError };

  // ---- 10. 成功扣费（1 分/次，幂等键防重复；扣失败不阻断）----
  const charge =
    deps.chargeCredits ??
    ((params: { amount: number; model?: string; description: string; idempotencyKey?: string }) =>
      defaultCharge(supabase, userId, params));
  await charge({
    amount: GROUPING_CREDIT_COST,
    model: aiResult.model,
    description: "转绘按集分组",
    idempotencyKey: `grouping:${input.projectId}:${input.episodeId}:${scopeHash}`,
  });

  return {
    ok: true,
    projectId: input.projectId,
    episodeId: input.episodeId,
    scopeHash,
    groupCount: stats.groupCount,
    totalDurationSeconds: stats.totalDurationSeconds,
    usedPackerFallback,
    issues,
    verdict,
    model: aiResult.model,
    usedFallback,
  };
}

// --------------------------------------------------------------------
// 2) 手动调整保存（面板拖动/点选 shot 归属与顺序）
// --------------------------------------------------------------------

export async function updateGroupingCore(
  input: z.infer<typeof UpdateGroupingInputSchema>,
  deps: GroupingDeps,
): Promise<UpdateGroupingResult> {
  const { supabase, userId } = deps;

  const { data: episodeRow, error: episodeError } = await supabase
    .from("restyle_episodes")
    .select("id, episode_no, project_id")
    .eq("id", input.episodeId)
    .maybeSingle();
  if (episodeError) return { ok: false, code: "DB_ERROR", error: episodeError.message };
  if (!episodeRow || (episodeRow as { project_id: string }).project_id !== input.projectId) {
    return { ok: false, code: "EPISODE_NOT_FOUND", error: "集不存在或不属于该项目。" };
  }
  const episodeNo = (episodeRow as { episode_no: number | null }).episode_no;

  const shotsResult = await readEpisodeShots(supabase, input.episodeId);
  if (shotsResult.error) return { ok: false, code: "DB_ERROR", error: shotsResult.error };
  const shotRows = shotsResult.rows!;
  const shots = shotRows.map(toGroupingShot);

  const looksResult = await readProjectLooks(supabase, input.projectId);
  if (looksResult.error) return { ok: false, code: "DB_ERROR", error: looksResult.error };
  const looks = looksResult.looks!;
  const characterNames = looksResult.characterNames!;

  // ---- scope 指纹失效：上游分镜已变化，必须重新生成/确认 ----
  const scopeHash = groupingScopeHash(input.episodeId, shots, toScopeLooks(looks));
  const existing = await fetchArtifactRow(supabase, input.projectId, GROUPING_STAGE, input.episodeId);
  if (existing.error) return { ok: false, code: "DB_ERROR", error: existing.error };
  if (!existing.row) {
    return { ok: false, code: "ARTIFACT_NOT_FOUND", error: "分组确认记录不存在，请先生成分组方案。" };
  }
  if (existing.row.scope_hash && existing.row.scope_hash !== scopeHash) {
    return {
      ok: false,
      code: "SCOPE_STALE",
      error: "上游分镜/换装已变化，分组方案需重新生成后再调整。",
    };
  }

  // ---- 校验 + 复算时长 ----
  const groups: GroupPlan[] = input.groups.map((group) => ({
    shotIds: group.shotIds,
    reason: group.reason,
    totalSeconds: 0,
  }));
  const validation = validateGroups(groups, shots);
  if (!validation.ok) {
    return {
      ok: false,
      code: "INVALID_GROUPS",
      error: "分组未通过校验：" + validation.errors.map((error) => error.description).join("；"),
      errors: validation.errors,
    };
  }
  const secondsById = new Map(
    shots.map((shot) => [shot.id, Math.max(0, (shot.endMs - shot.startMs) / 1000)]),
  );
  for (const group of groups) {
    const total = group.shotIds.reduce((sum, id) => sum + (secondsById.get(id) ?? 0), 0);
    group.totalSeconds = Math.round(total * 10) / 10;
  }

  // ---- 整表替换 + 产物记录人工版本（回落 draft 待重新确认）----
  const replaceError = await replaceEpisodeGroups(supabase, userId, input.episodeId, groups, scopeHash);
  if (replaceError) return { ok: false, code: "DB_ERROR", error: replaceError };

  const stats = computeGroupStats(groups);
  const userContent: JsonValue = {
    version: 1,
    status: "needs_confirmation",
    writer: "user",
    updatedAt: new Date().toISOString(),
    episodeId: input.episodeId,
    episodeNo,
    groupCount: stats.groupCount,
    totalDurationSeconds: stats.totalDurationSeconds,
    scopeHash,
    groups: buildGroupDetails(groups, shots, shotRows, looks, characterNames) as unknown as JsonValue,
  };
  // 人工调整使原确认失效：状态回落 draft（保留 content 供差异对照），
  // user_content 记录人工版本，下游确认后读 user_content。
  const { error: updateError } = await supabase
    .from("restyle_artifacts")
    .update({
      user_content: userContent,
      status: "draft",
      approved_by: null,
      approved_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", existing.row.id);
  if (updateError) return { ok: false, code: "DB_ERROR", error: updateError.message };

  return {
    ok: true,
    projectId: input.projectId,
    episodeId: input.episodeId,
    scopeHash,
    groupCount: stats.groupCount,
    totalDurationSeconds: stats.totalDurationSeconds,
  };
}

// --------------------------------------------------------------------
// 3) 读回（GroupingPanel 数据源）
// --------------------------------------------------------------------

export async function listGroupingCore(
  input: z.infer<typeof ListGroupingInputSchema>,
  deps: SupabaseContext,
): Promise<ListGroupingResult> {
  const { supabase } = deps;

  let episodeQuery = supabase
    .from("restyle_episodes")
    .select("id, episode_no")
    .eq("project_id", input.projectId)
    .order("episode_no", { ascending: true });
  if (input.episodeId) episodeQuery = episodeQuery.eq("id", input.episodeId);
  const { data: episodeRows, error: episodeError } = await episodeQuery;
  if (episodeError) return { ok: false, error: episodeError.message };
  const episodes = (episodeRows ?? []) as Array<{ id: string; episode_no: number | null }>;

  const looksResult = await readProjectLooks(supabase, input.projectId);
  if (looksResult.error) return { ok: false, error: looksResult.error };
  const scopeLooks = toScopeLooks(looksResult.looks!);

  const result: EpisodeGroupingData[] = [];
  for (const episode of episodes) {
    const shotsResult = await readEpisodeShots(supabase, episode.id);
    if (shotsResult.error) return { ok: false, error: shotsResult.error };
    const shotRows = shotsResult.rows!;
    const shots = shotRows.map(toGroupingShot);

    const { data: groupRows, error: groupError } = await supabase
      .from("restyle_groups")
      .select("id, group_no, shot_ids, reason, total_seconds, status, scope_hash")
      .eq("episode_id", episode.id)
      .order("group_no", { ascending: true });
    if (groupError) return { ok: false, error: groupError.message };

    const { data: artifactRow, error: artifactError } = await supabase
      .from("restyle_artifacts")
      .select("status, verdict, issues, content, user_content, revision, scope_hash")
      .eq("project_id", input.projectId)
      .eq("stage", GROUPING_STAGE)
      .eq("node_key", episode.id)
      .maybeSingle();
    if (artifactError) return { ok: false, error: artifactError.message };

    const currentScopeHash =
      shotRows.length > 0 ? groupingScopeHash(episode.id, shots, scopeLooks) : "";
    const artifact = (artifactRow as GroupingArtifactInfo | null) ?? null;
    result.push({
      episodeId: episode.id,
      episodeNo: episode.episode_no,
      shots: shotRows.map((row) => ({
        id: row.id,
        shot_no: row.shot_no,
        start_ms: row.start_ms,
        end_ms: row.end_ms,
        scene_type: row.scene_type,
        characters: shotNameList(row.characters),
        dialogue: row.dialogue,
      })),
      groups: (groupRows ?? []) as GroupingGroupRow[],
      artifact,
      currentScopeHash,
      stale: !!artifact && !!artifact.scope_hash && artifact.scope_hash !== currentScopeHash,
    });
  }
  return {
    ok: true,
    error: null,
    data: {
      episodes: result,
      looks: (looksResult.looks ?? []).map((look) => ({
        characterId: look.character_id,
        characterName: looksResult.characterNames?.get(look.character_id) ?? look.character_id,
        name: look.name,
        fromShot: look.from_shot,
        toShot: look.to_shot,
      })),
    },
  };
}
