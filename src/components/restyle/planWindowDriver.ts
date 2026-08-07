// ====================================================================
// planWindowDriver —— 客户端驱动的长片分窗方案生成（可单测）
//
// 回归修正：服务端单请求内跑全部窗会被平台 ~100s 零字节断连（浏览器↔平台
// 响应在窗循环期间没有字节输出）。窗循环因此下沉到客户端（与分析单元循环
// 同一范式）：逐窗调 generateRestylePlan(window)（每窗一个请求，30-60s，
// 安全）→ 合并重排 → 调 finalizeRestylePlanCoverage 做覆盖兜底。
// 失败决策（planWindows 纯函数）：单窗失败重试一次，仍败记 warning 继续
// （缺口由 finalize 的 ensureFullCoverage 补段），全部窗失败才整体报错。
// ====================================================================

import {
  mergeWindowSegments,
  PLAN_WINDOW_SEC,
  summarizeWindowCalls,
  windowFailureAction,
  type PlanWindowJob,
  type WindowCallResult,
  type WindowedSegment,
} from "@/lib/restyle/planWindows";

export type WindowedPlanDriveResult =
  | {
      ok: true;
      /** 按 videoId 合并重排后的分段（未过覆盖兜底，交给 finalize）。 */
      segmentsByVideo: Record<string, WindowedSegment[]>;
      warnings: string[];
    }
  | { ok: false; error: string };

/**
 * 逐窗串行调用（串行与分析单元循环一致，避免多窗并发把单请求时长又堆上去）。
 * callWindow 注入实际 serverFn 调用，测试可替换。
 */
export async function driveWindowedPlanCalls(input: {
  jobs: PlanWindowJob[];
  callWindow: (
    job: PlanWindowJob,
  ) => Promise<{ ok: true; segments: WindowedSegment[] } | { ok: false; error: string }>;
  isAborted?: () => boolean;
  onProgress?: (done: number, total: number) => void;
}): Promise<WindowedPlanDriveResult> {
  const results: WindowCallResult[] = [];
  for (let i = 0; i < input.jobs.length; i += 1) {
    if (input.isAborted?.()) break;
    const job = input.jobs[i];
    input.onProgress?.(i + 1, input.jobs.length);
    // 单窗失败重试一次（windowFailureAction：第一次 retry、第二次 skip）
    let result: WindowCallResult = { job, ok: false, error: "未知错误" };
    for (let attempt = 1; ; attempt += 1) {
      const call = await input.callWindow(job);
      result = call.ok
        ? { job, ok: true, segments: call.segments }
        : { job, ok: false, error: call.error };
      if (result.ok || windowFailureAction(attempt) === "skip") break;
    }
    results.push(result);
  }

  const summary = summarizeWindowCalls(results);
  // 全部窗失败多为渠道性故障，不应由兜底补段掩盖，整体报错。
  if (summary.allFailed) {
    return { ok: false, error: results[0]?.error ?? "全部时间窗生成失败" };
  }

  // 按集合并：成功窗 mergeWindowSegments（窗内夹取/排序/U01 起全局重排）。
  const maxSegmentsPerWindow = Math.ceil(PLAN_WINDOW_SEC / 10) + 2;
  const warnings = [...summary.warnings];
  const segmentsByVideo: Record<string, WindowedSegment[]> = {};
  const videoIds = [...new Set(input.jobs.map((job) => job.videoId))];
  for (const videoId of videoIds) {
    const parts = results
      .filter((result) => result.job.videoId === videoId && result.ok)
      .map((result) => ({ window: result.job.window, segments: result.segments ?? [] }));
    if (!parts.length) {
      // 该集所有窗都失败：不给分段，由调用方回落占位段 + finalize 覆盖兜底。
      warnings.push(`「${videoId}」全部时间窗未产出分段，已给出占位分段，缺口将由覆盖兜底补段。`);
      continue;
    }
    const merged = mergeWindowSegments(parts, maxSegmentsPerWindow);
    warnings.push(...merged.warnings.map((warning) => `「${videoId}」${warning}`));
    segmentsByVideo[videoId] = merged.segments;
  }
  return { ok: true, segmentsByVideo, warnings };
}
