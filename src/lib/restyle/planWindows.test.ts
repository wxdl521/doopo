// ====================================================================
// planWindows 纯函数测试：窗切分边界 / 跨窗镜头归属 / 合并重排 / 短片直通
// ====================================================================
import { describe, expect, it } from "vitest";
import {
  applyPlanCoverage,
  buildPlanWindowJobs,
  mergeWindowSegments,
  PLAN_WINDOW_SEC,
  shotsInWindow,
  splitIntoWindows,
  summarizeWindowCalls,
  windowFailureAction,
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


// --------------------------------------------------------------------
// buildPlanWindowJobs / windowFailureAction / summarizeWindowCalls / applyPlanCoverage
// --------------------------------------------------------------------

describe("buildPlanWindowJobs", () => {
  it("长片逐集切窗、短片单窗直通、未知时长不产生任务", () => {
    const jobs = buildPlanWindowJobs([
      { videoId: "long", durationMs: 258_000 },
      { videoId: "short", durationMs: 60_000 },
      { videoId: "unknown" },
    ]);
    expect(jobs).toHaveLength(4);
    expect(jobs.filter((j) => j.videoId === "long").map((j) => j.windowCount)).toEqual([3, 3, 3]);
    expect(jobs.filter((j) => j.videoId === "short")).toHaveLength(1);
    expect(jobs.some((j) => j.videoId === "unknown")).toBe(false);
    // 窗按集内序号连续、首尾相接
    const longWindows = jobs.filter((j) => j.videoId === "long").map((j) => j.window);
    expect(longWindows[0].startMs).toBe(0);
    expect(longWindows[2].endMs).toBe(258_000);
  });
});

describe("windowFailureAction", () => {
  it("第一次失败重试，第二次起跳过", () => {
    expect(windowFailureAction(1)).toBe("retry");
    expect(windowFailureAction(2)).toBe("skip");
    expect(windowFailureAction(3)).toBe("skip");
  });
});

describe("summarizeWindowCalls", () => {
  const job = (videoId: string, index: number, windowCount: number) => ({
    videoId,
    durationMs: 258_000,
    window: { index, startMs: index * 90_000, endMs: (index + 1) * 90_000 },
    windowCount,
  });

  it("全部成功：无 warning、非全败", () => {
    const summary = summarizeWindowCalls([
      { job: job("v1", 0, 2), ok: true, segments: [] },
      { job: job("v1", 1, 2), ok: true, segments: [] },
    ]);
    expect(summary.allFailed).toBe(false);
    expect(summary.warnings).toEqual([]);
  });

  it("部分失败：继续并逐失败窗记 warning", () => {
    const summary = summarizeWindowCalls([
      { job: job("v1", 0, 2), ok: true, segments: [] },
      { job: job("v1", 1, 2), ok: false, error: "HTTP 500" },
    ]);
    expect(summary.allFailed).toBe(false);
    expect(summary.warnings).toHaveLength(1);
    expect(summary.warnings[0]).toContain("第 2/2 窗生成失败（HTTP 500）");
    expect(summary.warnings[0]).toContain("覆盖兜底补段");
  });

  it("全部失败：allFailed（整体报错，不用兜底掩盖渠道故障）", () => {
    const summary = summarizeWindowCalls([
      { job: job("v1", 0, 2), ok: false, error: "超时" },
      { job: job("v1", 1, 2), ok: false, error: "超时" },
    ]);
    expect(summary.allFailed).toBe(true);
    expect(summary.warnings).toHaveLength(2);
  });
});

describe("applyPlanCoverage", () => {
  const shots = Array.from({ length: 5 }, (_, i) => ({
    shotNo: `SC${String(i + 1).padStart(3, "0")}`,
    startMs: i * 4000,
    endMs: i * 4000 + 4000,
    scene: "客厅",
    shotType: "中景" as const,
    emotion: "中性",
  }));

  it("显式区间优先 + 缺口由 ensureFullCoverage 补段", () => {
    const { episodes, warnings } = applyPlanCoverage(
      [
        {
          episode: "v1",
          segments: [{ id: "U01", prompt: "第一段", startMs: 0, endMs: 8000 }],
        },
      ],
      shots,
      () => 20_000,
    );
    const segments = episodes[0].segments;
    expect(segments[0]).toMatchObject({ startMs: 0, endMs: 8000 });
    // 尾部 8s–20s 缺口被补段覆盖
    expect(segments[segments.length - 1].endMs).toBe(20_000);
    expect(warnings.some((w) => w.includes("已自动补齐未覆盖区间"))).toBe(true);
  });

  it("无显式区间时按场景分组推算（>15s 场景拆多组，缺口由覆盖兜底补齐）", () => {
    const input: Array<{
      episode: string;
      segments: Array<{ id: string; prompt: string; startMs?: number; endMs?: number }>;
    }> = [{ episode: "v1", segments: [{ id: "U01", prompt: "唯一段" }] }];
    const { episodes } = applyPlanCoverage(input, shots, () => 20_000);
    const segments = episodes[0].segments;
    // 5 镜 ×4s=20s 的场景分组按 15s 上限拆成 [0,12s]+[12s,20s] 两组，U01 取第一组
    expect(segments[0].startMs).toBe(0);
    expect(segments[0].endMs).toBe(12_000);
    expect(segments[segments.length - 1].endMs).toBe(20_000);
  });
});
