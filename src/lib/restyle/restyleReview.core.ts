// ====================================================================
//  转绘 v2 阶段二 · AI 审核 + 人工确认（关卡 1）—— restyleReview.functions.ts
//
//  流程（runAiSelfReviewFn）：
//    1. 积分预校验 ensureEnoughCredits(2)
//    2. 阶段闸门：restyle_artifacts 的 stage="analysis" 产物须全部
//       user_approved，否则直接返回 STAGE_NOT_APPROVED（不调 AI）。
//    3. 读取该集（或全部集）的 analysis_json + restyle_shots +
//       restyle_transcripts + restyle_source_assets。
//    4. 本地先跑 checkShotDialogueFit（表三本地口径），再调
//       INTERNAL_DIRECTOR_MODEL（失败回退 INTERNAL_DIRECTOR_FALLBACK_MODEL
//       重试一次），prompt = composePrompt(["ai-output-review",
//       "narrative-consistency-audit"], context)。
//    5. 产出三张固定文档写 restyle_reviews：
//         narrative_issues ← AI issue_list 与 verdict issues 归并
//         shot_mapping     ← AI shot_comparison 逐镜对照
//         dialogue_fit     ← 本地 checkShotDialogueFit + AI 复核 mergeIssues
//    6. 审核结论 upsert restyle_artifacts（stage="review",
//       node_key=episodeId 或 "project"），状态机推进到 ai_checked。
//
//  纯函数（契约解析 / issue 归并 / 台词时长）全部在 reviewMerge.ts。
//  restyle_* 新表未进生成的 Database 类型，context 收窄为
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
import { extractJson } from "./restyleVideoAnalysis.functions";
import {
  computeScopeHash,
  createInitialArtifact,
  transitionArtifact,
  type ArtifactState,
  type JsonValue,
} from "./artifactState";
import {
  checkShotDialogueFit,
  mergeIssues,
  validateReviewPayload,
  type ReviewIssue,
  type ReviewVerdict,
} from "./reviewMerge";

type SupabaseContext = { supabase: any; userId: string };

export const RunReviewInputSchema = z.object({
  projectId: z.string().min(1).max(128),
  episodeId: z.string().min(1).max(128).optional(),
});

const ReportInputSchema = z.object({
  projectId: z.string().min(1).max(128),
  episodeId: z.string().min(1).max(128).optional(),
});

/** 三张固定文档的 doc_kind（写入 restyle_reviews.doc_kind）。 */
export const REVIEW_DOC_KINDS = ["narrative_issues", "shot_mapping", "dialogue_fit"] as const;
export type ReviewDocKind = (typeof REVIEW_DOC_KINDS)[number];

// --------------------------------------------------------------------
// 依赖注入（测试可替换 callChat / ensureCredits）
// --------------------------------------------------------------------

export interface ReviewRunDeps {
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
}

export type RunReviewResult =
  | {
      ok: true;
      projectId: string;
      episodeId: string | null;
      verdict: ReviewVerdict;
      issueCount: number;
      docCounts: Record<ReviewDocKind, number>;
      model: string;
      usedFallback: boolean;
    }
  | { ok: false; code: string; error?: string; pending?: string[] };

// --------------------------------------------------------------------
// 读库
// --------------------------------------------------------------------

interface EpisodeRow {
  id: string;
  episode_no: number | null;
  analysis_json: unknown;
}

interface ShotRow {
  episode_id: string;
  shot_no: string;
  start_ms: number;
  end_ms: number;
  characters: unknown;
  dialogue: string | null;
  voice_type: string | null;
  scene_type: string | null;
}

interface TranscriptRow {
  episode_id: string;
  begin_ms: number;
  end_ms: number;
  text: string;
  speaker: string | null;
}

interface SourceAssetRow {
  episode_id: string;
  kind: string;
  source_name: string;
  aliases: unknown;
  appearance: string | null;
  wardrobe: string | null;
  description: string | null;
  relationships: unknown;
}

