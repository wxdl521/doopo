// ====================================================================
// segmentReference —— 转绘分段参考视频裁剪（修复素材库 400：
// 「Duration must be between 1.8s and 30.2s」）。
// 1. resolveSegmentTimeRange：分段时间区间三级推算 —— 模型显式给出 →
//    按分段序号在逐镜表上就近划分 → 按分段数均分原片时长；
//    结果统一夹取到素材库允许的 1.8–30 秒。
// 2. ensureSegmentReferenceClip：提交裁剪任务并轮询取回片段 URL，
//    命中项目级缓存（sourceId|startMs|endMs）时不重复裁剪。
// 3. withBackoffRetry：网络瞬时错误（Failed to fetch）退避 2 秒重试一次。
// 除标注 async 的函数外均为纯函数，依赖（提交/轮询/睡眠）全部注入，便于测试。
// ====================================================================

import { REFERENCE_VIDEO_MAX_MS, REFERENCE_VIDEO_MIN_MS } from "../videoAssetLibrary";
import type { DirectionShot } from "./cameraDirection";
import { segmentIndexFromId } from "./shotSchedule";

export type SegmentTimeRange = { startMs: number; endMs: number };

/**
 * 把区间夹取到素材库允许的 1.8–30 秒：
 * - 非法区间（非有限数 / 负起点 / 起点不早于终点）返回 undefined；
 * - 超过 30 秒向后截断；不足 1.8 秒向后补齐。
 */
export function clampSegmentRange(startMs: number, endMs: number): SegmentTimeRange | undefined {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return undefined;
  const start = Math.round(startMs);
  let end = Math.round(endMs);
  if (start < 0 || start >= end) return undefined;
  if (end - start > REFERENCE_VIDEO_MAX_MS) end = start + REFERENCE_VIDEO_MAX_MS;
  if (end - start < REFERENCE_VIDEO_MIN_MS) end = start + REFERENCE_VIDEO_MIN_MS;
  return { startMs: start, endMs: end };
}

/**
 * 按分段序号把逐镜表均分为 segmentCount 组，取第 segmentIndex 组
 * 首镜 startMs 到末镜 endMs 作为该段区间（就近推算兜底）。
 */
export function rangeFromShots(
  shots: DirectionShot[],
  segmentIndex: number,
  segmentCount: number,
): SegmentTimeRange | undefined {
  if (!shots.length || segmentIndex < 0 || segmentCount < 1) return undefined;
  const sorted = [...shots].sort((a, b) => a.startMs - b.startMs);
  const begin = Math.floor((segmentIndex * sorted.length) / segmentCount);
  const end = Math.max(begin + 1, Math.floor(((segmentIndex + 1) * sorted.length) / segmentCount));
  const group = sorted.slice(begin, Math.min(end, sorted.length));
  if (!group.length) return undefined;
  return clampSegmentRange(group[0]!.startMs, group[group.length - 1]!.endMs);
}

/** 按分段数均分原片时长（无逐镜表时的最终兜底）。 */
export function rangeFromEvenSplit(
  sourceDurationMs: number,
  segmentIndex: number,
  segmentCount: number,
): SegmentTimeRange | undefined {
  if (!Number.isFinite(sourceDurationMs) || sourceDurationMs <= 0) return undefined;
  if (segmentIndex < 0 || segmentCount < 1) return undefined;
  const per = sourceDurationMs / segmentCount;
  return clampSegmentRange(segmentIndex * per, (segmentIndex + 1) * per);
}

/**
 * 分段时间区间三级推算：
 * 1. 模型显式给出的 startMs/endMs（校验 + 夹取）；
 * 2. 逐镜表按分段序号就近划分；
 * 3. 按分段数均分原片时长。
 * 三者都不可用时返回 undefined（调用方维持整片提交的旧行为）。
 */
