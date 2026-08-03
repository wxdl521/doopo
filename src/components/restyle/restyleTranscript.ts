/**
 * 转绘 v1 台词通道（浏览器端）：
 *   原片 → Web Audio 解码重采样 16k 单声道 → 按 45s 分片编 WAV
 *   → transcribeRestyleAudio（网关 input_audio + audio-transcript-align skill）
 *   → 合并为带时间码的整集台词文本，喂给资产分析与分段提示词。
 *
 * 降级口径与 v2 一致：文件过大跳过解码（no_audio）、无音轨、网关拒绝 input_audio
 * 都返回空台词与原因，由调用方按「未返回可确认的台词」处理，不阻断分析。
 */
import { decodeToMono16k, encodeWavPcm16, shouldDecodeAudio } from "./v2/mediaSlicing";
import { probeVideoDuration } from "./v2/mediaSlicing";
import { sliceUnits } from "@/lib/restyle/analysisMerge";
import type { RestyleAsrResult, RestyleAsrSentence } from "@/lib/restyleAudio.functions";

/** 单片音频时长：16k 单声道 16bit ≈ 32KB/s，45s ≈ 1.4MB，base64 后约 1.9MB。 */
const ASR_SLICE_SEC = 45;

/** 单次分析最多识别的片段数（45s × 24 = 18 分钟），避免一次上传拖垮分析。 */
const MAX_ASR_SLICES = 24;

export interface TranscriptResult {
  /** 形如 `[00:12] 角色A：台词` 的整集台词文本，无台词时为空串。 */
  text: string;
  sentences: RestyleAsrSentence[];
  /** 没有产出台词时的原因（供 UI 与日志展示）。 */
  degradedReason?: string;
}

export interface TranscribeInput {
  unitId: string;
  audioBase64: string;
  format: "wav";
  sourceStartSeconds: number;
  durationSec: number;
}

type TranscribeFn = (input: { data: TranscribeInput }) => Promise<RestyleAsrResult>;

function pcmToWavBase64(pcm: Float32Array, start: number, end: number): Promise<string> {
  const blob = encodeWavPcm16(pcm.slice(start, end), 16_000);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error("读取音频数据失败。"));
    reader.readAsDataURL(blob);
  });
}

function formatTimecode(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const mm = String(Math.floor(total / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

export function formatTranscript(sentences: RestyleAsrSentence[]): string {
  return sentences
    .slice()
    .sort((a, b) => a.begin_ms - b.begin_ms)
    .map((sentence) => {
      const speaker =
        sentence.speaker && sentence.speaker !== "unknown" ? `${sentence.speaker}：` : "";
      return `[${formatTimecode(sentence.begin_ms)}] ${speaker}${sentence.text}`;
    })
    .join("\n");
}

/**
 * 抽取整集台词。任何一步失败都返回空台词 + 原因，绝不抛出中断分析流程。
 * onProgress 用于把「正在识别第 n/N 段」写进运行进度卡片。
 */
export async function transcribeSourceVideo(
  file: File,
  transcribe: TranscribeFn,
  options?: { onProgress?: (done: number, total: number) => void; isAborted?: () => boolean },
): Promise<TranscriptResult> {
  if (!shouldDecodeAudio(file.size)) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    return {
      text: "",
      sentences: [],
      degradedReason: `源片 ${mb}MB 超过音轨识别上限（400MB），已跳过音轨识别（no_audio）。可压缩后重传，或在提示词中人工补充台词。`,
    };
  }
  let durationSec = 0;
  try {
    durationSec = await probeVideoDuration(file);
  } catch {
    return { text: "", sentences: [], degradedReason: "无法读取源片时长，已跳过音轨识别。" };
  }
  let pcm: Float32Array | null = null;
  try {
    pcm = await decodeToMono16k(file, durationSec);
  } catch {
    pcm = null;
  }
  if (!pcm || pcm.length < 8_000) {
    return { text: "", sentences: [], degradedReason: "源片没有可解码的音轨（no_audio）。" };
  }

  const units = sliceUnits(durationSec, ASR_SLICE_SEC).slice(0, MAX_ASR_SLICES);
  const sentences: RestyleAsrSentence[] = [];
  let lastError = "";
  for (let index = 0; index < units.length; index += 1) {
    if (options?.isAborted?.()) break;
    const unit = units[index];
    const startSample = Math.floor(unit.sourceStartSeconds * 16_000);
    const endSample = Math.min(pcm.length, Math.ceil((unit.sourceStartSeconds + unit.durationSec) * 16_000));
    if (endSample - startSample < 8_000) continue;
    options?.onProgress?.(index + 1, units.length);
    try {
      const audioBase64 = await pcmToWavBase64(pcm, startSample, endSample);
      const result = await transcribe({
        data: {
          unitId: unit.unitId,
          audioBase64,
          format: "wav" as const,
          sourceStartSeconds: unit.sourceStartSeconds,
          durationSec: unit.durationSec,
        },
      });
      if (result.ok) {
        sentences.push(...result.sentences);
      } else {
        lastError = result.error;
        // 网关整体拒绝音频输入时，后续片段必然同样失败，直接停止。
        if (result.degraded) break;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : "音频识别请求失败";
    }
  }

  if (!sentences.length) {
    return {
      text: "",
      sentences: [],
      degradedReason: lastError ? `音轨识别未产出台词：${lastError}` : "音轨中未识别到台词。",
    };
  }
  return { text: formatTranscript(sentences), sentences };
}
