// ====================================================================
// ensureFullCoverage —— 转绘方案生成的全片覆盖兜底（纯函数，可单测）
//
// 导演模型产出的分段可能不连续覆盖原片（长片只覆盖前 60s 的线上事故根因
// 之一）。本模块在 generateRestylePlan 解析后做确定性修正：
//   1. 越界段夹取到 [0, durationMs]；
//   2. 重叠段后段起点夹到前段终点，修正后时长 <= 0 的段移除；
//   3. 覆盖缺口（含首部/中段/尾部）用 packShotsIntoGroups（grouping.ts，
//      镜头边界优先、≤15s 硬约束）对落在缺口的镜头确定性补段，prompt 用
//      该区间镜头摘要模板生成；缺口内无镜头时按 15s 上限直接切补；
//   4. 结构有改动时按时间轴重排段号（U01 起），保证 segmentIndexFromId
//      的序号与时间顺序一致。
// durationMs 由调用方按集解析（客户端透传的 durationSec 优先，逐镜表估算
// 兜底）；拿不到权威时长的集原样返回，不做猜测性修正。
// ====================================================================

import type { DirectionShot } from "./cameraDirection";
import { packShotsIntoGroups, type GroupingShot } from "./grouping";
import { formatShotLine, formatShotTime } from "./v1AnalysisAdapter";

/** 方案契约：单段不超过 15 秒（与 prompt 硬要求一致）。 */
export const MAX_COVERAGE_SEGMENT_MS = 15_000;

/** 参与覆盖校验的最小分段字段集（RestylePlanEpisode.segments 的子集）。 */
export interface CoverageSegment {
  id: string;
  prompt: string;
  startMs?: number;
  endMs?: number;
}

export interface CoverageEpisode {
  episode: string;
  segments: CoverageSegment[];
}

type RangedSegment = CoverageSegment & { startMs: number; endMs: number };

const isRanged = (segment: CoverageSegment): segment is RangedSegment =>
  typeof segment.startMs === "number" &&
  typeof segment.endMs === "number" &&
  Number.isFinite(segment.startMs) &&
  Number.isFinite(segment.endMs) &&
  segment.startMs < segment.endMs;

/**
 * 校验并修正每集分段对 [0, durationMs] 的覆盖。
 * resolveDurationMs 缺省或返回无效值时该集原样返回；warnings 随结果返回，
 * 供客户端在方案播报中提示「已自动补齐 N 个未覆盖区间」。
 */
export function ensureFullCoverage<T extends CoverageEpisode>(
  episodes: T[],
  shots: DirectionShot[],
  resolveDurationMs?: (episodeId: string) => number | undefined,
): { episodes: T[]; warnings: string[] } {
  const warnings: string[] = [];
  const out = episodes.map((episode) => {
    const durationMs = resolveDurationMs?.(episode.episode);
    if (!durationMs || !Number.isFinite(durationMs) || durationMs <= 0) return episode;
    return ensureEpisodeCoverage(episode, shots, Math.round(durationMs), warnings);
  });
  return { episodes: out, warnings };
}

function ensureEpisodeCoverage<T extends CoverageEpisode>(
  episode: T,
  shots: DirectionShot[],
  durationMs: number,
  warnings: string[],
): T {
  const unranged = episode.segments.filter((segment) => !isRanged(segment));
  const ranged = episode.segments
    .filter(isRanged)
    .map((segment) => ({ ...segment }))
    .sort((a, b) => a.startMs - b.startMs);
  // 没有任何带有效区间的分段时无法校验覆盖，原样返回（不发明分段）
  if (!ranged.length) return episode;

  let changed = false;
  const tag = `「${episode.episode}」`;

  // 1. 越界夹取到 [0, durationMs]
  for (const segment of ranged) {
    const startMs = Math.max(0, Math.min(segment.startMs, durationMs));
    const endMs = Math.max(0, Math.min(segment.endMs, durationMs));
    if (startMs !== segment.startMs || endMs !== segment.endMs) {
      changed = true;
      warnings.push(`${tag}分段 ${segment.id} 超出 [0, ${durationMs}]，已夹取到边界。`);
      segment.startMs = startMs;
      segment.endMs = endMs;
    }
  }

  // 2. 重叠修正：后段起点夹到前段终点；修正后时长 <= 0 的段移除
  const fixed: RangedSegment[] = [];
  for (const segment of ranged) {
    const prev = fixed[fixed.length - 1];
    if (prev && segment.startMs < prev.endMs) {
      changed = true;
      warnings.push(
        `${tag}分段 ${segment.id} 与前段重叠 ${prev.endMs - segment.startMs}ms，已夹到相邻边界。`,
      );
      segment.startMs = prev.endMs;
    }
    if (segment.endMs <= segment.startMs) {
      changed = true;
      warnings.push(`${tag}分段 ${segment.id} 修正后时长 <= 0，已移除。`);
      continue;
    }
    fixed.push(segment);
  }
  if (!fixed.length) return episode;

  // 3. 缺口检测：首部 / 中段 / 尾部
  const gaps: Array<{ startMs: number; endMs: number }> = [];
  if (fixed[0].startMs > 0) gaps.push({ startMs: 0, endMs: fixed[0].startMs });
  for (let i = 0; i + 1 < fixed.length; i += 1) {
    if (fixed[i + 1].startMs > fixed[i].endMs) {
      gaps.push({ startMs: fixed[i].endMs, endMs: fixed[i + 1].startMs });
    }
  }
  const last = fixed[fixed.length - 1];
  if (last.endMs < durationMs) gaps.push({ startMs: last.endMs, endMs: durationMs });

  const fillers: RangedSegment[] = [];
  for (const gap of gaps) {
    const built = buildGapFillers(gap, shots, episode.episode, warnings);
    if (!built.length) continue;
    changed = true;
    fillers.push(...built);
    warnings.push(
      `${tag}已自动补齐未覆盖区间 ${formatShotTime(gap.startMs)}-${formatShotTime(gap.endMs)}（${built.length} 段）。`,
    );
  }

  if (!changed) return episode;

  // 4. 结构有改动：按时间轴重排段号（U01 起），无区间段排在带区间段之后
  const merged = [...fixed, ...fillers].sort((a, b) => a.startMs - b.startMs);
  const segments: CoverageSegment[] = merged.map((segment, index) => ({
    ...segment,
    id: `U${String(index + 1).padStart(2, "0")}`,
  }));
  return { ...episode, segments: [...segments, ...unranged] };
}

