// ====================================================================
// 转绘 v2 · 阶段二 AI 审核（服务端壳）。核心逻辑在 restyleReview.core.ts，
// 拆开是为了避免 import-protection 把服务端依赖带进客户端图。
// ====================================================================
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { JsonValue } from "./artifactState";
import {
  runAiSelfReviewCore,
  REVIEW_DOC_KINDS,
  RunReviewInputSchema,
  type ReviewDocKind,
  type RunReviewResult,
} from "./restyleReview.core";

type SupabaseContext = { supabase: any; userId: string };

export type { ReviewDocKind } from "./restyleReview.core";

const ReportInputSchema = z.object({
  projectId: z.string().min(1),
  episodeId: z.string().optional(),
});

export const runAiSelfReviewFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => RunReviewInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<RunReviewResult> => {
    const { supabase, userId } = context as SupabaseContext;
    return runAiSelfReviewCore(data, { supabase, userId });
  });

export interface ReviewReportRow {
  id: string;
  doc_kind: string;
  episode_id: string | null;
  issue_type: string | null;
  severity: string | null;
  description: string | null;
  risk: string | null;
  suggestion: string | null;
  status: string;
  created_at: string;
}

export type ReviewReportResult =
  | {
      ok: true;
      error: null;
      docs: Record<ReviewDocKind, ReviewReportRow[]>;
      artifacts: Array<{
        node_key: string;
        status: string;
        verdict: string | null;
        issues: JsonValue[];
        revision: number;
        updated_at: string;
      }>;
    }
  | { ok: false; error: string };

/** 审核面板数据源：三表文档 + review 阶段产物结论。 */
export const getReviewReportFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => ReportInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<ReviewReportResult> => {
    const { supabase } = context as SupabaseContext;

    let reviewQuery = supabase
      .from("restyle_reviews")
      .select("*")
      .eq("project_id", data.projectId)
      .in("doc_kind", [...REVIEW_DOC_KINDS])
      .order("created_at", { ascending: true });
    if (data.episodeId) reviewQuery = reviewQuery.eq("episode_id", data.episodeId);
    const { data: reviewRows, error: reviewError } = await reviewQuery;
    if (reviewError) return { ok: false, error: reviewError.message };

    const docs: Record<ReviewDocKind, ReviewReportRow[]> = {
      narrative_issues: [],
      shot_mapping: [],
      dialogue_fit: [],
    };
    for (const row of (reviewRows ?? []) as ReviewReportRow[]) {
      if (row.doc_kind in docs) {
        docs[row.doc_kind as ReviewDocKind].push(row);
      }
    }

    let artifactQuery = supabase
      .from("restyle_artifacts")
      .select("node_key, status, verdict, issues, revision, updated_at")
      .eq("project_id", data.projectId)
      .eq("stage", "review");
    if (data.episodeId) artifactQuery = artifactQuery.eq("node_key", data.episodeId);
    const { data: artifactRows, error: artifactError } = await artifactQuery;
    if (artifactError) return { ok: false, error: artifactError.message };

    return {
      ok: true,
      error: null,
      docs,
      artifacts: (artifactRows ?? []) as Array<{
        node_key: string;
        status: string;
        verdict: string | null;
        issues: JsonValue[];
        revision: number;
        updated_at: string;
      }>,
    };
  });
