// ====================================================================
// planWindows 纯函数测试：窗切分边界 / 跨窗镜头归属 / 合并重排 / 短片直通
// ====================================================================
import { describe, expect, it } from "vitest";
import {
  mergeWindowSegments,
  PLAN_WINDOW_SEC,
  shotsInWindow,
  splitIntoWindows,
  type WindowedSegment,
} from "./planWindows";

describe("splitIntoWindows", () => {
  it("短片（≤90s）单窗直通", () => {
    expect(splitIntoWindows(60)).toEqual([{ index: 0, startMs: 0, endMs: 60_000 }]);
    expect(splitIntoWindows(90)).toEqual([{ index: 0, startMs: 0, endMs: 90_000 }]);
  });

  it("258s 切 3 窗，最后一窗右边界等于总时长", () => {
    const windows = splitIntoWindows(258);
    expect(windows).toEqual([
      { index: 0, startMs: 0, endMs: 90_000 },
      { index: 1, startMs: 90_000, endMs: 180_000 },
      { index: 2, startMs: 180_000, endMs: 258_000 },
    ]);
  });

  it("整除时不产生零长尾窗", () => {
    expect(splitIntoWindows(180)).toHaveLength(2);
    expect(splitIntoWindows(180)[1].endMs).toBe(180_000);
  });

  it("非正时长返回空数组", () => {
    expect(splitIntoWindows(0)).toEqual([]);
    expect(splitIntoWindows(-5)).toEqual([]);
  });
});

describe("shotsInWindow", () => {
  const shots = [
    { shotNo: "SC001", startMs: 0 },
    { shotNo: "SC002", startMs: 89_999 },
    { shotNo: "SC003", startMs: 90_000 },
    { shotNo: "SC004", startMs: 200_000 },
  ];
  const [w0, w1, w2] = splitIntoWindows(258);

  it("按 startMs 归属：边界镜头 startMs=90_000 归第二窗", () => {
    expect(shotsInWindow(shots, w0).map((s) => s.shotNo)).toEqual(["SC001", "SC002"]);
    expect(shotsInWindow(shots, w1).map((s) => s.shotNo)).toEqual(["SC003"]);
    expect(shotsInWindow(shots, w2).map((s) => s.shotNo)).toEqual(["SC004"]);
  });

  it("跨窗镜头（startMs 在窗内、endMs 越窗）归起始窗", () => {
    const crossing = [{ shotNo: "SC009", startMs: 85_000, endMs: 95_000 }];
    expect(shotsInWindow(crossing, w0)).toHaveLength(1);
    expect(shotsInWindow(crossing, w1)).toHaveLength(0);
  });
});

describe("mergeWindowSegments", () => {
  const seg = (id: string, startMs?: number, endMs?: number): WindowedSegment => ({
    id,
    prompt: `分段${id}`,
    startMs,
    endMs,
  });
  const [w0, w1] = splitIntoWindows(180);

  it("跨窗按时间排序并 U01 起全局重排段号", () => {
    const { segments, warnings } = mergeWindowSegments(
      [
        { window: w1, segments: [seg("U01", 90_000, 100_000), seg("U02", 100_000, 115_000)] },
        { window: w0, segments: [seg("U01", 0, 12_000), seg("U02", 12_000, 30_000)] },
      ],
      11,
    );
    expect(segments.map((s) => s.id)).toEqual(["U01", "U02", "U03", "U04"]);
    expect(segments.map((s) => s.startMs)).toEqual([0, 12_000, 90_000, 100_000]);
    expect(warnings).toEqual([]);
  });

  it("越出窗边界的分段夹取到窗边界并记 warning", () => {
    const { segments, warnings } = mergeWindowSegments(
      [{ window: w0, segments: [seg("U01", 0, 95_000)] }],
      11,
    );
    expect(segments[0].endMs).toBe(90_000);
    expect(warnings.some((w) => w.includes("越出窗边界"))).toBe(true);
  });

  it("完全越出窗边界的分段丢弃并记 warning", () => {
    const { segments, warnings } = mergeWindowSegments(
      [{ window: w0, segments: [seg("U01", 0, 10_000), seg("U02", 95_000, 100_000)] }],
      11,
    );
    expect(segments).toHaveLength(1);
    expect(warnings.some((w) => w.includes("已丢弃"))).toBe(true);
  });

  it("窗内段数超动态上限截取并记 warning", () => {
    const many = Array.from({ length: 15 }, (_, i) => seg(`U${i + 1}`, i * 1000, i * 1000 + 900));
    const { segments, warnings } = mergeWindowSegments([{ window: w0, segments: many }], 11);
    expect(segments).toHaveLength(11);
    expect(warnings.some((w) => w.includes("超过上限 11"))).toBe(true);
  });

  it("无区间段排在所属窗带区间段之后，仍参与全局重排", () => {
    const { segments } = mergeWindowSegments(
      [{ window: w0, segments: [seg("U01"), seg("U02", 0, 10_000)] }],
      11,
    );
    expect(segments[0]).toMatchObject({ id: "U01", startMs: 0 });
    expect(segments[1]).toMatchObject({ id: "U02", prompt: "分段U01" });
    expect(segments[1].startMs).toBeUndefined();
  });

  it("单窗直通等价于原单次产出（只做夹取与重排）", () => {
    const single = splitIntoWindows(60)[0];
    const { segments, warnings } = mergeWindowSegments(
      [{ window: single, segments: [seg("U07", 0, 12_000), seg("U09", 12_000, 30_000)] }],
      Math.max(30, Math.ceil(60 / 10) + 2),
    );
    expect(segments.map((s) => s.id)).toEqual(["U01", "U02"]);
    expect(warnings).toEqual([]);
  });
});