/**
 * 缺口补段：落在缺口内的镜头按 packShotsIntoGroups 贪心打包（镜头边界优先、
 * 单组 ≤15s、minSec 降为 1s 以适应小缺口）；补段首尾与内外段边界拉齐，
 * 段间因镜头不连续产生的小缺口并入前段，保证补段链式连续覆盖整个缺口。
 */
function buildGapFillers(
  gap: { startMs: number; endMs: number },
  shots: DirectionShot[],
  episodeId: string,
  warnings: string[],
): RangedSegment[] {
  const tag = `「${episodeId}」`;
  const gapShots = shots
    .map((shot, index) => ({ shot, index }))
    .filter(({ shot }) => shot.startMs < gap.endMs && shot.endMs > gap.startMs)
    .map(({ shot, index }) => ({
      id: `${shot.shotNo}#${index}`,
      shotNo: shot.shotNo,
      // 镜头区间夹取到缺口内，分组时长按缺口覆盖部分复算
      startMs: Math.max(shot.startMs, gap.startMs),
      endMs: Math.min(shot.endMs, gap.endMs),
      sceneType: shot.scene,
      raw: shot,
    }));

  // 缺口内没有任何镜头：按 15s 上限直接切补，文案不含镜头摘要
  if (!gapShots.length) {
    warnings.push(
      `${tag}区间 ${formatShotTime(gap.startMs)}-${formatShotTime(gap.endMs)} 无对应镜头，已按 ${MAX_COVERAGE_SEGMENT_MS / 1000}s 上限直接补段。`,
    );
    return splitRangeEvenly(gap.startMs, gap.endMs).map(([startMs, endMs]) => ({
      id: "",
      prompt:
        `保持原片剧情、动作、站位与音频节奏，结合已确认资产完成转绘` +
        `（自动补齐的未覆盖区间 ${formatShotTime(startMs)}-${formatShotTime(endMs)}）。`,
      startMs,
      endMs,
    }));
  }

  const packInput: GroupingShot[] = gapShots.map(({ raw: _raw, ...shot }) => shot);
  const { groups, warnings: packWarnings } = packShotsIntoGroups(packInput, {
    minSec: 1,
    maxSec: MAX_COVERAGE_SEGMENT_MS / 1000,
  });
  warnings.push(...packWarnings.map((warning) => `${tag}${warning}`));

  const byId = new Map(gapShots.map((shot) => [shot.id, shot]));
  const segments: RangedSegment[] = groups
    .map((group) => {
      const groupShots = group.shotIds
        .map((id) => byId.get(id))
        .filter((shot): shot is NonNullable<typeof shot> => Boolean(shot))
        .sort((a, b) => a.startMs - b.startMs);
      if (!groupShots.length) return null;
      const startMs = groupShots[0].startMs;
      const endMs = groupShots[groupShots.length - 1].endMs;
      return {
        id: "",
        prompt:
          `保持原片该区间的剧情、动作、站位与音频节奏完成转绘` +
          `（自动补齐的未覆盖区间 ${formatShotTime(startMs)}-${formatShotTime(endMs)}）。\n` +
          `覆盖镜头：\n${groupShots.map((shot) => formatShotLine(shot.raw)).join("\n")}`,
        startMs,
        endMs,
      };
    })
    .filter((segment): segment is RangedSegment => Boolean(segment))
    .sort((a, b) => a.startMs - b.startMs);

  if (!segments.length) return [];
  // 边界拉齐：首段起点=缺口起点、末段终点=缺口终点、段间小缺口并入前段
  segments[0].startMs = gap.startMs;
  segments[segments.length - 1].endMs = gap.endMs;
  for (let i = 0; i + 1 < segments.length; i += 1) {
    if (segments[i].endMs < segments[i + 1].startMs) {
      segments[i].endMs = segments[i + 1].startMs;
    }
  }
  return segments;
}

/** 把 [startMs, endMs) 均切成 ≤ MAX_COVERAGE_SEGMENT_MS 的连续子区间。 */
function splitRangeEvenly(startMs: number, endMs: number): Array<[number, number]> {
  const count = Math.max(1, Math.ceil((endMs - startMs) / MAX_COVERAGE_SEGMENT_MS));
  const step = (endMs - startMs) / count;
  const ranges: Array<[number, number]> = [];
  for (let i = 0; i < count; i += 1) {
    ranges.push([
      Math.round(startMs + i * step),
      i === count - 1 ? endMs : Math.round(startMs + (i + 1) * step),
    ]);
  }
  return ranges;
}
