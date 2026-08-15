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

// --------------------------------------------------------------------
// 局部返工收尾的「该集可重触发合成」判定
//
// 线上缺口：首轮整集渲染分段大量失败时 stitch 失败（final_video 落 failed）；
// 之后局部返工补齐全部分段，但返工 run 的 finalEpisodes 为空，
// completeRenderQueue 不再触发该集合成，成片永远停在 failed 且无播报。
// 判定口径与 stitchFinalEpisodes 的缺段校验同源（分段不齐不合成）。
// --------------------------------------------------------------------

/** 判定所需的附件最小形状（RestyleAttachment 的子集）。 */
export interface RestitchFileShape {
  generatedKind?: string;
  episode?: string;
  segmentId?: string;
  url?: string;
  renderStatus?: string;
}

/**
 * 该集是否可（重新）触发整集合成：
 * - 本集分段 clips 必须全部有可用 http(s) URL（分段不齐不合成）；
 * - 成片合成中（renderStatus=running）不重复触发；
 * - 已有可用成片（有 URL 且非 failed）不重复触发；
 * - 成片占位缺失 / failed / 无 URL → 可触发（占位缺失由调用方补建）。
 */
export function episodeRestitchEligibility(
  files: RestitchFileShape[],
  episode: string,
): { eligible: boolean; reason?: string } {
  const clips = files.filter(
    (file) => file.generatedKind === "video_clip" && file.episode === episode,
  );
  if (!clips.length) return { eligible: false, reason: "本集没有分段视频" };
  const missing = clips.filter((clip) => !clip.url || !/^https?:\/\//i.test(clip.url));
  if (missing.length) {
    return {
      eligible: false,
      reason: `分段未齐：${missing.map((clip) => clip.segmentId ?? "?").join("、")}`,
    };
  }
  const finalVideo = files.find(
    (file) => file.generatedKind === "final_video" && file.episode === episode,
  );
  // 只拦 running（合成在途）；queued 只在本函数触发链里瞬时存在，
  // 拦它会挡住「停止后重跑」的恢复路径。
  if (finalVideo?.renderStatus === "running") {
    return { eligible: false, reason: "成片合成中" };
  }
  if (
    finalVideo?.url &&
    /^https?:\/\//i.test(finalVideo.url) &&
    finalVideo.renderStatus !== "failed"
  ) {
    return { eligible: false, reason: "已有可用成片" };
  }
  return { eligible: true };
}
