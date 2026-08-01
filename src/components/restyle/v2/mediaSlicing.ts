// ====================================================================
//  转绘 v2 阶段一 —— 浏览器端媒体处理（切片 / 抽帧 / 音频提取 / 上传）
//
//  对上传的每个视频文件：
//    1. <video> 元素读时长 → sliceUnits(duration) 切分析单元（默认 120s/单元）
//    2. 每单元 canvas 均匀抽 4 个关键帧（3~5 区间取中值）
//    3. Web Audio 解码整段音频 → 重采样 16k 单声道 → 按单元切 WAV
//       （按 45s 一段分片处理，与单元边界对齐）
//    4. 复用 uploadLocalImage（workspace-media / COS）上传视频、帧图、音频
//    5. 产出 units 数组喂 submitEpisodeAnalysisFn
//
//  文件 > 200MB 直接拒绝（base64 上传链路的内存与体积双重限制）。
// ====================================================================

import { sliceUnits, type AnalysisUnit } from "@/lib/restyle/analysisMerge";

/** 单文件上限：超过后 base64 上传会把字符串/请求体撑到不可接受。 */
export const MAX_SOURCE_FILE_BYTES = 200 * 1024 * 1024;

/** 每单元关键帧数量（需求口径 3~5，取中值 4）。 */
export const FRAMES_PER_UNIT = 4;

/** 音频分片粒度：16k 单声道 16bit ≈ 32KB/s，45s ≈ 1.4MB。 */
export const AUDIO_SLICE_SEC = 45;

/** 抽帧最长边（像素），控制单帧体积。 */
const FRAME_MAX_EDGE = 768;

const FRAME_JPEG_QUALITY = 0.8;

export type SlicingPhase =
  | "probe" // 读取时长 / 切片
  | "video_upload" // 上传整集源视频
  | "frames" // 单元抽帧
  | "audio" // 单元音频提取
  | "upload" // 单元帧图 / 音频上传
  | "done"
  | "error";

export interface UnitProgressEvent {
  /** -1 表示整集级阶段（probe / video_upload）。 */
  unitIndex: number;
  unitId: string;
  phase: SlicingPhase;
  detail?: string;
}

export type OnUnitProgress = (event: UnitProgressEvent) => void;

/** uploadLocalImage 的最小签名（kind 见 src/lib/uploadImage.functions.ts）。 */
export type MediaUploadFn = (input: {
  base64: string;
  id: string;
  kind: "video" | "shot" | "character-audio";
}) => Promise<{ ok: boolean; url?: string; error?: string }>;

/** 与 submitEpisodeAnalysisFn 入参 units 元素一致。 */
export interface PreparedUnit {
  unitId: string;
  videoUrl: string;
  audioUrl?: string;
  unitStartOffsetSec: number;
  sourceStartSeconds: number;
  durationSec: number;
  frameUrls: string[];
}

export interface PreparedEpisode {
  durationSec: number;
  videoUrl: string;
  units: PreparedUnit[];
}

function formatMb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1);
}

/** 读视频时长（加载元数据即释放引用，URL 由调用方 revoke）。 */
export function probeVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    const cleanup = () => URL.revokeObjectURL(url);
    video.onloadedmetadata = () => {
      const duration = video.duration;
      cleanup();
      if (Number.isFinite(duration) && duration > 0) resolve(duration);
      else reject(new Error("无法读取视频时长。"));
    };
    video.onerror = () => {
      cleanup();
      reject(new Error("视频文件无法解析，请确认格式受浏览器支持（mp4/webm）。"));
    };
    video.src = url;
  });
}

interface VideoSession {
  video: HTMLVideoElement;
  canvas: HTMLCanvasElement;
  url: string;
}

function openVideoSession(file: File): Promise<VideoSession> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.onloadeddata = () => resolve({ video, canvas: document.createElement("canvas"), url });
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("视频解码失败，无法抽帧。"));
    };
    video.src = url;
  });
}

