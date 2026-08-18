// ====================================================================
// mp4Probe 测试：合成最小 mp4 字节覆盖解析与裁剪产物自检
// ====================================================================
import { describe, expect, it } from "vitest";
import { probeMp4Metadata, verifyTrimmedClipMeta } from "../mp4Probe";

const u32 = (v: number) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
const u64 = (v: number) => [...u32(Math.floor(v / 2 ** 32)), ...u32(v >>> 0)];
const ascii = (s: string) => s.split("").map((c) => c.charCodeAt(0));

function box(type: string, content: number[]): number[] {
  const size = 8 + content.length;
  return [...u32(size), ...ascii(type), ...content];
}

/** 64 位 largesize 形态的 box */
function box64(type: string, content: number[]): number[] {
  const size = 16 + content.length;
  return [...u32(1), ...ascii(type), ...u64(size), ...content];
}

/** mdhd v0:version/flags + creation + modification + timescale + duration */
function mdhdV0(timescale: number, duration: number): number[] {
  return box("mdhd", [0, 0, 0, 0, ...u32(0), ...u32(0), ...u32(timescale), ...u32(duration)]);
}

/** mdhd v1:creation/modification 8 字节,duration 8 字节 */
function mdhdV1(timescale: number, duration: number): number[] {
  return box("mdhd", [
    1, 0, 0, 0,
    ...u64(0),
    ...u64(0),
    ...u32(timescale),
    ...u64(duration),
  ]);
}

const hdlrVide = box("hdlr", [0, 0, 0, 0, ...u32(0), ...ascii("vide"), ...u32(0), ...u32(0), ...u32(0), 0]);

const stts = (frameCount: number) =>
  box("stts", [0, 0, 0, 0, ...u32(1), ...u32(frameCount), ...u32(3000)]);
const stsz = (sampleCount: number) => box("stsz", [0, 0, 0, 0, ...u32(0), ...u32(sampleCount)]);

function buildMp4(input: {
  timescale?: number;
  duration?: number;
  declared: number;
  actual: number;
  mdhdVersion?: 0 | 1;
  moov64?: boolean;
}): ArrayBuffer {
  const mdhd = input.mdhdVersion === 1
    ? mdhdV1(input.timescale ?? 1000, input.duration ?? 10_000)
    : mdhdV0(input.timescale ?? 1000, input.duration ?? 10_000);
  const stbl = box("stbl", [...stts(input.declared), ...stsz(input.actual)]);
  const minf = box("minf", stbl);
  const mdia = box("mdia", [...mdhd, ...hdlrVide, ...minf]);
  const trak = box("trak", mdia);
  const mvhd = box("mvhd", new Array(100).fill(0));
  const moovContent = [...mvhd, ...trak];
  const moov = input.moov64 ? box64("moov", moovContent) : box("moov", moovContent);
  const ftyp = box("ftyp", [...ascii("isom"), ...u32(0), ...ascii("isom")]);
  return new Uint8Array([...ftyp, ...moov]).buffer;
}

describe("probeMp4Metadata", () => {
  it("解析视频轨:时长/声明帧数/实际帧数/fps", () => {
    const meta = probeMp4Metadata(buildMp4({ declared: 300, actual: 300 }));
    expect(meta).not.toBeNull();
    expect(meta!.durationSec).toBe(10);
    expect(meta!.declaredFrames).toBe(300);
    expect(meta!.actualFrames).toBe(300);
    expect(meta!.fps).toBe(30);
  });

  it("mdhd v1 与 64 位 box 同样可解析", () => {
    const v1 = probeMp4Metadata(buildMp4({ declared: 150, actual: 150, mdhdVersion: 1 }));
    expect(v1!.durationSec).toBe(10);
    expect(v1!.declaredFrames).toBe(150);
    const wide = probeMp4Metadata(buildMp4({ declared: 60, actual: 60, moov64: true }));
    expect(wide!.declaredFrames).toBe(60);
  });

  it("非 mp4 / 截断数据返回 null（不抛异常）", () => {
    expect(probeMp4Metadata(new Uint8Array([1, 2, 3, 4, 5]).buffer)).toBeNull();
    const truncated = buildMp4({ declared: 10, actual: 10 }).slice(0, 40);
    expect(probeMp4Metadata(truncated)).toBeNull();
  });
});

describe("verifyTrimmedClipMeta（裁剪产物入库前自检）", () => {
  it("正常片段通过", () => {
    const verdict = verifyTrimmedClipMeta(buildMp4({ declared: 300, actual: 300 }), 10);
    expect(verdict.ok).toBe(true);
  });

  it("nb_frames 虚高（声明 556/实际 327,流复制 bug 形态）判不一致", () => {
    const verdict = verifyTrimmedClipMeta(buildMp4({ declared: 556, actual: 327 }), 10);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.error).toContain("声明 556 帧");
      expect(verdict.error).toContain("327");
    }
  });

  it("小幅偏差（≤5 帧或 2%）容忍通过", () => {
    expect(verifyTrimmedClipMeta(buildMp4({ declared: 303, actual: 300 }), 10).ok).toBe(true);
  });

  it("元数据时长与名义区间严重不符判不一致", () => {
    const verdict = verifyTrimmedClipMeta(buildMp4({ declared: 360, actual: 360, duration: 12_000 }), 10);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.error).toContain("时长异常");
  });

  it("解析失败按「不可判定」放行（不阻断）", () => {
    const verdict = verifyTrimmedClipMeta(new Uint8Array([9, 9, 9]).buffer, 10);
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.uncertain).toBe(true);
  });
});
