// ====================================================================
//  转绘 v1 · 单元化原片分析 —— restyleSourceUnits.functions.ts
//
//  v1 换 v2 单元化分析内核的服务端入口（无 DB，v1 是 localStorage 体系，
//  跳过 v2 的 restyle_episodes 表）。复用 v2 阶段一的整套管线：
//    analyzeEpisodeUnits（并发 2，视觉+ASR 双通道，永不抛错）
//    → assembleEpisodeAnalysis（mergeUnitsByOffset 拼回集级毫秒时间码
//      + alignTranscript 台词对齐 + 原片资产归并）
//    → v1AnalysisAdapter 转换为 v1 契约（DirectionShot[] / 台词文本 / 证据包）。
//
//  调用模式（方案 §7）：客户端逐单元循环调用（每请求 ≤1 单元，避开
//  CF Workers 约 100s 无字节断连），也接受一次多单元。单元时间码由
//  unitStartOffsetSec 决定，单单元调用的结果同样是集级毫秒时间码，
//  客户端按单元拼接即可（shotNo 为单次调用内重排，客户端需自行全局重排）。
//
//  扣费：预校验 2 分（ensureEnoughCredits）+ 按本轮成功单元数 ×2 扣。
//  幂等（对齐 v2 submitEpisodeAnalysisFn :885 与 restyleGrouping.core.ts 的
//  口径）：失败单元不扣；客户端传入幂等键时按
//  `restyle-source-units:{idempotencyKey}:{unitId}` 扣，同一单元重复成功
//  调用由扣费 RPC 唯一索引去重，不重复扣。扣费失败不阻断主流程。
// ====================================================================

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { ensureEnoughCredits } from "./creditsGuard";
import { chargeCredits } from "./userCredits.functions";
import { INTERNAL_VISION_MODEL } from "./restyle/lovableGateway";
import {
  analyzeEpisodeUnits,
  assembleEpisodeAnalysis,
  UnitInputSchema,
} from "./restyle/restyleVideoAnalysis.functions";
import type { AsrSentence, UnitAnalysisJson } from "./restyle/analysisMerge";
import type { DirectionShot } from "./restyle/cameraDirection";
import {
  alignedSentencesToTranscript,
  buildEvidencePackage,
  mergedShotToDirectionShot,
} from "./restyle/v1AnalysisAdapter";

type SupabaseContext = { supabase: any; userId: string };

const InputSchema = z.object({
  sourceFiles: z
    .array(
      z.object({
        id: z.string().min(1).max(200),
        name: z.string().min(1).max(255),
        units: z.array(UnitInputSchema).min(1).max(100),
      }),
    )
    .min(1)
    .max(30),
  /**
   * 客户端生成的幂等键（同一轮分析稳定不变）：传入后同一单元重复成功
   * 调用不重复扣费；不传则每次成功都扣（与 v2 缺省口径一致）。
   */
  idempotencyKey: z.string().min(1).max(200).optional(),
});

export interface RestyleSourceUnitsFileResult {
  sourceId: string;
  sourceName: string;
  /** v1 契约：全片轻量逐镜表（集级毫秒时间码）。 */
  shotSchedule: DirectionShot[];
  /** v1 契约：`[mm:ss] 角色：台词` 格式的全片台词文本。 */
  transcript: string;
  /** 喂给 analyzeRestyleAssets 证据包模式的文本。 */
  evidencePackage: string;
  warnings: string[];
  unitsTotal: number;
  unitsSucceeded: number;
  unitsFailed: number;
  failedUnitIds: string[];
}

export type RestyleSourceUnitsResult =
  | { ok: true; kernel: string; files: RestyleSourceUnitsFileResult[] }
  | { ok: false; error: string };

/**
 * 内核版本标记：随响应返回当前生效的分镜提取 skill 清单。
 * 纯服务端 prompt 改动在客户端 bundle 里探测不到，部署是否含某次 skill
 * 更新只能靠这个字段自证（2026-08 的教训：b8aa5dc 部署缺失靠猜）。
 */
export const ANALYSIS_KERNEL_VERSION = "shot-boundary-extract@2026-08-10";

/**
 * v1 单元化原片分析：逐集跑双通道单元分析并拼回集级时间轴，输出 v1 契约。
 * analyzeEpisodeUnits 永不抛错，单单元失败只计入 unitsFailed 与 warnings。
 */
export const analyzeRestyleSourceUnits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data, context }): Promise<RestyleSourceUnitsResult> => {
    const { supabase, userId } = context as SupabaseContext;

    // 积分预校验：单请求至少 2 分（1 个单元的视觉+ASR 双通道成本）
    const guard = await ensureEnoughCredits(2, { kind: "image", model: INTERNAL_VISION_MODEL });
    if (!guard.ok) return { ok: false, error: guard.error };

    const files: RestyleSourceUnitsFileResult[] = [];
    for (const file of data.sourceFiles) {
      const results = await analyzeEpisodeUnits(file.units);

      // 只把成功单元的分析/台词拼回整集（失败单元不污染时间轴）
      const analysisByUnit = new Map<string, UnitAnalysisJson>();
      const transcriptByUnit = new Map<string, AsrSentence[]>();
      for (const r of results) {
        if (r.ok && r.analysis) {
          analysisByUnit.set(r.unitId, r.analysis);
          transcriptByUnit.set(r.unitId, r.transcript ?? []);
        }
      }
      const assembled = assembleEpisodeAnalysis(
        file.units.map((u) => ({ unitId: u.unitId, unitStartOffsetSec: u.unitStartOffsetSec })),
        analysisByUnit,
        transcriptByUnit,
      );

      const shotSchedule = assembled.shots.map(mergedShotToDirectionShot);
      // 孤儿台词（无镜头归属）一并输出，按 begin_ms 排序后顺序不乱
      const transcript = alignedSentencesToTranscript([
        ...assembled.transcript,
        ...assembled.orphanTranscript,
      ]);
      const evidencePackage = buildEvidencePackage(assembled, shotSchedule, transcript);

      const failed = results.filter((r) => !r.ok);
      const warnings = [
        ...assembled.warnings,
        ...results
          .filter((r) => r.ok && r.degraded)
          .map((r) =>
            r.degraded === "no_audio"
              ? `单元 ${r.unitId} 无独立音轨，台词由画面推断（no_audio）`
              : `单元 ${r.unitId} 音频输入被网关拒绝，台词由关键帧推断（input_audio_rejected）`,
          ),
        ...failed.map((r) => `单元 ${r.unitId} 分析失败：${r.error ?? "未知错误"}`),
      ];

      // 扣费：按本轮成功单元 ×2；失败单元不扣。幂等键存在时按单元扣，
      // 同一单元重复成功调用由 RPC 唯一索引去重；扣费失败不阻断主流程。
      const succeeded = results.filter((r) => r.ok);
      for (const r of succeeded) {
        await chargeCredits(supabase, userId, {
          amount: 2,
          model: INTERNAL_VISION_MODEL,
          description: `转绘原片单元分析（${r.unitId}）`,
          idempotencyKey: data.idempotencyKey
            ? `restyle-source-units:${data.idempotencyKey}:${r.unitId}`
            : undefined,
        });
      }

      files.push({
        sourceId: file.id,
        sourceName: file.name,
        shotSchedule,
        transcript,
        evidencePackage,
        warnings,
        unitsTotal: file.units.length,
        unitsSucceeded: succeeded.length,
        unitsFailed: failed.length,
        failedUnitIds: failed.map((r) => r.unitId),
      });
    }
    return { ok: true, kernel: ANALYSIS_KERNEL_VERSION, files };
  });