function seekTo(video: HTMLVideoElement, timeSec: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      video.onseeked = null;
      reject(new Error(`seek 到 ${timeSec.toFixed(1)}s 超时`));
    }, 15_000);
    video.onseeked = () => {
      window.clearTimeout(timer);
      video.onseeked = null;
      resolve();
    };
    video.currentTime = timeSec;
  });
}

/** 在单元区间内均匀取点截帧，返回 JPEG dataURL 列表。 */
async function captureUnitFrames(
  session: VideoSession,
  unit: AnalysisUnit,
  count: number,
): Promise<string[]> {
  const { video, canvas } = session;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("浏览器不支持 canvas 2d，无法抽帧。");
  const scale = Math.min(1, FRAME_MAX_EDGE / Math.max(video.videoWidth, video.videoHeight, 1));
  canvas.width = Math.max(2, Math.round(video.videoWidth * scale));
  canvas.height = Math.max(2, Math.round(video.videoHeight * scale));

  const start = unit.sourceStartSeconds;
  const end = unit.sourceStartSeconds + unit.durationSec;
  const frames: string[] = [];
  for (let i = 0; i < count; i += 1) {
    // 单元内均匀取点（避开首尾黑帧，取段中点序列）
    const t = Math.min(start + (unit.durationSec * (i + 0.5)) / count, Math.max(start, end - 0.05));
    await seekTo(video, t);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    frames.push(canvas.toDataURL("image/jpeg", FRAME_JPEG_QUALITY));
  }
  return frames;
}

/**
 * 整段音频解码 → 重采样为 16kHz 单声道 Float32。
 * 无音轨 / 解码失败返回 null（服务端走 no_audio 降级路径）。
 * 注意：decodeAudioData 会把整段 PCM 放进内存，200MB 上限同时也在约束这里。
 */
async function decodeToMono16k(file: File, durationSec: number): Promise<Float32Array | null> {
  let decoded: AudioBuffer;
  const ctx = new AudioContext();
  try {
    decoded = await ctx.decodeAudioData(await file.arrayBuffer());
  } catch {
    return null;
  } finally {
    void ctx.close().catch(() => {});
  }
  const targetRate = 16_000;
  const frames = Math.max(1, Math.ceil(decoded.duration * targetRate));
  const offline = new OfflineAudioContext(1, frames, targetRate);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start(0);
  const rendered = await offline.startRendering();
  // 渲染结果可能比元数据时长略短，按实际长度返回
  const data = rendered.getChannelData(0);
  const expected = Math.min(data.length, Math.ceil(durationSec * targetRate));
  return expected === data.length ? data : data.slice(0, expected);
}

/** Float32 PCM → 16bit PCM WAV。 */
export function encodeWavPcm16(samples: Float32Array, sampleRate = 16_000): Blob {
  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const writeStr = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // 单声道
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

/** 按 45s 一段从 16k 单声道 PCM 中切出单元音频并编码为 WAV。 */
function sliceUnitWav(pcm: Float32Array, unit: AnalysisUnit): Blob | null {
  const rate = 16_000;
  const startSample = Math.floor(unit.sourceStartSeconds * rate);
  const endSample = Math.min(pcm.length, Math.ceil((unit.sourceStartSeconds + unit.durationSec) * rate));
  if (endSample - startSample < rate / 2) return null; // 不足 0.5s 视为无有效音频
  const chunkSamples = AUDIO_SLICE_SEC * rate;
  const parts: Float32Array[] = [];
  for (let s = startSample; s < endSample; s += chunkSamples) {
    parts.push(pcm.slice(s, Math.min(endSample, s + chunkSamples)));
  }
  const merged = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    merged.set(p, offset);
    offset += p.length;
  }
  return encodeWavPcm16(merged, rate);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("读取媒体数据失败。"));
    reader.readAsDataURL(blob);
  });
}

