// ====================================================================
// segmentReference —— 转绘分段参考视频裁剪（修复素材库 400：
// 「Duration must be between 1.8s and 30.2s」）。
// 1. resolveSegmentTimeRange：分段时间区间两级推算 —— 模型显式给出 →
//    rangesFromSceneGroups 场景分组（复用 grouping.ts 的场景优先贪心
//    分组，永不在镜头中间切、场景切换处才切段）；不再有按时间均分的
//    兜底，逐镜表缺失时返回 undefined 由调用方安全降级。
//    结果统一夹取到素材库允许的 1.8–30 秒：1.8–30 秒只是参考视频
//    素材入库的限制，场景分段本身不拆，只裁参考视频的代表性区间。
// 2. ensureSegmentReferenceClip：提交裁剪任务并轮询取回片段 URL，
//    命中项目级缓存（sourceId|startMs|endMs）时不重复裁剪。
// 3. withBackoffRetry：网络瞬时错误（Failed to fetch）退避 2 秒重试一次。
// 除标注 async 的函数外均为纯函数，依赖（提交/轮询/睡眠）全部注入，便于测试。
// ====================================================================

import { REFERENCE_VIDEO_MAX_MS, REFERENCE_VIDEO_MIN_MS } from "../videoAssetLibrary";
import type { DirectionShot } from "./cameraDirection";
import { packShotsIntoGroups, type GroupingShot } from "./grouping";
import { segmentIndexFromId } from "./shotSchedule";

export type SegmentTimeRange = { startMs: number; endMs: number };

/**
 * 把区间夹取到通道允许的时长范围（默认素材库 1.8–30 秒）：
 * - 非法区间（非有限数 / 负起点 / 起点不早于终点）返回 undefined；
 * - 超过上限向后截断；不足下限向后补齐。
 */
export function clampSegmentRange(
  startMs: number,
  endMs: number,
  limits?: { minMs?: number; maxMs?: number },
): SegmentTimeRange | undefined {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return undefined;
  const minMs = limits?.minMs ?? REFERENCE_VIDEO_MIN_MS;
  const maxMs = limits?.maxMs ?? REFERENCE_VIDEO_MAX_MS;
  const start = Math.round(startMs);
  let end = Math.round(endMs);
  if (start < 0 || start >= end) return undefined;
  if (end - start > maxMs) end = start + maxMs;
  if (end - start < minMs) end = start + minMs;
  return { startMs: start, endMs: end };
}

/** 场景分组产生的分段参考区间：附带场景名与覆盖镜头范围，供决策日志使用。 */
export type SceneGroupRange = SegmentTimeRange & {
  /** 组内场景名（尾部并入前组导致跨场景时拼接，可为空字符串）。 */
  scene: string;
  /** 组内首镜 / 末镜编号（覆盖镜头范围）。 */
  firstShotNo: string;
  lastShotNo: string;
  /** packShotsIntoGroups 生成的分组理由。 */
  reason: string;
};

/**
 * 按场景把逐镜表分组（复用 grouping.ts 的场景优先贪心分组）：
 * 永不在镜头中间切、同场景连续镜头默认同组、场景切换处才切组、
 * 同场景超过 15s 才二次切分、尾部不足 4s 的余量并入前组。
 * 分段序号 i → 第 i 组首镜 startMs 到末镜 endMs；组超过 30 秒时
 * 分段边界不动，只由 clampSegmentRange 裁出参考视频的代表性区间。
 * segmentCount 仅作入参校验；组数与分段数不一致时由调用方按序号取舍。
 */
export function rangesFromSceneGroups(
  shots: DirectionShot[],
  segmentCount: number,
  limits?: { minMs?: number; maxMs?: number },
): SceneGroupRange[] {
  if (!shots.length || segmentCount < 1) return [];
  // DirectionShot.scene → GroupingShot.sceneType；id 带序号防 shotNo 重复。
  const packInput: GroupingShot[] = shots.map((shot, index) => ({
    id: `${shot.shotNo}#${index}`,
    shotNo: shot.shotNo,
    startMs: shot.startMs,
    endMs: shot.endMs,
    sceneType: shot.scene,
  }));
  const { groups } = packShotsIntoGroups(packInput);
  const shotById = new Map(packInput.map((shot) => [shot.id, shot]));
  const ranges: SceneGroupRange[] = [];
  for (const group of groups) {
    const groupShots = group.shotIds
      .map((id) => shotById.get(id))
      .filter((shot): shot is GroupingShot => !!shot);
    if (!groupShots.length) continue;
    const range = clampSegmentRange(groupShots[0]!.startMs, groupShots[groupShots.length - 1]!.endMs, limits);
    if (!range) continue;
    const scenes = [
      ...new Set(groupShots.map((shot) => (shot.sceneType ?? "").trim()).filter(Boolean)),
    ];
    ranges.push({
      ...range,
      scene: scenes.join(" / "),
      firstShotNo: groupShots[0]!.shotNo,
      lastShotNo: groupShots[groupShots.length - 1]!.shotNo,
      reason: group.reason,
    });
  }
  return ranges;
}

