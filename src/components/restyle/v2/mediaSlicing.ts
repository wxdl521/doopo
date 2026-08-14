// ====================================================================
//  转绘 v2 阶段一 —— 浏览器端媒体处理（切片 / 抽帧 / 音频提取 / 上传）
//
//  对上传的每个视频文件：
//    1. <video> 元素读时长 → sliceUnits(duration) 切分析单元（默认 120s/单元）
//    2. 每单元 canvas 均匀抽 4 个关键帧（3~5 区间取中值）
//    3. Web Audio 解码整段音频 → 重采样 16k 单声道 → 按单元切 WAV
//       （按 45s 一段分片处理，与单元边界对齐；文件 > AUDIO_DECODE_MAX_BYTES
//        时跳过音轨，走 no_audio 降级）
//    4. 源视频走 createMediaUploadUrl 签名地址二进制直传（XHR PUT 带进度），
//       帧图/单元音频等小文件仍走 uploadLocalImage base64 路径
//    5. 产出 units 数组喂 submitEpisodeAnalysisFn
//
//  文件 > 2GB 拒绝；音频解码阈值 80MB（decodeAudioData 会把整段 PCM 放进内存）。
// ====================================================================

import { sliceUnits, type AnalysisUnit } from "@/lib/restyle/analysisMerge";

/** 单文件上限：直传后不再受 base64 内存约束，放宽到 2GB。 */
export const MAX_SOURCE_FILE_BYTES = 2 * 1024 * 1024 * 1024;

/**
 * 音频整段解码的体积阈值：超过则跳过 decodeAudioData（其会把整段 PCM 放进
 * 内存，大文件直接撑爆标签页），该集标记 no_audio，走服务端无音频降级路径。
 */
export const AUDIO_DECODE_MAX_BYTES = 400 * 1024 * 1024;

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

/** createMediaUploadUrl 的最小签名：为二进制直传取签名上传地址。 */
export type PrepareUploadUrlFn = (input: {
  id: string;
  kind: "video" | "audio";
  ext: string;
}) => Promise<{ ok: boolean; uploadUrl?: string; path?: string; error?: string }>;