function fileToDataUrl(file: File): Promise<string> {
  return blobToDataUrl(file);
}

async function uploadOrThrow(upload: MediaUploadFn, input: Parameters<MediaUploadFn>[0]) {
  const result = await upload(input);
  if (!result.ok || !result.url) {
    throw new Error(result.ok ? "上传后未返回访问地址。" : (result.error ?? "上传失败。"));
  }
  return result.url;
}

/**
 * 处理一整集视频：探测时长 → 切片 → 上传源视频 → 逐单元抽帧/提音频/上传。
 * 任一单元失败只标记该单元（error 事件）并继续；整体失败直接抛错。
 */
export async function prepareEpisodeMedia(
  file: File,
  opts: {
    episodeId: string;
    upload: MediaUploadFn;
    onProgress?: OnUnitProgress;
  },
): Promise<PreparedEpisode> {
  const { episodeId, upload, onProgress } = opts;
  const report = (e: UnitProgressEvent) => onProgress?.(e);

  if (file.size > MAX_SOURCE_FILE_BYTES) {
    throw new Error(
      `文件 ${formatMb(file.size)}MB 超过 ${formatMb(MAX_SOURCE_FILE_BYTES)}MB 上限，请压缩或拆分后再上传。`,
    );
  }

  report({ unitIndex: -1, unitId: "", phase: "probe" });
  const durationSec = await probeVideoDuration(file);
  const units = sliceUnits(durationSec);
  if (units.length === 0) throw new Error("视频时长为 0，无法切片。");

  report({ unitIndex: -1, unitId: "", phase: "video_upload" });
  const videoUrl = await uploadOrThrow(upload, {
    base64: await fileToDataUrl(file),
    id: episodeId,
    kind: "video",
  });

  // 音频整段解码一次，各单元共用（无音轨时整集走降级路径）
  report({ unitIndex: -1, unitId: "", phase: "audio", detail: "解码整集音频" });
  const pcm = await decodeToMono16k(file, durationSec);

  const session = await openVideoSession(file);
  try {
    const prepared: PreparedUnit[] = [];
    for (let i = 0; i < units.length; i += 1) {
      const unit = units[i];
      try {
        report({ unitIndex: i, unitId: unit.unitId, phase: "frames" });
        const frames = await captureUnitFrames(session, unit, FRAMES_PER_UNIT);

        report({ unitIndex: i, unitId: unit.unitId, phase: "audio" });
        const wav = pcm ? sliceUnitWav(pcm, unit) : null;

        report({ unitIndex: i, unitId: unit.unitId, phase: "upload" });
        const frameUrls: string[] = [];
        for (let f = 0; f < frames.length; f += 1) {
          frameUrls.push(
            await uploadOrThrow(upload, {
              base64: frames[f],
              id: `${episodeId}-${unit.unitId}-f${f + 1}`,
              kind: "shot",
            }),
          );
        }
        let audioUrl: string | undefined;
        if (wav) {
          audioUrl = await uploadOrThrow(upload, {
            base64: await blobToDataUrl(wav),
            id: `${episodeId}-${unit.unitId}-audio`,
            kind: "character-audio",
          });
        }

        prepared.push({
          unitId: unit.unitId,
          videoUrl,
          audioUrl,
          unitStartOffsetSec: unit.unitStartOffsetSec,
          sourceStartSeconds: unit.sourceStartSeconds,
          durationSec: unit.durationSec,
          frameUrls,
        });
        report({ unitIndex: i, unitId: unit.unitId, phase: "done" });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        report({ unitIndex: i, unitId: unit.unitId, phase: "error", detail: message });
        throw new Error(`单元 ${unit.unitId} 媒体处理失败：${message}`);
      }
    }
    return { durationSec, videoUrl, units: prepared };
  } finally {
    URL.revokeObjectURL(session.url);
  }
}
