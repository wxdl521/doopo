// ====================================================================
// planWindows —— 长片方案生成的分窗拆分/合并（纯函数，可单测）
//
// 背景：generateRestylePlan 单次导演模型调用对长片（如 258s）输入输出都大，
// 线上三次均在 100~101s 被平台 ERR_CONNECTION_CLOSED（约 100s 无字节断连）。
// 根治：长片按固定时间窗拆分，每窗一次调用（输入只含该窗镜头子集、输出只含
// 该窗分段），单窗必然远低于平台上限。
// 注意（回归修正）：窗循环必须跑在客户端（与分析单元循环同一范式）——
// 全部窗塞在同一个 serverFn 请求内时，浏览器↔平台响应在循环期间零字节
// 输出，照样被平台掐断。本模块因此同时供客户端（切窗/合并/失败决策）与
// 服务端（单窗 shotsInWindow/mergeWindowSegments、finalize 的 applyPlanCoverage）
// 使用：
//   - splitIntoWindows / buildPlanWindowJobs：按窗长切窗、生成窗任务清单；
//   - shotsInWindow：镜头按 startMs 归属时间窗（跨窗镜头归起始窗）；
//   - mergeWindowSegments：各窗分段夹取到窗边界、按时间排序、U01 起全局
//     重排段号，窗内段数超动态上限截取并记 warning；
//   - windowFailureAction / summarizeWindowCalls：客户端窗循环的失败决策
//     （单窗重试一次、仍败记 warning 继续、全部失败才整体报错）；
//   - applyPlanCoverage：分窗合并后的区间推算 + ensureFullCoverage 兜底
//     （finalizeRestylePlanCoverage 与 generateRestylePlan 单次路径共用）。
// ====================================================================

import type { DirectionShot } from "./cameraDirection";
import { ensureFullCoverage, type CoverageEpisode } from "./ensureFullCoverage";
import { resolveSegmentTimeRange } from "./segmentReference";

/**
 * 单窗时长（秒）。取值 90：与平台约 100s 无字节断连上限对齐——单窗调用的
 * 输入（≤90s 镜头子集）与输出（≤11 段）都足够小，远低于断连阈值；
 * 单窗 90s AbortController 仍保留作为兜底。
 */
export const PLAN_WINDOW_SEC = 90;

export interface PlanWindow {
  /** 窗序号（0 起）。 */
  index: number;
  startMs: number;
  /** 右开边界；最后一窗等于总时长。 */
  endMs: number;
}

/**
 * 把 durationSec 按 windowSec 切成连续时间窗（[startMs, endMs) 首尾相接）。
 * durationSec <= windowSec 时返回单窗（短片直通，与原单次调用等价）；
 * durationSec <= 0 返回空数组。
 */
export function splitIntoWindows(durationSec: number, windowSec = PLAN_WINDOW_SEC): PlanWindow[] {
  if (!(durationSec > 0) || !(windowSec > 0)) return [];
  const totalMs = Math.round(durationSec * 1000);
  const windowMs = Math.round(windowSec * 1000);
  const count = Math.ceil(totalMs / windowMs);
  return Array.from({ length: count }, (_, index) => ({
    index,
    startMs: index * windowMs,
    endMs: Math.min((index + 1) * windowMs, totalMs),
  }));
}

/** 镜头按 startMs 归属时间窗：跨窗镜头归起始窗（startMs 落在哪个窗就属于哪个窗）。 */
export function shotsInWindow<T extends { startMs: number }>(shots: T[], window: PlanWindow): T[] {
  return shots.filter((shot) => shot.startMs >= window.startMs && shot.startMs < window.endMs);
}

/** 参与分窗合并的最小分段字段集（RestylePlanEpisode.segments 的子集）。 */
export interface WindowedSegment {
  id: string;
  prompt: string;
  startMs?: number;
  endMs?: number;
}

/**
 * 合并各窗分段为一个集的分段序列：
 * 1. 每窗段数超过 maxSegmentsPerWindow 时截取并记 warning；
 * 2. 带有效区间的分段夹取到所属窗边界 [startMs, endMs]（越界记 warning）；
 * 3. 按（窗序号, startMs）排序，无区间段排在所属窗带区间段之后；
 * 4. U01 起全局重排段号。
 */
