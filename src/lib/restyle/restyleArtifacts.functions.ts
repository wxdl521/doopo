// ====================================================================
//  转绘 v2 产物确认中枢 —— restyle_artifacts 读写（createServerFn）
//
//  状态推进规则全部委托 artifactState.ts 的纯函数状态机，这里只负责
//  鉴权、zod 校验、行与状态的互转。restyle_artifacts 尚未写入生成
//  的 Database 类型，与 errorLogs.functions.ts 一样放宽 supabase 类型。
// ====================================================================

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  createInitialArtifact,
  transitionArtifact,
  type ArtifactState,
  type ArtifactStatus,
  type JsonValue,
} from "./artifactState";

type SupabaseContext = { supabase: any; userId: string };

const KeySchema = z.object({
  projectId: z.string().min(1).max(128),
  stage: z.string().min(1).max(64),
  nodeKey: z.string().min(1).max(200),
});

const UpsertInputSchema = KeySchema.extend({
  content: z.unknown(),
  scopeHash: z.string().min(1).max(128),
  verdict: z.string().max(4_000).optional(),
  issues: z.array(z.unknown()).max(500).optional(),
});

const ApproveInputSchema = KeySchema.extend({
  userContent: z.unknown().optional(),
});

const RejectInputSchema = KeySchema.extend({
  feedback: z.string().max(4_000).optional(),
});

const AssertStageInputSchema = z.object({
  projectId: z.string().min(1).max(128),
  stage: z.string().min(1).max(64),
});

const ListInputSchema = z.object({
  projectId: z.string().min(1).max(128),
  stage: z.string().min(1).max(64).optional(),
});