async function checkAnalysisStageGate(
  supabase: any,
  projectId: string,
): Promise<{ ok: true } | { ok: false; pending: string[] }> {
  const { data: rows, error } = await supabase
    .from("restyle_artifacts")
    .select("node_key, status")
    .eq("project_id", projectId)
    .eq("stage", "analysis");
  // 与 assertStageApprovedFn 同口径：查询失败、无产物、存在未确认产物均不放行。
  if (error) return { ok: false, pending: [] };
  const list = (rows ?? []) as Array<{ node_key: string; status: string }>;
  const pending = list.filter((r) => r.status !== "user_approved").map((r) => r.node_key);
  if (list.length === 0 || pending.length > 0) return { ok: false, pending };
  return { ok: true };
}

// --------------------------------------------------------------------
// prompt
// --------------------------------------------------------------------

const REVIEW_USER_INSTRUCTION = `请对 [CONTEXT] 中的整项目/整集分析产物执行关卡 1 审核：
1. 按 ai-output-review 契约检查：人物遗漏/重复、关系表闭合、分镜覆盖全时长（无空洞无重叠）、台词与人物匹配、跨集人设冲突。
2. 按 narrative-consistency-audit 契约产出三张固定文档。
只输出一个 JSON 对象，字段：
- verdict / issues / patched（ai-output-review 契约；verdict 可用 pass | pass_with_notes | fail）
- issue_list：叙事一致性问题清单（episode / issue_type / current / risk / suggestion / severity）
- shot_comparison：逐镜对照表，覆盖范围内每一集全部 shot，不允许抽样
- duration_dialogue_audit：分镜时长与台词完整性复核（fits=false 即超标标红）`;

function buildReviewMessages(context: Record<string, unknown>): ChatMessage[] {
  const system = composePrompt(
    ["ai-output-review", "narrative-consistency-audit"],
    JSON.stringify(context, null, 2),
  );
  return [
    { role: "system", content: system },
    { role: "user", content: REVIEW_USER_INSTRUCTION },
  ];
}

// --------------------------------------------------------------------
// AI 输出 → 三表行
// --------------------------------------------------------------------

interface ReviewDocRow {
  doc_kind: ReviewDocKind;
  issue_type: string | null;
  severity: string | null;
  description: string | null;
  risk: string | null;
  suggestion: string | null;
}

function asRecordArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is Record<string, unknown> =>
      !!item && typeof item === "object" && !Array.isArray(item),
  );
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** narrative-consistency-audit 表一 → ReviewIssue（description 带 EP 前缀）。 */
function issueListToReviewIssues(rows: Array<Record<string, unknown>>): ReviewIssue[] {
  return rows.map((row) => {
    const episode = str(row.episode);
    const current = str(row.current) ?? str(row.description) ?? "";
    const severity = validateReviewPayload({ issues: [row] }).issues[0]?.severity ?? "low";
    return {
      issueType: str(row.issue_type) ?? str(row.issueType) ?? "other",
      severity,
      description: episode ? `[${episode}] ${current}` : current,
      suggestion: str(row.suggestion) ?? "",
    };
  });
}

function buildNarrativeIssueRows(
  aiIssueList: Array<Record<string, unknown>>,
  reviewIssues: ReviewIssue[],
): ReviewDocRow[] {
  const fromTable = issueListToReviewIssues(aiIssueList);
  const merged = mergeIssues([fromTable, reviewIssues]);
  // 风险列只能来自表一原文，按归并 key 找回。
  const riskByKey = new Map<string, string | null>();
  aiIssueList.forEach((row, i) => {
    const issue = fromTable[i];
    if (issue) riskByKey.set(`${issue.issueType}|${issue.description}`, str(row.risk));
  });
  return merged.map((issue) => ({
    doc_kind: "narrative_issues",
    issue_type: issue.issueType,
    severity: issue.severity,
    description: issue.description,
    risk: riskByKey.get(`${issue.issueType}|${issue.description}`) ?? null,
    suggestion: issue.suggestion || null,
  }));
}

