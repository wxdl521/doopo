// ====================================================================
// restyleInserts —— 转绘「智能补镜」执行链（P2）纯函数内核
// 需求来源：《镜头调度机制-20260804》第五节 + 《光线调度机制调整-20260804》
// 第四节弹性规则。
// - planInsertJobs：由 cameraDirection.findInsertShots 的触发点产出补镜作业
//   （A 类情绪高点补特写 0.5s / B 类场景转换补空镜 1s），取消轴线检测，
//   角色面部与服装风格 Tag 软引导不强锁；A 类光照强度短暂提升 20%
//   （contrastRatio 数值上调 + prompt 写入「背景光晕增强 20%」）。
// - mergeInsertClips：按锚点分段把补镜片段并入成片拼接序列，原片镜头数
//   与剪辑点不变，补镜只插入。
// - runInsertJobs：补镜执行编排（静帧 → 首帧模式短视频），生图/视频通道
//   全部以依赖注入，单条失败降级跳过不抛错，不影响主片。
// ====================================================================

import {
  findInsertShots,
  formatLightingParams,
  LIGHTING_PRESETS,
  resolveCameraMovement,
  resolveLighting,
  type DirectionShot,
  type LightingParams,
  type Market,
} from "../../lib/restyle/cameraDirection";
import { DEFAULT_SEGMENT_DURATION_MS } from "../../lib/restyle/shotSchedule";

export type InsertKind = "closeup" | "establishing";

/** 情绪高潮补镜光照强度短暂提升幅度（《光线调度机制调整》第四节弹性规则）。 */
export const INSERT_LIGHTING_BOOST_RATIO = 1.2;

/** 补镜静帧转视频的提交时长下限（视频模型档期最小值 1s，0.5s 特写按 1s 提交）。 */
export const INSERT_VIDEO_MIN_DURATION_SEC = 1;

export interface InsertJob {
  kind: InsertKind;
  /** 锚点镜头号：A 类插在该镜之后，B 类插在该镜（新场景首镜）之前。 */
  anchorShotNo: string;
  position: "after" | "before";
  /** 插入锚点时间戳（原片时间轴，毫秒）。 */
  insertAtMs: number;
  /** 锚点落入的分段 id（按 15s 分段窗换算），拼接合并时按它对位。 */
  anchorSegmentId: string;
  durationSec: 0.5 | 1;
  prompt: string;
  /** A 类为 true：情绪高潮破格，光照强度短暂提升 20%。 */
  boostLighting: boolean;
  /** A 类附带同场角色资产参考图（面部锚定 + 服装风格 Tag 软引导）。 */
  referenceImages: string[];
}

/** 时间戳 → 分段 id（与 shotSchedule 的 15s 分段窗同一口径）。 */
export function segmentIdAtMs(ms: number): string {
  const index = Math.max(0, Math.floor(ms / DEFAULT_SEGMENT_DURATION_MS));
  return `U${String(index + 1).padStart(2, "0")}`;
}

const cloneParams = (params: LightingParams): LightingParams => ({
  ...params,
  palette: { ...params.palette },
});

/** 情绪高潮破格：光比数值上调 20%，高光描述写入「背景光晕增强 20%」。 */
export function boostLightingParams(params: LightingParams): LightingParams {
  const boosted = cloneParams(params);
  boosted.contrastRatio = Math.round(params.contrastRatio * INSERT_LIGHTING_BOOST_RATIO);
  boosted.palette.highlights = `${params.palette.highlights}，背景光晕增强 20%`;
  return boosted;
}

export interface PlanInsertJobsInput {
  shots?: DirectionShot[];
  smartInsert?: boolean;
  market: Market;
  /** 用户确认的目标画风，补镜与主片同一风格口径。 */
  styleBrief?: string;
  /** 当前着装状态描述（软引导，不锁定服装编号）。 */
  clothingState?: string;
  /** 同场角色资产图 URL（A 类面部锚定参考，最多取前 4 张）。 */
  characterReferenceImages?: string[];
}

