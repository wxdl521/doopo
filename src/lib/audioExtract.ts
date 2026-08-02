/**
 * 浏览器端音频预处理（台词稿转写模块）：
 *   音/视频文件 → Web Audio 解码为 16k 单声道 → 按 45s 切片编 WAV → base64
 * 复用转绘 v2 的解码/编码实现，避免重复造轮子。
 */
import {
  AUDIO_SLICE_SEC,
  decodeToMono16k,
  encodeWavPcm16,
  probeVideoDuration,
  shouldDecodeAudio,
} from "@/components/restyle/v2/mediaSlicing";

export interface AudioSlice {
  index: number;
  audioBase64: string;
  offsetSeconds: number;
  durationSec: number;
}

function blobToBase64(blob: Blob): Promise<string> {
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

export class AudioExtractError extends Error {}

/** 解码整个文件并切成可直接上传的 WAV 片段。 */
export async function extractAudioSlices(file: File): Promise<AudioSlice[]> {
  if (!shouldDecodeAudio(file.size)) {
    throw new AudioExtractError("文件过大，无法在浏览器内解码音轨，请先压缩或裁剪。");
  }
  let durationSec = 0;
  try {
    durationSec = await probeVideoDuration(file);
  } catch {
    throw new AudioExtractError("无法读取文件时长，请确认文件格式是否受支持。");
  }
  const pcm = await decodeToMono16k(file, durationSec).catch(() => null);
  if (!pcm || pcm.length < 8_000) {
    throw new AudioExtractError("文件中没有可解码的音轨。");
  }

  const slices: AudioSlice[] = [];
  const total = pcm.length / 16_000;
  for (let start = 0, index = 0; start < total; start += AUDIO_SLICE_SEC, index += 1) {
    const startSample = Math.floor(start * 16_000);
    const endSample = Math.min(pcm.length, Math.ceil((start + AUDIO_SLICE_SEC) * 16_000));
    if (endSample - startSample < 8_000) continue;
    const wav = encodeWavPcm16(pcm.slice(startSample, endSample), 16_000);
    slices.push({
      index,
      audioBase64: await blobToBase64(wav),
      offsetSeconds: start,
      durationSec: (endSample - startSample) / 16_000,
    });
  }
  if (slices.length === 0) throw new AudioExtractError("音轨过短，无法转写。");
  return slices;
}