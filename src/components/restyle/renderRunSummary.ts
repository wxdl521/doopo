// ====================================================================
// renderRunSummary —— 渲染队列收尾播报的成败判定（纯函数，可单测）
//
// 回归根因：completeRenderQueue 的「生成完成」播报读 projectsRef 里的
// renderStatus（React 状态，异步更新）——同一 run 内刚写入的失败在收尾时
// 还不可见（误报「全部完成」），上一轮 run 的失败附件却可见（跨 run 把旧
// 错误拼进「首个失败原因」）。修复：fail/complete 落笔时同步记录本轮
// 成败台账（renderRunOutcomesRef，不经过 React 状态），收尾只用本函数
// 对台账做判定，与 files 的实时性彻底解耦。
// ====================================================================

/** 本轮 run 内单个附件的最终结局。 */
export interface RenderRunOutcome {
  attachmentId: string;
  generatedKind?: string;
  episode?: string;
  segmentId?: string;
  ok: boolean;
  error?: string;
  resultUrl?: string;
}

export interface RenderRunSummary {
  /** 本轮失败的分段（可能有多个；只含本轮 run 产生的错误）。 */
  failedOutcomes: RenderRunOutcome[];
  /** 本轮是否有成片（final_video）合成成功且有可播放 URL。 */
  finalOk: boolean;
  /** 汇总口径：有分段失败、或有成片任务但成片未成功 → failed。 */
  status: "succeeded" | "failed";
}

/** 失败条目的展示标签：`EP02 U02`（无归属信息时回退占位）。 */
export function outcomeLabel(outcome: RenderRunOutcome): string {
  return [outcome.episode, outcome.segmentId].filter(Boolean).join(" ") || "该分段";
}

/**
 * 本轮 run 的成败汇总：
 * - failedOutcomes 只来自本轮台账，天然不串上一轮的历史错误；
 * - 有整集合成任务（hasFinalVideos）时，成片未成功也判 failed。
 */
export function summarizeRenderRun(
  outcomes: RenderRunOutcome[],
  options: { hasFinalVideos: boolean },
): RenderRunSummary {
  const failedOutcomes = outcomes.filter((outcome) => !outcome.ok);
  const finalOk = outcomes.some(
    (outcome) =>
      outcome.ok && outcome.generatedKind === "final_video" && Boolean(outcome.resultUrl),
  );
  const status =
    failedOutcomes.length > 0 || (options.hasFinalVideos && !finalOk) ? "failed" : "succeeded";
  return { failedOutcomes, finalOk, status };
}