function buildCloseupPrompt(input: {
  shot: DirectionShot;
  market: Market;
  styleBrief?: string;
  clothingState?: string;
}): string {
  const { shot, market, styleBrief, clothingState } = input;
  const preset = LIGHTING_PRESETS[market];
  // 补镜景别强制升级为大特写；运镜沿用情绪映射（特写不走环绕/摇晃，无眩晕风险）。
  const cam = resolveCameraMovement({ emotion: shot.emotion, shotType: "大特写" });
  const lighting = resolveLighting({ preset, emotion: shot.emotion });
  const boosted = boostLightingParams(lighting.params);

  const sections: string[] = [];
  sections.push(
    "【补镜指令】情绪高点补特写：目标风格大特写，插入在原片该镜之后，停留 0.5 秒；" +
      "仅做增强转绘，不改变原片镜头数量、时长与剪辑点",
  );
  if (styleBrief) sections.push(`【目标风格】${styleBrief}`);
  const movementParts = [`情绪「${shot.emotion}」→ ${cam.movement}`, "景别：大特写"];
  if (cam.note) movementParts.push(cam.note);
  sections.push(`【运镜调度】${movementParts.join("；")}`);
  // 取消轴线检测：特写无轴线负担，固定为连续插入。
  sections.push("【转场指令】连续插入：补镜不做轴线冲突检测，特写属无轴线负担画面");
  sections.push(
    `【光线语言】${formatLightingParams(boosted)}；` +
      "情绪高潮破格：光照强度短暂提升 20%，背景光晕增强 20%",
  );
  sections.push(
    "【服装引导】角色仅锚定面部特征与体型骨架；当前着装：" +
      (clothingState ?? "沿用同场角色的服装风格 Tag") +
      "；允许模型随光影与动作自然调整衣物质感，不锁定服装编号",
  );
  sections.push(
    "【面部锚定】以参考图中的同场角色面部为准，复用面部特征与服装风格 Tag，" +
      "细节由转绘模型自由发挥，不做强锁",
  );
  if (shot.action) sections.push(`【画面内容】${shot.action}`);
  return sections.join("\n");
}

function buildEstablishingPrompt(input: {
  prevShot: DirectionShot;
  shot: DirectionShot;
  market: Market;
  styleBrief?: string;
}): string {
  const { prevShot, shot, market, styleBrief } = input;
  const preset = LIGHTING_PRESETS[market];
  // 空镜取新场景首镜的情绪做光照解算（不触发 +20% 破格，破格仅限情绪高潮特写）。
  const lighting = resolveLighting({ preset, emotion: shot.emotion });

  const sections: string[] = [];
  sections.push(
    `【补镜指令】场景转换补空镜：插入在场景「${prevShot.scene}」与「${shot.scene}」之间，` +
      "1 秒过渡，画面无任何人物；仅做环境交代，不改变原片镜头数量、时长与剪辑点",
  );
  if (styleBrief) sections.push(`【目标风格】${styleBrief}`);
  sections.push(
    `【场景主体】下一场景「${shot.scene}」的背景主体空镜（建筑外观、街景、招牌、门口环境等），` +
      "无人出镜，纯环境交代",
  );
  sections.push("【转场指令】连续插入：补镜不做轴线冲突检测，空镜属中立画面");
  sections.push(`【光线语言】${formatLightingParams(lighting.params)}`);
  if (shot.action) sections.push(`【环境参考】${shot.action}`);
  return sections.join("\n");
}

/**
 * 由逐镜表产出补镜作业列表。smartInsert 关闭或无逐镜表时返回空（保守转绘，
 * 严格遵循原片镜头数量、时长与剪辑点，绝不新增镜头）。
 */
export function planInsertJobs(input: PlanInsertJobsInput): InsertJob[] {
  const { shots, smartInsert, market, styleBrief, clothingState } = input;
  if (!smartInsert || !shots?.length) return [];
  const triggers = findInsertShots(shots);
  if (!triggers.length) return [];
  const characterRefs = (input.characterReferenceImages ?? []).slice(0, 4);

  const jobs: InsertJob[] = [];
  for (const trigger of triggers) {
    if (trigger.kind === "closeup") {
      const shot = shots.find((item) => item.shotNo === trigger.afterShotNo);
      if (!shot) continue;
      // 锚点取该镜最后一瞬（endMs - 1ms），避免恰好落在分段边界时错位到下一段。
      const insertAtMs = Math.max(shot.startMs, shot.endMs - 1);
      jobs.push({
        kind: "closeup",
        anchorShotNo: shot.shotNo,
        position: "after",
        insertAtMs,
        anchorSegmentId: segmentIdAtMs(insertAtMs),
        durationSec: trigger.insertDurationSec,
        prompt: buildCloseupPrompt({ shot, market, styleBrief, clothingState }),
        boostLighting: true,
        referenceImages: characterRefs,
      });
    } else {
      const index = shots.findIndex((item) => item.shotNo === trigger.beforeShotNo);
      if (index <= 0) continue;
      const shot = shots[index];
      const prevShot = shots[index - 1];
      const insertAtMs = shot.startMs;
      jobs.push({
        kind: "establishing",
        anchorShotNo: shot.shotNo,
        position: "before",
        insertAtMs,
        anchorSegmentId: segmentIdAtMs(insertAtMs),
        durationSec: trigger.insertDurationSec,
        prompt: buildEstablishingPrompt({ prevShot, shot, market, styleBrief }),
        boostLighting: false,
        referenceImages: [],
      });
    }
  }
  return jobs;
}