export function mergeWindowSegments(
  parts: Array<{ window: PlanWindow; segments: WindowedSegment[] }>,
  maxSegmentsPerWindow: number,
): { segments: WindowedSegment[]; warnings: string[] } {
  const warnings: string[] = [];
  const merged: WindowedSegment[] = [];
  const ordered = [...parts].sort((a, b) => a.window.index - b.window.index);

  for (const { window, segments } of ordered) {
    const tag = `第 ${window.index + 1} 窗`;
    let windowSegments = segments;
    if (segments.length > maxSegmentsPerWindow) {
      warnings.push(`${tag}分段数 ${segments.length} 超过上限 ${maxSegmentsPerWindow}，已截取前 ${maxSegmentsPerWindow} 段。`);
      windowSegments = segments.slice(0, maxSegmentsPerWindow);
    }
    const ranged: WindowedSegment[] = [];
    const unranged: WindowedSegment[] = [];
    for (const segment of windowSegments) {
      if (
        typeof segment.startMs === "number" &&
        typeof segment.endMs === "number" &&
        Number.isFinite(segment.startMs) &&
        Number.isFinite(segment.endMs) &&
        segment.startMs < segment.endMs
      ) {
        const startMs = Math.max(window.startMs, Math.min(segment.startMs, window.endMs));
        const endMs = Math.max(window.startMs, Math.min(segment.endMs, window.endMs));
        if (startMs !== segment.startMs || endMs !== segment.endMs) {
          warnings.push(`${tag}分段 ${segment.id} 越出窗边界 [${window.startMs}, ${window.endMs}]，已夹取。`);
        }
        // 夹取后时长 <= 0 的分段丢弃（完全落在窗外），由覆盖兜底补段
        if (endMs > startMs) ranged.push({ ...segment, startMs, endMs });
        else warnings.push(`${tag}分段 ${segment.id} 完全越出窗边界，已丢弃。`);
      } else {
        unranged.push(segment);
      }
    }
    ranged.sort((a, b) => (a.startMs ?? 0) - (b.startMs ?? 0));
    merged.push(...ranged, ...unranged);
  }

  return {
    segments: merged.map((segment, index) => ({
      ...segment,
      id: `U${String(index + 1).padStart(2, "0")}`,
    })),
    warnings,
  };
}


// --------------------------------------------------------------------
// 客户端窗循环：任务清单 / 失败决策 / 结果汇总
// --------------------------------------------------------------------

/** 一个窗调用任务：某集的某个时间窗。 */
export interface PlanWindowJob {
  videoId: string;
  /** 该集权威总时长（毫秒）。 */
  durationMs: number;
  window: PlanWindow;
  /** 该集总窗数（>1 即长片分窗）。 */
  windowCount: number;
}

/**
 * 生成窗任务清单：每集按其权威时长切窗（短片单窗直通），未知时长的集
 * 不产生任务（由调用方给占位分段）。客户端据此逐窗调 generateRestylePlan。
 */
export function buildPlanWindowJobs(
  files: Array<{ videoId: string; durationMs?: number }>,
  windowSec = PLAN_WINDOW_SEC,
): PlanWindowJob[] {
  return files.flatMap((file) => {
    if (!file.durationMs || file.durationMs <= 0) return [];
    const windows = splitIntoWindows(file.durationMs / 1000, windowSec);
    return windows.map((window) => ({
      videoId: file.videoId,
      durationMs: file.durationMs!,
      window,
      windowCount: windows.length,
    }));
  });
}

/** 单窗失败决策：attempt 从 1 起，第一次失败重试，第二次失败记 warning 跳过。 */
export function windowFailureAction(attempt: number): "retry" | "skip" {
  return attempt < 2 ? "retry" : "skip";
}

/** 一次窗调用的结果（客户端驱动器产出）。 */
export interface WindowCallResult {
  job: PlanWindowJob;
  ok: boolean;
  segments?: WindowedSegment[];
  error?: string;
}

/**
 * 整批窗结果汇总：全部失败需整体报错（渠道性故障不应被兜底补段掩盖）；
 * 部分失败继续，逐失败窗记 warning（缺口由覆盖兜底补段）。
 */
export function summarizeWindowCalls(results: WindowCallResult[]): {
  allFailed: boolean;
  warnings: string[];
} {
  const warnings: string[] = [];
  for (const result of results) {
    if (result.ok) continue;
    warnings.push(
      `「${result.job.videoId}」第 ${result.job.window.index + 1}/${result.job.windowCount} 窗生成失败（${result.error ?? "未知错误"}），缺口将由覆盖兜底补段。`,
    );
  }
  return { allFailed: results.length > 0 && results.every((result) => !result.ok), warnings };
}

// --------------------------------------------------------------------
// finalize：区间推算 + 全片覆盖兜底（服务端 finalizeRestylePlanCoverage 用）
// --------------------------------------------------------------------

/**
 * 分窗合并后的收尾纯计算：逐段 resolveSegmentTimeRange（显式区间优先，
 * 缺失按场景分组推算）→ ensureFullCoverage（越界/重叠修正 + 缺口确定性
 * 补段 + 段号重排）。无 LLM 调用，秒级返回。
 */
export function applyPlanCoverage<T extends CoverageEpisode>(
  episodes: T[],
  shots: DirectionShot[],
  resolveDurationMs: (episodeId: string) => number | undefined,
): { episodes: T[]; warnings: string[] } {
  const episodesWithRanges = episodes.map((episode) => ({
    ...episode,
    segments: episode.segments.map((segment) => {
      const range = resolveSegmentTimeRange({
        segmentId: segment.id,
        explicit: { startMs: segment.startMs, endMs: segment.endMs },
        shots,
        segmentCount: episode.segments.length,
      });
      return range ? { ...segment, startMs: range.startMs, endMs: range.endMs } : segment;
    }),
  }));
  return ensureFullCoverage(episodesWithRanges, shots, resolveDurationMs);
}