/**
 * 分段时间区间两级推算（分段以场景为第一依据，时长只作约束）：
 * 1. 模型显式给出的 startMs/endMs（校验 + 夹取）；
 * 2. rangesFromSceneGroups 场景分组，取分段序号对应的组。
 * 逐镜表缺失、无法判定场景时返回 undefined，由调用方降级为不带参考视频，
 * 不再按时间均分猜测分段边界。
 */
export function resolveSegmentTimeRange(input: {
  segmentId?: string;
  explicit?: { startMs?: number; endMs?: number };
  shots?: DirectionShot[];
  segmentCount: number;
  limits?: { minMs?: number; maxMs?: number };
}): SegmentTimeRange | undefined {
  const segmentIndex = segmentIndexFromId(input.segmentId);
  const explicit = input.explicit;
  if (explicit && typeof explicit.startMs === "number" && typeof explicit.endMs === "number") {
    const range = clampSegmentRange(explicit.startMs, explicit.endMs, input.limits);
    if (range) return range;
  }
  if (segmentIndex === undefined) return undefined;
  const group = rangesFromSceneGroups(input.shots ?? [], input.segmentCount, input.limits)[segmentIndex];
  return group ? { startMs: group.startMs, endMs: group.endMs } : undefined;
}

/** 逐镜表估算原片时长（最后一镜的 endMs）；无逐镜表时返回 undefined。 */
export function estimateSourceDurationMs(shots?: DirectionShot[]): number | undefined {
  if (!shots?.length) return undefined;
  const duration = Math.max(...shots.map((shot) => shot.endMs));
  return Number.isFinite(duration) && duration > 0 ? duration : undefined;
}

/** 项目级裁剪缓存键：同一片段跨集、重跑只裁一次。
 *  v2 版本前缀（2026-08）：此前转码服务流复制 bug 产出的旧缓存片段,
 *  其元数据（nb_frames/时长字段）不可信（实测 282 vs 277 帧）——上游 r2v
 *  时长校验按元数据判定,旧片段会一直误判 400。版本化让 2026-08-16 前的
 *  旧片段全部失效重裁;服务侧修复后的新产物才进缓存。 */
export function trimCacheKey(sourceId: string, startMs: number, endMs: number): string {
  return `v2|${sourceId}|${startMs}|${endMs}`;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * 手动覆盖片段查询（2026-08 转码产物损坏绕行）：项目数据里人工修好的
 * 片段 URL（manualReferenceClips,键同 trimCacheKey）优先于自动裁剪缓存
 * 使用——命中即直接用,不触发重裁、不回写缓存。
 */
export function manualReferenceClipUrl(
  manualClips: Record<string, string> | undefined,
  cacheKey: string,
): string | undefined {
  const url = manualClips?.[cacheKey];
  return url && /^https?:\/\//i.test(url) ? url : undefined;
}

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
  /** 产物元数据自检（2026/08 转码流复制 bug 第二层加固;缺省不校验,行为同旧版） */
  verifyClip?: (url: string) => Promise<{ ok: boolean; error?: string }>;
  sleep?: (ms: number) => Promise<void>;
  pollIntervalMs?: number;
  maxPolls?: number;
}): Promise<{ ok: true; url: string; fromCache: boolean } | { ok: false; error: string }> {
  if (input.cachedUrl) return { ok: true, url: input.cachedUrl, fromCache: true };
  const sleep = input.sleep ?? defaultSleep;
  // 元数据异常时自动重裁一次:round 0 = 首次,round 1 = 重裁。
  // 坏片段不进缓存（调用方只在 ok 时写 trimCacheMap;v2 前缀隔离见 trimCacheKey）。
  for (let round = 0; round < 2; round += 1) {
    const submitted = await input.submitTrim({
      url: input.sourceUrl,
      startMs: input.range.startMs,
      endMs: input.range.endMs,
    });
    if (!submitted.ok) return { ok: false, error: submitted.error };
    const maxPolls = input.maxPolls ?? 90;
    const interval = input.pollIntervalMs ?? 2_000;
    let retryWithNewJob = false;
    for (let attempt = 0; attempt < maxPolls; attempt += 1) {
      await sleep(interval);
      const poll = await input.pollTrim(submitted.jobId);
      if (!poll.ok) return { ok: false, error: poll.error };
      if (poll.status !== "succeeded") continue;
      if (!input.verifyClip) return { ok: true, url: poll.videoUrl, fromCache: false };
      const verdict = await input.verifyClip(poll.videoUrl);
      if (verdict.ok) return { ok: true, url: poll.videoUrl, fromCache: false };
      if (round === 0) {
        // 首次产物元数据不一致:换新 job 重裁一次
        retryWithNewJob = true;
        break;
      }
      return {
        ok: false,
        error: verdict.error ?? "裁剪产物元数据异常，请稍后重试或联系转码服务",
      };
    }
    if (!retryWithNewJob) {
      return { ok: false, error: "参考视频裁剪超时：已等待约 3 分钟仍未完成。" };
    }
  }
  return { ok: false, error: "参考视频裁剪超时：已等待约 3 分钟仍未完成。" };
}