// --------------------------------------------------------------------
// 拼接合并：补镜只插入，原片序列不变
// --------------------------------------------------------------------

export interface AnchoredInsert<T> {
  item: T;
  /** 锚点分段 id（补镜作业上的 anchorSegmentId）。 */
  anchorSegmentId: string;
  position: "after" | "before";
}

/**
 * 把补镜片段按锚点分段并入成片拼接序列：
 * - 原片分段的相对顺序严格不变（过滤掉补镜后等于原序列）；
 * - 同一锚点的多条补镜按传入顺序依此插入；
 * - 锚点分段不存在（如该分段渲染失败）时该补镜直接丢弃，由调用方按
 *   返回长度差记日志，绝不改变原片剪辑点去迁就补镜。
 */
export function mergeInsertClips<T extends { segmentId?: string }>(
  baseClips: readonly T[],
  insertClips: readonly AnchoredInsert<T>[],
): T[] {
  if (!insertClips.length) return [...baseClips];
  const before = new Map<string, T[]>();
  const after = new Map<string, T[]>();
  for (const insert of insertClips) {
    const bucket = insert.position === "before" ? before : after;
    const list = bucket.get(insert.anchorSegmentId) ?? [];
    list.push(insert.item);
    bucket.set(insert.anchorSegmentId, list);
  }
  const merged: T[] = [];
  for (const clip of baseClips) {
    const segmentId = clip.segmentId ?? "";
    for (const item of before.get(segmentId) ?? []) merged.push(item);
    merged.push(clip);
    for (const item of after.get(segmentId) ?? []) merged.push(item);
  }
  return merged;
}

// --------------------------------------------------------------------
// 执行编排：静帧 → 首帧模式短视频；单条失败降级跳过，不影响主片
// --------------------------------------------------------------------

export interface InsertClipResult {
  kind: InsertKind;
  anchorSegmentId: string;
  position: "after" | "before";
  durationSec: number;
  url: string;
}

export interface InsertRunnerDeps {
  /** 文生图通道（seedream 系 generateImage）。 */
  generateImage(input: { prompt: string }): Promise<{ url?: string; error?: string | null }>;
  /** 参考图生图通道（generateImageWithReferences），A 类角色面部锚定专用。 */
  generateImageWithReferences(input: {
    prompt: string;
    referenceImages: string[];
  }): Promise<{ url?: string; error?: string | null }>;
  /** 静帧 → 短视频（首帧模式，duration 取档内最小值），返回可拼接的视频 URL。 */
  stillToVideo(input: {
    job: InsertJob;
    stillUrl: string;
    durationSec: number;
  }): Promise<{ ok: boolean; url?: string; error?: string }>;
  onJobStart?(job: InsertJob): void;
  onJobDone?(job: InsertJob): void;
  onJobSkipped?(job: InsertJob, reason: string): void;
  isAborted?(): boolean;
}

/**
 * 逐条执行补镜作业：A 类带角色参考图走 I2I，B 类文生图空镜；
 * 静帧成功后转首帧模式短视频。任何一步失败（含异常）都只记跳过原因，
 * 继续后续作业，绝不向上抛错影响主片拼接。
 */
export async function runInsertJobs(
  jobs: InsertJob[],
  deps: InsertRunnerDeps,
): Promise<InsertClipResult[]> {
  const results: InsertClipResult[] = [];
  for (const job of jobs) {
    if (deps.isAborted?.()) break;
    deps.onJobStart?.(job);
    try {
      const still = job.referenceImages.length
        ? await deps.generateImageWithReferences({
            prompt: job.prompt,
            referenceImages: job.referenceImages,
          })
        : await deps.generateImage({ prompt: job.prompt });
      if (!still.url) {
        deps.onJobSkipped?.(job, still.error || "补镜静帧生成失败");
        continue;
      }
      if (deps.isAborted?.()) break;
      const video = await deps.stillToVideo({
        job,
        stillUrl: still.url,
        durationSec: Math.max(INSERT_VIDEO_MIN_DURATION_SEC, Math.round(job.durationSec)),
      });
      if (!video.ok || !video.url) {
        deps.onJobSkipped?.(job, video.error || "补镜短视频生成失败");
        continue;
      }
      results.push({
        kind: job.kind,
        anchorSegmentId: job.anchorSegmentId,
        position: job.position,
        durationSec: job.durationSec,
        url: video.url,
      });
      deps.onJobDone?.(job);
    } catch (error) {
      deps.onJobSkipped?.(job, error instanceof Error ? error.message : "补镜执行异常");
    }
  }
  return results;
}