function buildShotMappingRows(
  shotComparison: Array<Record<string, unknown>>,
): ReviewDocRow[] {
  return shotComparison.map((row) => {
    const episode = str(row.episode) ?? "";
    const shotNo = str(row.shot_no) ?? str(row.shotNo) ?? "";
    const source = str(row.source_summary) ?? "";
    const target = str(row.target_summary) ?? "缺失";
    const charactersMatch = row.characters_match !== false;
    const dialogueMatch = row.dialogue_match !== false;
    const notes = str(row.notes);
    return {
      doc_kind: "shot_mapping",
      issue_type: "shot_mapping",
      severity: charactersMatch && dialogueMatch ? "low" : "medium",
      description: [episode, shotNo].filter(Boolean).join(" ") + `｜源: ${source}｜目标: ${target}`,
      risk: notes,
      suggestion:
        charactersMatch && dialogueMatch ? null : "请人工核对人物集合与台词完整性后再确认",
    };
  });
}

/** AI 表三中 fits=false 的行 → ReviewIssue，与本地 checkShotDialogueFit 归并。 */
function aiAuditToReviewIssues(rows: Array<Record<string, unknown>>): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  for (const row of rows) {
    if (row.fits !== false) continue;
    const episode = str(row.episode);
    const shotNo = str(row.shot_no) ?? str(row.shotNo) ?? undefined;
    const speech = typeof row.speech_duration_sec === "number" ? row.speech_duration_sec : null;
    const overflow = typeof row.overflow_sec === "number" ? row.overflow_sec : null;
    issues.push({
      issueType: "dialogue_overrun",
      severity: "medium",
      shotNo,
      description:
        `${episode ? `[${episode}] ` : ""}${shotNo ?? ""} 台词朗读${speech !== null ? `约 ${speech.toFixed(1)}s` : ""}超出分镜时长安全余量` +
        (overflow !== null && overflow > 0 ? `（超 ${overflow.toFixed(1)}s）` : ""),
      suggestion: str(row.suggestion) ?? "精简台词或延长该分镜时长",
    });
  }
  return issues;
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

