// ====================================================================
// analysisMerge —— 转绘 v2 阶段一：分析单元切片 / 按偏移拼回 / 台词对齐
//
// 纯函数模块，不依赖网络与 Supabase，可直接进 Vitest。
// 口径参考竞品样本（Downloads/样本/视频分析）：
//   - 分析单元 ≠ 集，单元内时间码一律为单元相对毫秒，拼回时加
//     unitStartOffsetSec * 1000 的偏移。
//   - ASR 逐句按「时间区间中点」归属 shot，无归属的进 orphans。
// ====================================================================

/** 视频切片单元。unitStartOffsetSec 为集内偏移，sourceStartSeconds 为源文件内偏移。 */
export interface AnalysisUnit {
  unitId: string;
  unitStartOffsetSec: number;
  sourceStartSeconds: number;
  durationSec: number;
}

/** 单元内分析 JSON 中的 shot（start_ms/end_ms 为单元内相对毫秒）。 */
export interface UnitShot {
  shot_no: string;
  start_ms: number;
  end_ms: number;
  shot_type?: string;
  spatial_anchor?: string;
  end_state_action?: string;
  scene_type?: string;
  voice_type?: string;
  emotion?: string;
  characters?: string[];
  dialogue?: string;
  [key: string]: unknown;
}

/** 拼回整集后的 shot：时间码为集级毫秒，shot_no 全局重排。 */
export interface MergedShot extends Omit<UnitShot, "shot_no"> {
  /** 全局重排后的编号，SC001 起递增。 */
  shot_no: string;
  /** 单元内原始编号，便于回溯。 */
  source_shot_no: string;
  unitId: string;
  start_ms: number;
  end_ms: number;
}

/** 单个分析单元的分析 JSON（视觉通道输出，字段宽松透传）。 */
export interface UnitAnalysisJson {
  shots?: UnitShot[];
  [key: string]: unknown;
}

export interface UnitAnalysisPart {
  unitId: string;
  unitStartOffsetSec: number;
  analysis: UnitAnalysisJson;
}

export interface MergeUnitsResult {
  shots: MergedShot[];
  warnings: string[];
}

/** ASR 逐句结果（集级毫秒，由调用方先加单元偏移）。 */
export interface AsrSentence {
  begin_ms: number;
  end_ms: number;
  text: string;
  speaker?: string;
  confidence?: number;
}

export interface AlignedSentence extends AsrSentence {
  /** 归属的 shot 编号；orphan 为 null。 */
  shot_no: string | null;
}

export interface AlignTranscriptResult {
  aligned: AlignedSentence[];
  orphans: AlignedSentence[];
}

/** 相邻 shot 缺口超过该毫秒数时记 warning。 */
export const GAP_WARNING_THRESHOLD_MS = 1000;

/**
 * 把整集切成分析单元，最后一单元可短于 maxUnitSec。
 * durationSec <= 0 返回空数组。
 */
export function sliceUnits(durationSec: number, maxUnitSec = 120): AnalysisUnit[] {
  if (!(durationSec > 0) || !(maxUnitSec > 0)) return [];
  const units: AnalysisUnit[] = [];
  let start = 0;
  let index = 1;
  // 浮点余量：避免 119.999999 这类时长多切出一个零长单元
  while (start < durationSec - 1e-6) {
    const dur = Math.min(maxUnitSec, durationSec - start);
    units.push({
      unitId: `part-${String(index).padStart(3, "0")}`,
      unitStartOffsetSec: start,
      sourceStartSeconds: start,
      durationSec: dur,
    });
    start += dur;
    index += 1;
  }
  return units;
}

/**
 * 把各单元的分析 JSON 按 unitStartOffsetSec 偏移拼回整集时间轴。
 *
 * - shots 按 (单元偏移, 单元内 start_ms) 排序后全局重排 shot_no（SC001 起）。
 * - 相邻 shot 缺口 > 1s 记 warning；重叠时截断前者（前者 end_ms 收到后者
 *   start_ms），截断后若前 shot 时长 <= 0 额外记 warning。
 */
export function mergeUnitsByOffset(parts: UnitAnalysisPart[]): MergeUnitsResult {
  const warnings: string[] = [];
  const sorted = [...parts].sort((a, b) => a.unitStartOffsetSec - b.unitStartOffsetSec);

  const raw: MergedShot[] = [];
  for (const part of sorted) {
    const offsetMs = Math.round(part.unitStartOffsetSec * 1000);
    const shots = [...(part.analysis.shots ?? [])].sort((a, b) => a.start_ms - b.start_ms);
    for (const shot of shots) {
      raw.push({
        ...shot,
        source_shot_no: shot.shot_no,
        unitId: part.unitId,
        start_ms: Math.round(shot.start_ms) + offsetMs,
        end_ms: Math.round(shot.end_ms) + offsetMs,
      });
    }
  }
  raw.sort((a, b) => a.start_ms - b.start_ms);

  // 相邻缺口 / 重叠处理
  for (let i = 0; i + 1 < raw.length; i += 1) {
    const prev = raw[i];
    const next = raw[i + 1];
    const gap = next.start_ms - prev.end_ms;
    if (gap > GAP_WARNING_THRESHOLD_MS) {
      warnings.push(
        `shot ${prev.source_shot_no}(${prev.unitId}) 与 ${next.source_shot_no}(${next.unitId}) 之间存在 ${gap}ms 缺口`,
      );
    } else if (gap < 0) {
      warnings.push(
        `shot ${prev.source_shot_no}(${prev.unitId}) 与 ${next.source_shot_no}(${next.unitId}) 重叠 ${-gap}ms，已截断前者`,
      );
      prev.end_ms = next.start_ms;
      if (prev.end_ms <= prev.start_ms) {
        warnings.push(
          `shot ${prev.source_shot_no}(${prev.unitId}) 截断后时长 <= 0，请复核该单元分镜`,
        );
      }
    }
  }

  // 全局重排 shot_no
  const shots = raw.map((shot, i) => ({
    ...shot,
    shot_no: `SC${String(i + 1).padStart(3, "0")}`,
  }));

  return { shots, warnings };
}

/**
 * ASR 逐句与 shot 时间轴对齐：把台词挂到覆盖其时间区间中点的 shot；
 * 没有任何 shot 覆盖中点的句子进 orphans。
 * sentences 与 shots 必须同为集级毫秒时间码。
 */
export function alignTranscript(
  sentences: AsrSentence[],
  shots: Array<Pick<MergedShot, "shot_no" | "start_ms" | "end_ms">>,
): AlignTranscriptResult {
  const sortedShots = [...shots].sort((a, b) => a.start_ms - b.start_ms);
  const aligned: AlignedSentence[] = [];
  const orphans: AlignedSentence[] = [];

  const ordered = [...sentences].sort((a, b) => a.begin_ms - b.begin_ms);
  for (const sentence of ordered) {
    const mid = (sentence.begin_ms + sentence.end_ms) / 2;
    const hit = sortedShots.find(
      (shot, i) =>
        shot.start_ms <= mid &&
        (mid < shot.end_ms || (i === sortedShots.length - 1 && mid <= shot.end_ms)),
    );
    const entry: AlignedSentence = { ...sentence, shot_no: hit ? hit.shot_no : null };
    if (hit) aligned.push(entry);
    else orphans.push(entry);
  }

  return { aligned, orphans };
}
