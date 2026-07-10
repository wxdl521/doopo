// ====================================================================
//  角色参考音频上传前的格式归一化(2026/07)
//
//  背景:ARK Seedance reference_audio 要求"声明的格式"与"真实字节"一致。
//  用户如果把 .m4a 改后缀成 .mp3 上传,浏览器按后缀把 File.type 报成
//  audio/mpeg,但字节仍是 AAC -> ARK 按 mp3 解码失败,返回
//  "audio format ... is not valid" (400 InvalidParameter)。
//
//  解法:上传前在浏览器端用 Web Audio API 按真实字节解码(decodeAudioData
//  看内容不看文件名),重新编码成 16-bit PCM WAV。WAV 无损(更适合音色克隆),
//  且 ARK(ffmpeg 后端)必定支持,作为统一中间格式最稳。无需新增依赖。
//
//  仅在浏览器端调用(SSR 不会执行上传 handler,且有 typeof window 守卫)。
// ====================================================================

/** 解码失败时抛出的统一错误(便于上层 catch 给出文案) */
export class AudioDecodeError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "AudioDecodeError";
  }
}

/**
 * 把任意浏览器可解码的音频文件(mp3/wav/m4a/aac/webm/ogg,含改过后缀名的文件)
 * 解码并重新编码成单声道 16-bit PCM WAV,返回 data:audio/wav;base64,... 。
 *
 * @param file 用户上传的音频文件
 * @param opts.maxSeconds 截断到前 N 秒(默认 30,语音克隆/背景音都够,且 WAV 体积可控)
 */
export async function audioFileToWavDataUrl(
  file: File,
  opts: { maxSeconds?: number } = {},
): Promise<string> {
  if (typeof window === "undefined") {
    throw new AudioDecodeError("audioFileToWavDataUrl 只能在浏览器端调用");
  }
  const w = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  const AC = w.AudioContext || w.webkitAudioContext;
  if (!AC) throw new AudioDecodeError("当前浏览器不支持 Web Audio API");

  const maxSeconds = opts.maxSeconds ?? 30;
  const ctx = new AC();
  try {
    const arrayBuf = await file.arrayBuffer();
    // .slice(0):部分浏览器 decodeAudioData 会 detach 传入的 ArrayBuffer,复制一份更稳
    let audioBuf: AudioBuffer;
    try {
      audioBuf = await ctx.decodeAudioData(arrayBuf.slice(0));
    } catch {
      throw new AudioDecodeError("无法解码该音频,可能格式不支持或文件损坏");
    }

    const sampleRate = audioBuf.sampleRate;
    const totalSamples = Math.min(audioBuf.length, Math.floor(maxSeconds * sampleRate));
    // 下混为单声道(音色克隆/参考无需立体声,体积减半)
    const chCount = audioBuf.numberOfChannels;
    const mono = new Float32Array(totalSamples);
    for (let i = 0; i < totalSamples; i++) {
      let sum = 0;
      for (let c = 0; c < chCount; c++) sum += audioBuf.getChannelData(c)[i];
      mono[i] = sum / chCount;
    }

    const wavBuf = encodeWavPcm16(mono, sampleRate);
    return `data:audio/wav;base64,${bytesToBase64(wavBuf)}`;
  } finally {
    if (typeof ctx.close === "function") void ctx.close();
  }
}

/** 把单声道 Float32 PCM 编码成 16-bit PCM WAV ArrayBuffer */
function encodeWavPcm16(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const numChannels = 1;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  let offset = 0;
  const writeString = (s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset++, s.charCodeAt(i));
  };
  const writeUint32 = (v: number) => {
    view.setUint32(offset, v, true);
    offset += 4;
  };
  const writeUint16 = (v: number) => {
    view.setUint16(offset, v, true);
    offset += 2;
  };

  // RIFF header
  writeString("RIFF");
  writeUint32(36 + dataSize); // 文件大小 - 8
  writeString("WAVE");
  // fmt chunk
  writeString("fmt ");
  writeUint32(16); // fmt chunk 大小
  writeUint16(1); // PCM = 1
  writeUint16(numChannels);
  writeUint32(sampleRate);
  writeUint32(byteRate);
  writeUint16(blockAlign);
  writeUint16(16); // 每采样位数
  // data chunk
  writeString("data");
  writeUint32(dataSize);
  // PCM 样本(little-endian int16)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return buffer;
}

/** ArrayBuffer -> base64(分块避免 fromCharCode 栈溢出) */
function bytesToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = Array.from(bytes.subarray(i, i + chunk));
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}
