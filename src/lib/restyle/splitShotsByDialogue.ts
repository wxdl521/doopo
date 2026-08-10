// ====================================================================
// splitShotsByDialogue —— ASR 台词轴驱动的确定性分镜细分（纯函数，可单测）
//
// 背景（r10b 回归）：分镜提取 skill（shot-boundary-extract）对粒度规则的
// 遵循为零——网关 Gemini 原始输出仍是 4×30s 摘要级镜头，prompt 路线证伪，
// 改确定性后处理。位置：mergeUnitsByOffset 拼回整集之后、v1 适配器之前。
//
// 规则：
//   - long_take: true 的镜头尊重模型判断，不切；
//   - >8s 的镜头、或覆盖多句台词的镜头，按 ASR 句子边界确定性切分：
//     · 覆盖 ASR 句子的子段标 shot_role="speaker"，挂该句 dialogue（带说话人）；
//     · 句间空隙/头尾空隙子段：scene_type 为对白场面时标 "reaction"——注意
//       这是**推断**：听者反应是原片常见剪辑，但视觉层无法确认，只作分段与
//       参考裁剪用途的近似；非对白场面标 "action"；
//   - 切分后重排 shot_no（SC001 起）、保持无缝覆盖；<0.5s 的碎段并入相邻段；
//   - 无台词可切的镜头（含 >8s 的纯动作镜头）保持原样——没有台词边界就
//     没有确定性切点，宁可不切也不发明边界。
// ====================================================================

import type { AlignedSentence, MergedShot } from "./analysisMerge";

/** 超过该时长的镜头按台词轴细分（台词密度规则的 shot 时长上限 8s）。 */
export const SPLIT_SHOT_MAX_MS = 8_000;
/** 碎段并入相邻段的下限（时长表最短档 ECU 0.5s）。 */
export const MIN_SPLIT_SEG_MS = 500;

export interface DialogueSplitResult {
  shots: MergedShot[];
  /** 参与拆分的粗镜头数（shots 入参中被切的个数）。 */
  coarseCount: number;
  /** 细分后的总镜头数。 */
  fineCount: number;
}

type SentenceInput = Pick<AlignedSentence, "begin_ms" | "end_ms" | "text" | "speaker">;

/** 读模型的 long_take 标记（UnitShot 宽松透传，未声明在类型上）。 */
function isLongTake(shot: MergedShot): boolean {
  const raw = (shot as Record<string, unknown>).long_take;
  return raw === true || raw === "true";
}

/** 镜头是否是对白场面（scene_type 由视觉通道产出，如「对白场面」）。 */
function isDialogueScene(shot: MergedShot): boolean {
  return typeof shot.scene_type === "string" && shot.scene_type.includes("对白");
}

/** 挂到 speaker 子段的台词文本：带说话人前缀（与 v1 台词格式同款口径）。 */
function sentenceDialogue(sentence: SentenceInput): string {
  const speaker =
    sentence.speaker && sentence.speaker !== "unknown" ? `${sentence.speaker}：` : "";
  return `${speaker}${sentence.text}`;
}

/**
 * 按台词轴细分整集 merged shots。sentences 需为集级毫秒时间码
 * （alignTranscript 的 aligned + orphans 合入即可）。
 */
export function splitShotsByDialogue(
  shots: MergedShot[],
  sentences: SentenceInput[],
): DialogueSplitResult {
  const orderedSentences = [...sentences].sort((a, b) => a.begin_ms - b.begin_ms);
  const out: MergedShot[] = [];
  let coarseCount = 0;

  for (const shot of [...shots].sort((a, b) => a.start_ms - b.start_ms)) {
    const durationMs = shot.end_ms - shot.start_ms;
    const covered = orderedSentences.filter(
      (s) => s.begin_ms < shot.end_ms && s.end_ms > shot.start_ms,
    );
    const needSplit =
      !isLongTake(shot) && (durationMs > SPLIT_SHOT_MAX_MS || covered.length > 1);
    if (!needSplit || covered.length === 0) {
      out.push(shot);
      continue;
    }
    coarseCount += 1;

    // 以句子边界切子段：speaker 段 + 句间/头尾空隙段，链式覆盖 [start_ms, end_ms]
    const dialogueScene = isDialogueScene(shot);
    const rawSegments: Array<{ start: number; end: number; sentence?: SentenceInput }> = [];
    let cursor = shot.start_ms;
    for (const sentence of covered) {
      const segStart = Math.max(cursor, Math.max(shot.start_ms, sentence.begin_ms));
      const segEnd = Math.min(shot.end_ms, sentence.end_ms);
      if (segStart > cursor) rawSegments.push({ start: cursor, end: segStart });
      if (segEnd > segStart) rawSegments.push({ start: segStart, end: segEnd, sentence });
      cursor = Math.max(cursor, segEnd);
    }
    if (cursor < shot.end_ms) rawSegments.push({ start: cursor, end: shot.end_ms });

    // <0.5s 碎段并入相邻段（并入前者优先；首段碎则并入后段）
    const merged: typeof rawSegments = [];
    for (const seg of rawSegments) {
      if (seg.end - seg.start < MIN_SPLIT_SEG_MS && merged.length) {
        merged[merged.length - 1].end = seg.end;
        continue;
      }
      merged.push({ ...seg });
    }
    if (merged.length > 1 && merged[0].end - merged[0].start < MIN_SPLIT_SEG_MS) {
      merged[1].start = merged[0].start;
      merged.shift();
    }

    for (const seg of merged) {
      const base: MergedShot = {
        ...shot,
        start_ms: seg.start,
        end_ms: seg.end,
      };
      if (seg.sentence) {
        out.push({
          ...base,
          shot_role: "speaker",
          dialogue: sentenceDialogue(seg.sentence),
        });
      } else {
        // 空隙段：对白场面推断为听者反应（视觉层无法确认，仅作分段/参考裁剪近似），
        // 非对白场面按动作镜头处理；不挂 dialogue。
        const { dialogue: _dialogue, ...rest } = base;
        out.push({ ...rest, shot_role: dialogueScene ? "reaction" : "action" });
      }
    }
  }

  // 全局重排 shot_no（SC001 起）
  const renumbered = out.map((shot, index) => ({
    ...shot,
    shot_no: `SC${String(index + 1).padStart(3, "0")}`,
  }));
  return { shots: renumbered, coarseCount, fineCount: renumbered.length };
}