async function upsertReviewArtifact(
  supabase: any,
  userId: string,
  key: { projectId: string; nodeKey: string },
  content: JsonValue,
  scopeHash: string,
  verdict: ReviewVerdict,
  issues: ReviewIssue[],
): Promise<{ state?: ArtifactState; error?: string }> {
  const { data: row, error } = await supabase
    .from("restyle_artifacts")
    .select("*")
    .eq("project_id", key.projectId)
    .eq("stage", "review")
    .eq("node_key", key.nodeKey)
    .maybeSingle();
  if (error) return { error: error.message };

  const now = new Date().toISOString();
  const issuesJson = issues as unknown as JsonValue[];
  let state: ArtifactState = row
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
  state = transitionArtifact(state, { type: "ai_check", verdict, issues: issuesJson });

  if (!row) {
    const { error: insertError } = await supabase.from("restyle_artifacts").insert({
      id: `art_${crypto.randomUUID()}`,
      user_id: userId,
      project_id: key.projectId,
      stage: "review",
      node_key: key.nodeKey,
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

  // user_content 不在更新负载里：AI 复检永不触碰人工改写。
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
// 核心流程（导出供测试直接调用；createServerFn 只是鉴权壳）
// --------------------------------------------------------------------

export async function runAiSelfReviewCore(
  input: { projectId: string; episodeId?: string },
  deps: ReviewRunDeps,
): Promise<RunReviewResult> {
  const { supabase, userId } = deps;
  const callChat = deps.callChat ?? callLovableChat;
  const ensureCredits = deps.ensureCredits ?? ensureEnoughCredits;
  const episodeId = input.episodeId ?? null;

  // ---- 1. 积分预校验 ----
  const guard = await ensureCredits(2, { kind: "image", model: INTERNAL_DIRECTOR_MODEL });
  if (!guard.ok) return { ok: false, code: "INSUFFICIENT_CREDITS", error: guard.error };

  // ---- 2. 阶段闸门：analysis 全部 user_approved 才放行 ----
  const gate = await checkAnalysisStageGate(supabase, input.projectId);
  if (!gate.ok) {
    return { ok: false, code: "STAGE_NOT_APPROVED", pending: gate.pending };
  }

  // ---- 3. 读分析产物 ----
  let episodeQuery = supabase
    .from("restyle_episodes")
    .select("id, episode_no, analysis_json")
    .eq("project_id", input.projectId)
    .order("episode_no", { ascending: true });
  if (episodeId) episodeQuery = episodeQuery.eq("id", episodeId);
  const { data: episodeRows, error: episodeError } = await episodeQuery;
  if (episodeError) return { ok: false, code: "DB_ERROR", error: episodeError.message };
  const episodes = (episodeRows ?? []) as EpisodeRow[];
  if (episodes.length === 0) {
    return episodeId
      ? { ok: false, code: "EPISODE_NOT_FOUND", error: "集不存在或不属于该项目。" }
      : { ok: false, code: "NO_EPISODES", error: "项目下没有可审核的集。" };
  }
  const episodeIds = episodes.map((e) => e.id);

  const [
    { data: shotRows, error: shotError },
    { data: transcriptRows, error: transcriptError },
    { data: assetRows, error: assetError },
  ] = await Promise.all([
    supabase
      .from("restyle_shots")
      .select("episode_id, shot_no, start_ms, end_ms, characters, dialogue, voice_type, scene_type")
      .in("episode_id", episodeIds)
      .order("start_ms", { ascending: true }),
    supabase
      .from("restyle_transcripts")
      .select("episode_id, begin_ms, end_ms, text, speaker")
      .in("episode_id", episodeIds)
      .order("begin_ms", { ascending: true }),
    supabase
      .from("restyle_source_assets")
      .select(
        "episode_id, kind, source_name, aliases, appearance, wardrobe, description, relationships",
      )
      .in("episode_id", episodeIds),
  ]);
  const dbError = shotError ?? transcriptError ?? assetError;
  if (dbError) return { ok: false, code: "DB_ERROR", error: dbError.message };
  const shots = (shotRows ?? []) as ShotRow[];
  const transcripts = (transcriptRows ?? []) as TranscriptRow[];
  const sourceAssets = (assetRows ?? []) as SourceAssetRow[];

  // ---- 4. 本地台词时长复核（表三本地口径）----
  const localFitIssues: ReviewIssue[] = [];
  for (const episode of episodes) {
    const label = `EP${String(episode.episode_no ?? 0).padStart(2, "0")}`;
    const episodeShots = shots.filter((s) => s.episode_id === episode.id);
    localFitIssues.push(
      ...checkShotDialogueFit(
        episodeShots.map((s) => ({
          shotNo: s.shot_no,
          durationSec: (s.end_ms - s.start_ms) / 1000,
          dialogue: s.dialogue,
        })),
      ).map((issue) => ({ ...issue, description: `[${label}] ${issue.description}` })),
    );
  }

  // ---- 5. 调 AI（主模型失败回退一次）----
  const context = {
    scope: episodeId ? { projectId: input.projectId, episodeId } : { projectId: input.projectId },
    episodes: episodes.map((e) => ({
      episodeId: e.id,
      episodeNo: e.episode_no,
      analysis: e.analysis_json ?? null,
      shots: shots.filter((s) => s.episode_id === e.id),
      transcripts: transcripts.filter((t) => t.episode_id === e.id),
      sourceAssets: sourceAssets.filter((a) => a.episode_id === e.id),
    })),
    localDialogueFit: localFitIssues,
  };
  const messages = buildReviewMessages(context);

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
      errorMessage: `审核调用失败（含回退）: ${aiResult.error}`,
      requestPayload: { projectId: input.projectId, episodeId, stage: "review" },
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
      errorMessage: `审核输出解析失败: ${msg}`,
      requestPayload: { projectId: input.projectId, episodeId, stage: "review_parse" },
      responseBody: aiResult.text.slice(0, 2_000),
      userId,
    });
    return { ok: false, code: "AI_OUTPUT_INVALID", error: msg };
  }

  const review = validateReviewPayload(parsed);
  const parsedRec = (parsed ?? {}) as Record<string, unknown>;
  const aiIssueList = asRecordArray(parsedRec.issue_list);
  const aiShotComparison = asRecordArray(parsedRec.shot_comparison);
  const aiDurationAudit = asRecordArray(parsedRec.duration_dialogue_audit);

  // ---- 6. 三表行：表一归并、表二直写、表三本地+AI 归并 ----
  const narrativeRows = buildNarrativeIssueRows(aiIssueList, review.issues);
  const shotMappingRows = buildShotMappingRows(aiShotComparison);
  const dialogueFitIssues = mergeIssues([localFitIssues, aiAuditToReviewIssues(aiDurationAudit)]);
  const dialogueFitRows: ReviewDocRow[] = dialogueFitIssues.map((issue) => ({
    doc_kind: "dialogue_fit",
    issue_type: issue.issueType,
    severity: issue.severity,
    description: issue.shotNo ? `${issue.shotNo} ${issue.description}` : issue.description,
    risk: null,
    suggestion: issue.suggestion || null,
  }));
  const allDocRows = [...narrativeRows, ...shotMappingRows, ...dialogueFitRows];

  // ---- 7. 替换写 restyle_reviews（先清本轮范围内旧行）----
  const now = new Date().toISOString();
  let deleteQuery = supabase
    .from("restyle_reviews")
    .delete()
    .eq("project_id", input.projectId)
    .in("doc_kind", [...REVIEW_DOC_KINDS]);
  if (episodeId) deleteQuery = deleteQuery.eq("episode_id", episodeId);
  const { error: deleteError } = await deleteQuery;
  if (deleteError) return { ok: false, code: "DB_ERROR", error: deleteError.message };

  if (allDocRows.length > 0) {
    const insertRows = allDocRows.map((row) => ({
      id: `rev_${crypto.randomUUID()}`,
      user_id: userId,
      project_id: input.projectId,
      episode_id: episodeId,
      ...row,
      status: "open",
      created_at: now,
    }));
    const { error: insertError } = await supabase.from("restyle_reviews").insert(insertRows);
    if (insertError) return { ok: false, code: "DB_ERROR", error: insertError.message };
  }

  // ---- 8. 审核结论 upsert restyle_artifacts（stage="review"）----
  const mergedIssues = mergeIssues([
    review.issues,
    narrativeRows.map((r) => ({
      issueType: r.issue_type ?? "other",
      severity: (r.severity as ReviewIssue["severity"]) ?? "low",
      description: r.description ?? "",
      suggestion: r.suggestion ?? "",
    })),
    dialogueFitIssues,
  ]);
  const artifactContent: JsonValue = {
    version: 1,
    generatedAt: now,
    model: aiResult.model,
    usedFallback,
    verdict: review.verdict,
    docs: {
      narrative_issues: narrativeRows.length,
      shot_mapping: shotMappingRows.length,
      dialogue_fit: dialogueFitRows.length,
    },
    ...(review.patched !== undefined ? { patched: review.patched } : {}),
  };
  const scopeHash = computeScopeHash({
    projectId: input.projectId,
    episodeId,
    analyses: episodes.map((e) => e.analysis_json ?? null),
    shots,
    transcripts,
    sourceAssets,
  });
  const upserted = await upsertReviewArtifact(
    supabase,
    userId,
    { projectId: input.projectId, nodeKey: episodeId ?? "project" },
    artifactContent,
    scopeHash,
    review.verdict,
    mergedIssues,
  );
  if (upserted.error) return { ok: false, code: "DB_ERROR", error: upserted.error };

  return {
    ok: true,
    projectId: input.projectId,
    episodeId,
    verdict: review.verdict,
    issueCount: mergedIssues.length,
    docCounts: {
      narrative_issues: narrativeRows.length,
      shot_mapping: shotMappingRows.length,
      dialogue_fit: dialogueFitRows.length,
    },
    model: aiResult.model,
    usedFallback,
  };
}

// --------------------------------------------------------------------
// createServerFn（鉴权壳）
// --------------------------------------------------------------------

/**
 * 关卡 1 · AI 自检：闸门校验后调内部总导演模型审核分析产物，产出三张
 * 固定文档（restyle_reviews）并推进 review 产物到 ai_checked。
 */