export interface ArtifactRow {
  id: string;
  project_id: string;
  stage: string;
  node_key: string;
  content: JsonValue;
  user_content: JsonValue;
  status: ArtifactStatus;
  verdict: string | null;
  issues: JsonValue[] | null;
  scope_hash: string | null;
  revision: number;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

export type ArtifactFnResult =
  | { ok: true; artifact: ArtifactState }
  | { ok: false; code: string; error: string };

export type AssertStageResult =
  | { ok: true }
  | { ok: false; code: "STAGE_NOT_APPROVED"; pending: string[] };

function stateFromRow(row: ArtifactRow): ArtifactState {
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

async function fetchArtifact(
  supabase: any,
  key: z.infer<typeof KeySchema>,
): Promise<{ row: ArtifactRow | null; error: string | null }> {
  const { data, error } = await supabase
    .from("restyle_artifacts")
    .select("*")
    .eq("project_id", key.projectId)
    .eq("stage", key.stage)
    .eq("node_key", key.nodeKey)
    .maybeSingle();
  if (error) return { row: null, error: error.message };
  return { row: (data as ArtifactRow | null) ?? null, error: null };
}

/**
 * AI 写入/重生成产物：不存在则插入，存在则按状态机推进（ai_write，
 * 可选附带 ai_check 结论）。永不覆写用户已确认的 userContent。
 */
export const upsertArtifactFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => UpsertInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<ArtifactFnResult> => {
    const { supabase, userId } = context as SupabaseContext;
    const now = new Date().toISOString();

    const { row, error } = await fetchArtifact(supabase, data);
    if (error) return { ok: false, code: "DB_ERROR", error };

    // zod 校验为 unknown，进入状态机前收窄为可序列化的 JsonValue。
    const content = data.content as JsonValue;
    let state = row
      ? transitionArtifact(stateFromRow(row), {
          type: "ai_write",
          content,
          scopeHash: data.scopeHash,
        })
      : createInitialArtifact(content, data.scopeHash);
    if (data.verdict !== undefined) {
      state = transitionArtifact(state, {
        type: "ai_check",
        verdict: data.verdict,
        issues: (data.issues ?? []) as JsonValue[],
      });
    }

    if (!row) {
      const { error: insertError } = await supabase.from("restyle_artifacts").insert({
        id: `art_${crypto.randomUUID()}`,
        user_id: userId,
        project_id: data.projectId,
        stage: data.stage,
        node_key: data.nodeKey,
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
      if (insertError) return { ok: false, code: "DB_ERROR", error: insertError.message };
      return { ok: true, artifact: state };
    }

    // user_content 不在更新负载里：ai_write/ai_check 都不允许触碰人工改写。
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
      .eq("id", row.id);
    if (updateError) return { ok: false, code: "DB_ERROR", error: updateError.message };
    return { ok: true, artifact: state };
  });

/** 人工确认：置 user_approved，写 approved_by/at，revision+1。 */
export const approveArtifactFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => ApproveInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<ArtifactFnResult> => {
    const { supabase, userId } = context as SupabaseContext;
    const { row, error } = await fetchArtifact(supabase, data);
    if (error) return { ok: false, code: "DB_ERROR", error };
    if (!row) return { ok: false, code: "ARTIFACT_NOT_FOUND", error: "产物不存在，无法确认。" };

    const state = transitionArtifact(stateFromRow(row), {
      type: "approve",
      userContent: data.userContent as JsonValue | undefined,
    });
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
      .eq("id", row.id);
    if (updateError) return { ok: false, code: "DB_ERROR", error: updateError.message };
    return { ok: true, artifact: state };
  });

/** 人工打回：置 rejected，feedback 追加进 issues。 */
export const rejectArtifactFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => RejectInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<ArtifactFnResult> => {
    const { supabase } = context as SupabaseContext;
    const { row, error } = await fetchArtifact(supabase, data);
    if (error) return { ok: false, code: "DB_ERROR", error };
    if (!row) return { ok: false, code: "ARTIFACT_NOT_FOUND", error: "产物不存在，无法打回。" };

    let state = transitionArtifact(stateFromRow(row), { type: "reject" });
    if (data.feedback) {
      state = {
        ...state,
        issues: [
          ...state.issues,
          { severity: "major", type: "user_feedback", description: data.feedback },
        ],
      };
    }
    const { error: updateError } = await supabase
      .from("restyle_artifacts")
      .update({
        status: state.status,
        issues: state.issues,
        approved_by: null,
        approved_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    if (updateError) return { ok: false, code: "DB_ERROR", error: updateError.message };
    return { ok: true, artifact: state };
  });

/**
 * 阶段闸门：该 stage 全部产物均 user_approved 才放行。
 * scope_hash 失效时状态机已把产物回落 draft，因此 user_approved 即代表
 * 指纹仍然有效。返回式结果，不抛错。
 */
export const assertStageApprovedFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => AssertStageInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<AssertStageResult> => {
    const { supabase } = context as SupabaseContext;
    const { data: rows, error } = await supabase
      .from("restyle_artifacts")
      .select("node_key, status")
      .eq("project_id", data.projectId)
      .eq("stage", data.stage);
    if (error) return { ok: false, code: "STAGE_NOT_APPROVED", pending: [] };

    const pending = (rows ?? [])
      .filter((row: { status: string }) => row.status !== "user_approved")
      .map((row: { node_key: string }) => row.node_key);
    // 没有任何产物视为未就绪：闸门不为空 stage 放行。
    if ((rows ?? []).length === 0 || pending.length > 0) {
      return { ok: false, code: "STAGE_NOT_APPROVED", pending };
    }
    return { ok: true };
  });

/** 产物列表，可按 stage 过滤。 */
export const listArtifactsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => ListInputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context as SupabaseContext;
    let query = supabase
      .from("restyle_artifacts")
      .select("*")
      .eq("project_id", data.projectId)
      .order("stage", { ascending: true })
      .order("node_key", { ascending: true });
    if (data.stage) query = query.eq("stage", data.stage);
    const { data: rows, error } = await query;
    if (error) return { ok: false as const, error: error.message, artifacts: [] };
    return { ok: true as const, error: null, artifacts: (rows ?? []) as ArtifactRow[] };
  });
