// ====================================================================
// shotSchedule —— 转绘「导演镜头调度机制」第二阶段：逐镜数据底座
// 1. parseShotSchedule：分析层产出的轻量逐镜表做契约清洗（枚举归一、
//    startMs<endMs、按 startMs 排序），供 normalizeResult 与本地持久化复用。
// 2. withSegmentDirection：渲染提交前按分段就近匹配镜头，把 buildDirectionBlock
//    调度块拼到分段提示词前面；无逐镜表时原样返回（跳过注入）。
// 纯函数、零依赖（仅引用 cameraDirection 类型与调度块组装）。
// ====================================================================

import {
  buildDirectionBlock,
  type DirectionShot,
  type Market,
  type ShotType,
} from "./cameraDirection";

/** 调度层景别六档枚举（与 cameraDirection.ShotType 对齐，用于非法值过滤）。 */
const SHOT_TYPES: ReadonlySet<string> = new Set<ShotType>([
  "特写",
  "大特写",
  "近景",
  "中景",
  "全景",
  "远景",
]);

const MAX_SHOTS = 200;

/**
 * 清洗模型产出 / 本地持久化的逐镜表：
 * - shotType 必须是六档枚举，非法项整条丢弃；
 * - emotion 归一为字符串（DirectionShot 允许任意字符串，未识别值由
 *   resolveCameraMovement 兜底），非字符串归一为 ""；
 * - startMs/endMs 必须是非负有限数且 startMs < endMs；
 * - 按 startMs 升序排序；无有效镜头时返回 undefined（调用方省略该字段）。
 */
export function parseShotSchedule(value: unknown): DirectionShot[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const shots: DirectionShot[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Partial<Record<keyof DirectionShot, unknown>>;
    const startMs = typeof item.startMs === "number" ? item.startMs : NaN;
    const endMs = typeof item.endMs === "number" ? item.endMs : NaN;
    if (
      !Number.isFinite(startMs) ||
      !Number.isFinite(endMs) ||
      startMs < 0 ||
      startMs >= endMs
    ) {
      continue;
    }
    if (typeof item.shotType !== "string" || !SHOT_TYPES.has(item.shotType)) continue;
    shots.push({
      shotNo:
        typeof item.shotNo === "string" && item.shotNo.trim()
          ? item.shotNo.trim()
          : `SC${String(shots.length + 1).padStart(3, "0")}`,
      startMs,
      endMs,
      scene: typeof item.scene === "string" ? item.scene : "",
      shotType: item.shotType as ShotType,
      emotion: typeof item.emotion === "string" ? item.emotion.trim() : "",
      action: typeof item.action === "string" ? item.action : undefined,
      dialogue: typeof item.dialogue === "string" ? item.dialogue : undefined,
    });
    if (shots.length >= MAX_SHOTS) break;
  }
  if (!shots.length) return undefined;
  shots.sort((a, b) => a.startMs - b.startMs);
  return shots;
}

/** 分段 id（U01 / U12）→ 分段序号（0 起）；无法解析时返回 undefined。 */
export function segmentIndexFromId(segmentId: string | undefined): number | undefined {
  if (!segmentId) return undefined;
  const match = /^U(\d{1,3})$/i.exec(segmentId.trim());
  if (!match) return undefined;
  const index = Number(match[1]) - 1;
  return Number.isInteger(index) && index >= 0 ? index : undefined;
}

/** 方案契约里每段不超过 15 秒，分段时间窗按此时长估算。 */
export const DEFAULT_SEGMENT_DURATION_MS = 15_000;

export interface SegmentShotMatch {
  shot: DirectionShot;
  /** 同一逐镜表中排在匹配镜头之前的一镜；首镜为 undefined。 */
  prevShot?: DirectionShot;
}

/**
 * 分段 ↔ 逐镜表就近匹配：先取与分段估算时间窗重叠最多的镜头；
 * 完全没有重叠时退化为按时间中点距离最近的镜头。
 */
export function matchShotForSegment(
  shots: DirectionShot[],
  segmentIndex: number,
  segmentDurationMs: number = DEFAULT_SEGMENT_DURATION_MS,
): SegmentShotMatch | undefined {
  if (!shots.length || segmentIndex < 0) return undefined;
  const windowStart = segmentIndex * segmentDurationMs;
  const windowEnd = windowStart + segmentDurationMs;
  const windowMid = (windowStart + windowEnd) / 2;

  let bestIndex = -1;
  let bestOverlap = 0;
  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;
  shots.forEach((shot, index) => {
    const overlap = Math.min(windowEnd, shot.endMs) - Math.max(windowStart, shot.startMs);
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      bestIndex = index;
    }
    const distance = Math.abs((shot.startMs + shot.endMs) / 2 - windowMid);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  });

  const index = bestIndex >= 0 ? bestIndex : nearestIndex;
  return { shot: shots[index], prevShot: index > 0 ? shots[index - 1] : undefined };
}

export interface SegmentDirectionOptions {
  shots?: DirectionShot[];
  segmentId?: string;
  market: Market;
  segmentDurationMs?: number;
  /** 当前着装状态描述（软引导，透传给调度块【服装引导】段）。 */
  clothingState?: string;
  /** 测试可注入的调度块组装实现，默认 cameraDirection.buildDirectionBlock。 */
  buildBlock?: typeof buildDirectionBlock;
}

/**
 * 渲染提交前的提示词注入：有逐镜表且分段能匹配到镜头时，
 * 把【运镜调度】/【转场指令】/【光线语言】（/【服装引导】）调度块拼到
 * 原分段提示词前面；否则原样返回，不注入。
 */
export function withSegmentDirection(
  prompt: string,
  options: SegmentDirectionOptions,
): string {
  const { shots, segmentId, market, segmentDurationMs, clothingState } = options;
  if (!shots?.length) return prompt;
  const segmentIndex = segmentIndexFromId(segmentId);
  if (segmentIndex === undefined) return prompt;
  const match = matchShotForSegment(shots, segmentIndex, segmentDurationMs);
  if (!match) return prompt;
  const block = (options.buildBlock ?? buildDirectionBlock)({
    shot: match.shot,
    prevShot: match.prevShot,
    market,
    clothingState,
  });
  return `${block}\n${prompt}`;
}
