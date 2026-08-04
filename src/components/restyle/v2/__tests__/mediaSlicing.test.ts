// 转绘 v2 媒体处理回归测试（jsdom，不触网、不解码真实视频）
// 覆盖：超大文件跳过音频解码仍返回完整 units / 源视频走 Blob 直传 / PCM 切片边界
import { describe, expect, it, vi } from "vitest";
import {
  AUDIO_DECODE_MAX_BYTES,
  MAX_SOURCE_FILE_BYTES,
  encodeWavPcm16,
  extFromFile,
  prepareEpisodeMedia,
  shouldDecodeAudio,
  sliceUnitWav,
  type MediaPrepDeps,
} from "../mediaSlicing";

// File 的 size 由构造决定，直接做一个带自定义 size 的鸭子类型
function fileWithSize(bytes: number, name = "ep01.mp4"): File {
  const f = new File([new Uint8Array(8)], name, { type: "video/mp4" });
  Object.defineProperty(f, "size", { value: bytes });
  return f;
}

const fakeSession = { video: {} as HTMLVideoElement, canvas: {} as HTMLCanvasElement, url: "" };

function makeDeps(spies: {
  decodeAudio?: MediaPrepDeps["decodeAudio"];
  putBinary?: MediaPrepDeps["putBinary"];
}): MediaPrepDeps {
  return {
    probe: vi.fn(async (_file: File) => 110), // 1min50s
    decodeAudio: spies.decodeAudio ?? vi.fn(async (_f: File, _d: number) => null),
    openSession: vi.fn(async (_f: File) => fakeSession),
    captureFrames: vi.fn(async () => ["data:image/jpeg;base64,AAA"]),
    putBinary: spies.putBinary ?? vi.fn(async () => {}),
  };
}

const okUpload = vi.fn(async (_input: { base64: string; id: string; kind: string }) => ({
  ok: true,
  url: "https://signed/frame.jpg",
}));

describe("阈值决策", () => {
  it("shouldDecodeAudio：80MB 阈值", () => {
    expect(shouldDecodeAudio(AUDIO_DECODE_MAX_BYTES)).toBe(true);
    expect(shouldDecodeAudio(AUDIO_DECODE_MAX_BYTES + 1)).toBe(false);
  });

  it("extFromFile：文件名优先，MIME 兜底", () => {
    expect(extFromFile(fileWithSize(10, "a.MP4"))).toBe("mp4");
    expect(extFromFile(fileWithSize(10, "noext"))).toBe("mp4");
  });
});

describe("大文件降级（212MB 样例场景）", () => {
  it("超过音频阈值：不解码、不中断，units 完整且无 audioUrl", async () => {
    const decodeAudio = vi.fn(async () => null);
    const big = fileWithSize(450 * 1024 * 1024); // 450MB，超过 400MB 音频阈值
    const result = await prepareEpisodeMedia(big, {
      episodeId: "ep1",
      upload: okUpload,
      createUploadUrl: vi.fn(async () => ({
        ok: true,
        uploadUrl: "https://signed/upload",
        path: "u1/uploads/restyle-v2/video/ep1.mp4",
      })),
      signReadUrl: vi.fn(async () => ({ ok: true, url: "https://signed/read.mp4" })),
      deps: makeDeps({ decodeAudio }),
    });
    expect(decodeAudio).not.toHaveBeenCalled();
    expect(result.durationSec).toBe(110);
    expect(result.units.length).toBe(1); // 110s ≤ 120s 单元上限
    expect(result.units[0].audioUrl).toBeUndefined();
    expect(result.units[0].frameUrls.length).toBe(1);
    expect(result.videoUrl).toBe("https://signed/read.mp4");
  });

  it("源视频直传收到的是 File/Blob 而不是 base64 字符串", async () => {
    const putBinary = vi.fn(async (_blob: Blob, _t: { uploadUrl: string }) => {});
    const big = fileWithSize(450 * 1024 * 1024);
    await prepareEpisodeMedia(big, {
      episodeId: "ep1",
      upload: okUpload,
      createUploadUrl: vi.fn(async () => ({
        ok: true,
        uploadUrl: "https://signed/upload",
        path: "u1/uploads/restyle-v2/video/ep1.mp4",
      })),
      signReadUrl: vi.fn(async () => ({ ok: true, url: "https://signed/read.mp4" })),
      deps: makeDeps({ putBinary }),
    });
    const arg = putBinary.mock.calls[0][0];
    expect(typeof arg).not.toBe("string");
    expect(arg instanceof Blob).toBe(true);
    // 帧图仍走 base64 旧路径
    expect(okUpload.mock.calls[0][0].base64).toMatch(/^data:image\//);
  });

  it("超过 2GB 上限直接拒绝", async () => {
    const huge = fileWithSize(MAX_SOURCE_FILE_BYTES + 1);
    await expect(
      prepareEpisodeMedia(huge, { episodeId: "ep1", upload: okUpload, deps: makeDeps({}) }),
    ).rejects.toThrow("上限");
  });
});

describe("PCM/WAV 处理", () => {
  it("sliceUnitWav 边界：不足 0.5s 返回 null，正常区间长度正确", async () => {
    const rate = 16_000;
    const pcm = new Float32Array(110 * rate); // 110s
    const tiny = sliceUnitWav(pcm, {
      unitId: "u0", unitStartOffsetSec: 0, sourceStartSeconds: 0, durationSec: 0.4,
    });
    expect(tiny).toBeNull();

    const wav = sliceUnitWav(pcm, {
      unitId: "u1", unitStartOffsetSec: 0, sourceStartSeconds: 0, durationSec: 45,
    });
    expect(wav).not.toBeNull();
    expect(wav!.size).toBe(44 + 45 * rate * 2); // WAV 头 + 16bit PCM
  });

  it("encodeWavPcm16 头部字段正确", async () => {
    const wav = encodeWavPcm16(new Float32Array(16000));
    const buf = new Uint8Array(await wav.arrayBuffer());
    const magic = String.fromCharCode(buf[0], buf[1], buf[2], buf[3]);
    expect(magic).toBe("RIFF");
    expect(wav.type).toBe("audio/wav");
  });
});