/** 上传完成后签发读地址（对象已存在，签名成功；私有桶可播）。 */
export type SignReadUrlFn = (input: {
  path: string;
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
  /** 源视频对象 key（直传分支）：持久化用，读取时现签（7 天签名 URL 过期治理）。 */
  videoKey?: string;
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
 * 注意：decodeAudioData 会把整段 PCM 放进内存，调用方按 AUDIO_DECODE_MAX_BYTES 把关。
 */
export async function decodeToMono16k(file: File, durationSec: number): Promise<Float32Array | null> {
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
export function sliceUnitWav(pcm: Float32Array, unit: AnalysisUnit): Blob | null {
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

/** 从文件名/MIME 取扩展名（签名上传路径用）。 */
export function extFromFile(file: File): string {
  const byName = file.name.match(/\.([a-z0-9]{2,5})$/i)?.[1];
  if (byName) return byName.toLowerCase();
  const byType = file.type.split("/")[1];
  return (byType || "mp4").replace("quicktime", "mov").toLowerCase();
}

/** 音频解码决策（纯函数，便于测试）。 */
export function shouldDecodeAudio(fileSizeBytes: number): boolean {
  return fileSizeBytes <= AUDIO_DECODE_MAX_BYTES;
}

/**
 * 可重试的上传错误判定：网络错误 / 5xx 可重试；4xx（签名、权限、参数
 * 校验）重试无意义，直接判否。供上传重试包装与整调用级重试共用。
 */
export function isRetryableUploadError(message: string): boolean {
  if (/HTTP 5\d{2}|（5\d{2}）|\b5\d{2}\b/.test(message)) return true;
  if (/HTTP 4\d{2}|（4\d{2}）|\b4\d{2}\b/.test(message)) return false;
  return /网络|network|fetch|超时|timeout|断开|connection|reset|abort/i.test(message);
}

/**
 * 给 MediaUploadFn 包一层指数退避重试（默认共 3 次：首试 + 2 次退避）。
 * 只对 isRetryableUploadError 判定可重试的失败重试；返回 ok:false 与抛错
 * 两种失败形态都覆盖。签名与 MediaUploadFn 一致，调用侧无感替换。
 */
export function withUploadRetry(
  upload: MediaUploadFn,
  options?: {
    maxAttempts?: number;
    baseDelayMs?: number;
    /** 测试注入点：生产勿传。 */
    sleep?: (ms: number) => Promise<void>;
  },
): MediaUploadFn {
  const maxAttempts = options?.maxAttempts ?? 3;
  const baseDelayMs = options?.baseDelayMs ?? 1_000;
  const sleep =
    options?.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  return async (input) => {
    let lastError = "上传失败。";
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const result = await upload(input);
        if (result.ok) return result;
        lastError = result.error ?? lastError;
        if (!isRetryableUploadError(lastError)) return result;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        if (!isRetryableUploadError(lastError)) throw error;
      }
      if (attempt < maxAttempts) await sleep(baseDelayMs * 2 ** (attempt - 1));
    }
    return { ok: false, error: lastError };
  };
}

/**
 * 二进制直传：XHR PUT 原始 File 到签名上传地址（不转 base64、不进内存字符串），
 * 带上传进度回调。返回可长效访问的签名读 URL。
 */
export async function putBinaryWithProgress(
  file: Blob,
  target: { uploadUrl: string },
  onPercent?: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", target.uploadUrl, true);
    xhr.setRequestHeader("content-type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onPercent) onPercent(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`直传失败（HTTP ${xhr.status}）：${(xhr.responseText || "").slice(0, 120)}`));
    };
    xhr.onerror = () => reject(new Error("直传网络错误"));
    xhr.send(file);
  });
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
    /** 大文件（源视频）直传地址获取；不传则回退 base64 旧路径。 */
    createUploadUrl?: PrepareUploadUrlFn;
    /** 直传完成后签发读地址（与 createUploadUrl 配套）。 */
    signReadUrl?: SignReadUrlFn;
    onProgress?: OnUnitProgress;
    /** 测试注入点：生产勿传。 */
    deps?: {
      probe?: typeof probeVideoDuration;
      decodeAudio?: typeof decodeToMono16k;
      openSession?: typeof openVideoSession;
      captureFrames?: typeof captureUnitFrames;
      putBinary?: typeof putBinaryWithProgress;
    };
  },
): Promise<PreparedEpisode> {
  const { episodeId, upload, createUploadUrl, signReadUrl, onProgress } = opts;
  const deps = {
    probe: probeVideoDuration,
    decodeAudio: decodeToMono16k,
    openSession: openVideoSession,
    captureFrames: captureUnitFrames,
    putBinary: putBinaryWithProgress,
    ...opts.deps,
  };
  const report = (e: UnitProgressEvent) => onProgress?.(e);

  if (file.size > MAX_SOURCE_FILE_BYTES) {
    throw new Error(
      `文件 ${formatMb(file.size)}MB 超过 ${formatMb(MAX_SOURCE_FILE_BYTES)}MB 上限，请压缩或拆分后再上传。`,
    );
  }

  report({ unitIndex: -1, unitId: "", phase: "probe" });
  const durationSec = await deps.probe(file);
  const units = sliceUnits(durationSec);
  if (units.length === 0) throw new Error("视频时长为 0，无法切片。");

  report({ unitIndex: -1, unitId: "", phase: "video_upload", detail: "准备上传 0%" });
  let videoUrl: string;
  let videoKey: string | undefined;
  if (createUploadUrl) {
    // 二进制直传：不转 base64，大文件不占内存
    const target = await createUploadUrl({ id: episodeId, kind: "video", ext: extFromFile(file) });
    if (!target.ok || !target.uploadUrl || !target.path) {
      throw new Error(target.ok ? "未获取到上传地址。" : (target.error ?? "获取上传地址失败。"));
    }
    await deps.putBinary(file, { uploadUrl: target.uploadUrl }, (p) =>
      report({ unitIndex: -1, unitId: "", phase: "video_upload", detail: `已上传 ${p}%` }),
    );
    // 上传完成后签发读地址（对象已存在，签名成功；私有桶可播）
    if (!signReadUrl) throw new Error("缺少读地址签发函数。");
    const read = await signReadUrl({ path: target.path });
    if (!read.ok || !read.url) throw new Error(read.ok ? "读取地址签发失败。" : (read.error ?? "读取地址签发失败。"));
    videoUrl = read.url;
    videoKey = target.path;
  } else {
    videoUrl = await uploadOrThrow(upload, {
      base64: await fileToDataUrl(file),
      id: episodeId,
      kind: "video",
    });
  }

  // 音频整段解码一次，各单元共用；超阈值跳过（no_audio 降级），切完即释放
  let pcm: Float32Array | null = null;
  if (shouldDecodeAudio(file.size)) {
    report({ unitIndex: -1, unitId: "", phase: "audio", detail: "解码整集音频" });
    pcm = await deps.decodeAudio(file, durationSec);
  } else {
    report({
      unitIndex: -1,
      unitId: "",
      phase: "audio",
      detail: `文件超过 ${formatMb(AUDIO_DECODE_MAX_BYTES)}MB，已跳过音轨提取，台词分析将仅依据画面`,
    });
  }

  const session = await deps.openSession(file);
  try {
    const prepared: PreparedUnit[] = [];
    for (let i = 0; i < units.length; i += 1) {
      const unit = units[i];
      try {
        report({ unitIndex: i, unitId: unit.unitId, phase: "frames" });
        const frames = await deps.captureFrames(session, unit, FRAMES_PER_UNIT);

        report({ unitIndex: i, unitId: unit.unitId, phase: "audio" });
        const wav = pcm ? sliceUnitWav(pcm, unit) : null;

        report({ unitIndex: i, unitId: unit.unitId, phase: "upload" });
        // 4 帧 + 单元音频并发上传（相互独立的 base64 小请求;单元内串行
        // 上传是媒体准备阶段的大头之一）。Promise.all 保序,任一失败整单元
        // 判失败（与串行语义一致）。
        const [frameUrls, audioUrl] = await Promise.all([
          Promise.all(
            frames.map((frame, f) =>
              uploadOrThrow(upload, {
                base64: frame,
                id: `${episodeId}-${unit.unitId}-f${f + 1}`,
                kind: "shot",
              }),
            ),
          ),
          wav
            ? blobToDataUrl(wav).then((base64) =>
                uploadOrThrow(upload, {
                  base64,
                  id: `${episodeId}-${unit.unitId}-audio`,
                  kind: "character-audio",
                }),
              )
            : Promise.resolve(undefined),
        ]);

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
    return { durationSec, videoUrl, videoKey, units: prepared };
  } finally {
    pcm = null; // 释放整段 PCM 引用，避免常驻数百 MB
    if (session?.url && typeof URL.revokeObjectURL === "function") {
      URL.revokeObjectURL(session.url);
    }
  }
}

/** prepareEpisodeMedia 的依赖注入类型（测试用）。 */
export type MediaPrepDeps = NonNullable<Parameters<typeof prepareEpisodeMedia>[1]["deps"]>;