export function resolveSegmentTimeRange(input: {
  segmentId?: string;
  explicit?: { startMs?: number; endMs?: number };
  shots?: DirectionShot[];
  segmentCount: number;
  sourceDurationMs?: number;
}): SegmentTimeRange | undefined {
  const segmentIndex = segmentIndexFromId(input.segmentId);
  const explicit = input.explicit;
  if (explicit && typeof explicit.startMs === "number" && typeof explicit.endMs === "number") {
    const range = clampSegmentRange(explicit.startMs, explicit.endMs);
    if (range) return range;
  }
  if (segmentIndex === undefined) return undefined;
  const fromShots = rangeFromShots(input.shots ?? [], segmentIndex, input.segmentCount);
  if (fromShots) return fromShots;
  if (input.sourceDurationMs) {
    return rangeFromEvenSplit(input.sourceDurationMs, segmentIndex, input.segmentCount);
  }
  return undefined;
}

/** 逐镜表估算原片时长（最后一镜的 endMs）；无逐镜表时返回 undefined。 */
export function estimateSourceDurationMs(shots?: DirectionShot[]): number | undefined {
  if (!shots?.length) return undefined;
  const duration = Math.max(...shots.map((shot) => shot.endMs));
  return Number.isFinite(duration) && duration > 0 ? duration : undefined;
}

/** 项目级裁剪缓存键：同一片段跨集、重跑只裁一次。 */
export function trimCacheKey(sourceId: string, startMs: number, endMs: number): string {
  return `${sourceId}|${startMs}|${endMs}`;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** 网络瞬时错误退避重试一次（默认 2 秒）；非网络错误原样抛出。 */
export async function withBackoffRetry<T>(
  fn: () => Promise<T>,
  options?: { delayMs?: number; sleep?: (ms: number) => Promise<void> },
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    await (options?.sleep ?? defaultSleep)(options?.delayMs ?? 2_000);
    return await fn();
  }
}

export type TrimSubmitResult = { ok: true; jobId: string } | { ok: false; error: string };
export type TrimPollResult =
  | { ok: true; status: "queued" | "running" }
  | { ok: true; status: "succeeded"; videoUrl: string }
  | { ok: false; status: "failed"; error: string };

/**
 * 裁剪参考片段：命中缓存直接返回；否则提交裁剪任务并轮询至成功。
 * 任何失败都返回 { ok: false, error }，由调用方降级为不带参考视频提交。
 */
export async function ensureSegmentReferenceClip(input: {
  sourceUrl: string;
  range: SegmentTimeRange;
  /** 项目级缓存中已裁好的片段 URL（trimCacheKey 命中时传入）。 */
  cachedUrl?: string;
  submitTrim: (trim: { url: string; startMs: number; endMs: number }) => Promise<TrimSubmitResult>;
  pollTrim: (jobId: string) => Promise<TrimPollResult>;
  sleep?: (ms: number) => Promise<void>;
  pollIntervalMs?: number;
  maxPolls?: number;
}): Promise<{ ok: true; url: string; fromCache: boolean } | { ok: false; error: string }> {
  if (input.cachedUrl) return { ok: true, url: input.cachedUrl, fromCache: true };
  const sleep = input.sleep ?? defaultSleep;
  const submitted = await input.submitTrim({
    url: input.sourceUrl,
    startMs: input.range.startMs,
    endMs: input.range.endMs,
  });
  if (!submitted.ok) return { ok: false, error: submitted.error };
  const maxPolls = input.maxPolls ?? 90;
  const interval = input.pollIntervalMs ?? 2_000;
  for (let attempt = 0; attempt < maxPolls; attempt++) {
    await sleep(interval);
    const poll = await input.pollTrim(submitted.jobId);
    if (!poll.ok) return { ok: false, error: poll.error };
    if (poll.status === "succeeded") return { ok: true, url: poll.videoUrl, fromCache: false };
  }
  return { ok: false, error: "参考视频裁剪超时：已等待约 3 分钟仍未完成。" };
}
