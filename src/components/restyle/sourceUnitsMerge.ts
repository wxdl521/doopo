// ====================================================================
// sourceUnitsMerge —— v1 单元化分析结果的客户端合并（纯函数，可单测）
//
// analyzeRestyleSourceUnits 按「每请求 1 单元」逐单元调用（避开 CF Workers
// 约 100s 无字节断连），每次返回该单元的 v1 契约（shotNo 为单次调用内
// SC001 起重排）。本模块把同一源视频的多次单元结果合并为整集结果：
//   - shotSchedule 按单元顺序拼接并全局重排 shotNo（SC001 起），时间码
//     不动（服务端已按 unitStartOffsetSec 拼回集级毫秒）；
//   - transcript 直接拼接（各行均为集级毫秒时间码，跨单元天然有序）；
//   - evidencePackage 逐单元拼接，超上限在行边界截尾并标注（上限略低于
//     analyzeRestyleAssets 的 60,000 schema 上限）；
//   - warnings / 单元成败计数原样聚合，供分析播报透传。
// ====================================================================

import type { DirectionShot } from "@/lib/restyle/cameraDirection";
import type { RestyleSourceUnitsFileResult } from "@/lib/restyleSourceUnits.functions";

/** 合并后证据包上限（字符）：略低于 analyzeRestyleAssets evidencePackage 的 60,000。 */
export const MERGED_EVIDENCE_PACKAGE_MAX_CHARS = 58_000;

const TRUNCATION_MARK = "\n…（证据包过长已截尾）";

export interface MergedSourceAnalysis {
  /** 整集轻量逐镜表：shotNo 已全局重排（SC001 起），时间码保持集级毫秒。 */
  shotSchedule: DirectionShot[];
  /** 整集台词文本（[mm:ss] 角色：台词，跨单元按时间自然有序）。 */
  transcript: string;
  /** 喂给 analyzeRestyleAssets 证据包模式的整集证据文本。 */
  evidencePackage: string;
  warnings: string[];
  unitsTotal: number;
  unitsSucceeded: number;
  unitsFailed: number;
  failedUnitIds: string[];
}

/** shotNo 全局重排（SC001 起递增）；输入顺序与时间码保持不变。 */
export function renumberShotSchedule(shots: DirectionShot[]): DirectionShot[] {
  return shots.map((shot, index) => ({
    ...shot,
    shotNo: `SC${String(index + 1).padStart(3, "0")}`,
  }));
}

/**
 * 合并同一源视频的多次单元分析结果。results 必须按单元时间顺序传入
 * （调用方逐单元循环调用，天然有序）。
 */
export function mergeSourceUnitResults(
  results: RestyleSourceUnitsFileResult[],
): MergedSourceAnalysis {
  const shotSchedule = renumberShotSchedule(results.flatMap((result) => result.shotSchedule));
  const transcript = results
    .map((result) => result.transcript.trim())
    .filter(Boolean)
    .join("\n");

  const joinedEvidence = results
    .map((result) => result.evidencePackage.trim())
    .filter(Boolean)
    .join("\n\n");
  let evidencePackage = joinedEvidence;
  if (joinedEvidence.length > MERGED_EVIDENCE_PACKAGE_MAX_CHARS) {
    // 超上限在行边界截尾，避免截断半行污染资产提炼
    const body = joinedEvidence.slice(0, MERGED_EVIDENCE_PACKAGE_MAX_CHARS - TRUNCATION_MARK.length);
    const lastNewline = body.lastIndexOf("\n");
    evidencePackage = (lastNewline > 0 ? body.slice(0, lastNewline) : body) + TRUNCATION_MARK;
  }

  return {
    shotSchedule,
    transcript,
    evidencePackage,
    warnings: results.flatMap((result) => result.warnings),
    unitsTotal: results.reduce((sum, result) => sum + result.unitsTotal, 0),
    unitsSucceeded: results.reduce((sum, result) => sum + result.unitsSucceeded, 0),
    unitsFailed: results.reduce((sum, result) => sum + result.unitsFailed, 0),
    failedUnitIds: results.flatMap((result) => result.failedUnitIds),
  };
}
