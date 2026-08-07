// ====================================================================
// ensureFullCoverage 纯函数测试：全覆盖 / 中段缺口 / 尾段缺口 / 重叠 / 越界 / 长片
// ====================================================================
import { describe, expect, it } from "vitest";
import type { DirectionShot } from "./cameraDirection";
import {
  ensureFullCoverage,
  MAX_COVERAGE_SEGMENT_MS,
  type CoverageEpisode,
} from "./ensureFullCoverage";

/** 构造覆盖 [0, durationMs] 的等长镜头序列（默认 4s 一镜）。 */
function makeShots(durationMs: number, shotMs = 4_000): DirectionShot[] {
  const shots: DirectionShot[] = [];
  let index = 1;
  for (let start = 0; start < durationMs; start += shotMs) {
    shots.push({
      shotNo: `SC${String(index).padStart(3, "0")}`,
      startMs: start,
      endMs: Math.min(start + shotMs, durationMs),
      scene: "客厅",
      shotType: "中景",
      emotion: "中性",
      action: `镜头${index}动作`,
    });
    index += 1;
  }
  return shots;
}

function makeEpisode(segments: CoverageEpisode["segments"]): CoverageEpisode {
  return { episode: "video-1", segments };
}

function seg(id: string, startMs: number, endMs: number): CoverageEpisode["segments"][number] {
  return { id, prompt: `分段${id}提示词`, startMs, endMs };
}

const constantDuration = (durationMs: number) => () => durationMs;

/** 断言分段链式连续覆盖 [0, durationMs]：首段 0 起、末段到头、相邻首尾相接。 */
function expectContinuousCoverage(episode: CoverageEpisode, durationMs: number) {
  const segments = episode.segments
    .filter((s) => typeof s.startMs === "number" && typeof s.endMs === "number")
    .sort((a, b) => a.startMs! - b.startMs!);
  expect(segments.length).toBeGreaterThan(0);
  expect(segments[0].startMs).toBe(0);
  for (let i = 0; i + 1 < segments.length; i += 1) {
    expect(segments[i].endMs).toBe(segments[i + 1].startMs);
  }
  expect(segments[segments.length - 1].endMs).toBe(durationMs);
}

describe("ensureFullCoverage", () => {
  it("已全覆盖：原样返回，无 warning", () => {
    const episode = makeEpisode([seg("U01", 0, 10_000), seg("U02", 10_000, 20_000)]);
    const { episodes, warnings } = ensureFullCoverage(
      [episode],
      makeShots(20_000),
      constantDuration(20_000),
    );
    expect(episodes[0]).toEqual(episode);
    expect(warnings).toEqual([]);
  });

  it("中段缺口：用落在缺口的镜头补段，补后链式连续覆盖", () => {
    const episode = makeEpisode([seg("U01", 0, 8_000), seg("U02", 20_000, 28_000)]);
    const { episodes, warnings } = ensureFullCoverage(
      [episode],
      makeShots(28_000),
      constantDuration(28_000),
    );
    expectContinuousCoverage(episodes[0], 28_000);
    // 缺口 8s–20s 内 3 个镜头（8-12/12-16/16-20）被打包成补段
    const filler = episodes[0].segments.find((s) => s.prompt.includes("自动补齐"));
    expect(filler).toBeDefined();
    expect(filler!.prompt).toContain("SC003");
    expect(warnings.some((w) => w.includes("已自动补齐未覆盖区间"))).toBe(true);
    // 结构改动后段号按时间轴重排
    expect(episodes[0].segments.map((s) => s.id)).toEqual(["U01", "U02", "U03"]);
  });

  it("尾段缺口：补段覆盖到 durationMs", () => {
    const episode = makeEpisode([seg("U01", 0, 10_000)]);
    const { episodes, warnings } = ensureFullCoverage(
      [episode],
      makeShots(24_000),
      constantDuration(24_000),
    );
    expectContinuousCoverage(episodes[0], 24_000);
    expect(episodes[0].segments.length).toBeGreaterThan(1);
    expect(warnings.some((w) => w.includes("已自动补齐未覆盖区间"))).toBe(true);
  });

  it("首部缺口：从 0 开始补段", () => {
    const episode = makeEpisode([seg("U01", 12_000, 20_000)]);
    const { episodes } = ensureFullCoverage(
      [episode],
      makeShots(20_000),
      constantDuration(20_000),
    );
    expectContinuousCoverage(episodes[0], 20_000);
  });

  it("重叠：后段起点夹到前段终点，退化段移除", () => {
    const episode = makeEpisode([
      seg("U01", 0, 12_000),
      seg("U02", 8_000, 20_000), // 与 U01 重叠 4s
    ]);
    const { episodes, warnings } = ensureFullCoverage(
      [episode],
      makeShots(20_000),
      constantDuration(20_000),
    );
    expectContinuousCoverage(episodes[0], 20_000);
    expect(warnings.some((w) => w.includes("重叠"))).toBe(true);

    const degenerate = makeEpisode([
      seg("U01", 0, 12_000),
      seg("U02", 4_000, 8_000), // 完全落在 U01 内，修正后时长 <= 0
      seg("U03", 12_000, 20_000),
    ]);
    const result = ensureFullCoverage([degenerate], makeShots(20_000), constantDuration(20_000));
    expectContinuousCoverage(result.episodes[0], 20_000);
    expect(result.episodes[0].segments).toHaveLength(2);
    expect(result.warnings.some((w) => w.includes("已移除"))).toBe(true);
  });

  it("越界：负起点与超时长终点夹取到 [0, durationMs]", () => {
    const episode = makeEpisode([seg("U01", -5_000, 10_000), seg("U02", 10_000, 99_000)]);
    const { episodes, warnings } = ensureFullCoverage(
      [episode],
      makeShots(20_000),
      constantDuration(20_000),
    );
    expectContinuousCoverage(episodes[0], 20_000);
    expect(warnings.some((w) => w.includes("夹取到边界"))).toBe(true);
  });

  it("缺口内无镜头：按 15s 上限直接切补", () => {
    // 逐镜表只覆盖前 8s，缺口 8s–40s 无任何镜头
    const episode = makeEpisode([seg("U01", 0, 8_000)]);
    const { episodes, warnings } = ensureFullCoverage(
      [episode],
      makeShots(8_000),
      constantDuration(40_000),
    );
    expectContinuousCoverage(episodes[0], 40_000);
    const fillers = episodes[0].segments.filter((s) => s.prompt.includes("自动补齐"));
    // 32s 缺口按 15s 上限切成 3 段，每段 ≤15s
    expect(fillers).toHaveLength(3);
    for (const filler of fillers) {
      expect(filler.endMs! - filler.startMs!).toBeLessThanOrEqual(MAX_COVERAGE_SEGMENT_MS);
    }
    expect(warnings.some((w) => w.includes("无对应镜头"))).toBe(true);
  });

  it("30+ 段长片（600s / 150 镜）：模型只覆盖前 60s，补段后全集连续覆盖", () => {
    const durationMs = 600_000;
    const episode = makeEpisode([
      seg("U01", 0, 12_000),
      seg("U02", 12_000, 27_000),
      seg("U03", 27_000, 45_000),
      seg("U04", 45_000, 60_000),
    ]);
    const { episodes, warnings } = ensureFullCoverage(
      [episode],
      makeShots(durationMs),
      constantDuration(durationMs),
    );
    expectContinuousCoverage(episodes[0], durationMs);
    // 补齐后总段数远超 30，补段均不超过 15s（镜头边界优先）
    expect(episodes[0].segments.length).toBeGreaterThan(30);
    const fillers = episodes[0].segments.filter((s) => s.prompt.includes("自动补齐"));
    expect(fillers.length).toBeGreaterThan(30);
    for (const filler of fillers) {
      expect(filler.endMs! - filler.startMs!).toBeLessThanOrEqual(MAX_COVERAGE_SEGMENT_MS);
    }
    expect(warnings.some((w) => w.includes("已自动补齐未覆盖区间"))).toBe(true);
  });

  it("拿不到权威时长：原样返回，不做猜测性修正", () => {
    const episode = makeEpisode([seg("U01", 0, 10_000)]);
    const { episodes, warnings } = ensureFullCoverage([episode], makeShots(20_000), () => undefined);
    expect(episodes[0]).toEqual(episode);
    expect(warnings).toEqual([]);
  });

  it("无区间分段：原样保留在带区间分段之后（20s 段按上限切分为 2×10s）", () => {
    const episode = makeEpisode([
      seg("U01", 0, 20_000),
      { id: "U02", prompt: "模型没给时间区间的分段" },
    ]);
    const { episodes } = ensureFullCoverage(
      [episode],
      makeShots(20_000),
      constantDuration(20_000),
    );
    // 20s 带区间段按 15s 上限均分切成 2 段，无区间段仍排最后
    expect(episodes[0].segments).toHaveLength(3);
    expect(episodes[0].segments[2].prompt).toBe("模型没给时间区间的分段");
  });
});


// --------------------------------------------------------------------
// 单段 >15s 强制二次切分（D2 回归：30s 摘要粒度单镜直接成段）
// --------------------------------------------------------------------

describe("ensureFullCoverage 单段时长上限后处理", () => {
  it("30s 单段（单长镜）均分切成 2×15s，prompt 继承原段", () => {
    // 30s 一个镜头的逐镜表：补段「不切镜头」会产生 30s 段，后处理必须切开
    const shots: DirectionShot[] = [
      {
        shotNo: "SC001",
        startMs: 0,
        endMs: 30_000,
        scene: "客厅",
        shotType: "全景",
        emotion: "中性",
      },
    ];
    const episode = makeEpisode([seg("U01", 0, 30_000)]);
    const { episodes, warnings } = ensureFullCoverage([episode], shots, constantDuration(30_000));
    const segments = episodes[0].segments;
    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({ id: "U01", startMs: 0, endMs: 15_000 });
    expect(segments[1]).toMatchObject({ id: "U02", startMs: 15_000, endMs: 30_000 });
    expect(segments[0].prompt).toBe(segments[1].prompt);
    expect(warnings.some((w) => w.includes("超过 15s 上限，已均分切为 2 段"))).toBe(true);
  });

  it("45s 段切成 3 段，链式连续无缺口", () => {
    const episode = makeEpisode([seg("U01", 0, 45_000)]);
    const { episodes } = ensureFullCoverage([episode], [], constantDuration(45_000));
    const segments = episodes[0].segments;
    expect(segments).toHaveLength(3);
    for (const segment of segments) {
      expect(segment.endMs! - segment.startMs!).toBeLessThanOrEqual(MAX_COVERAGE_SEGMENT_MS);
    }
    expectContinuousCoverage(episodes[0], 45_000);
  });

  it("14.9s 段不动：原样返回、无 warning", () => {
    const episode = makeEpisode([seg("U01", 0, 14_900)]);
    const { episodes, warnings } = ensureFullCoverage([episode], [], constantDuration(14_900));
    expect(episodes[0]).toEqual(episode);
    expect(warnings).toEqual([]);
  });

  it("混合场景：30s 段 + 尾段缺口，补段后整集链式连续且全部 ≤15s", () => {
    const shots = makeShots(40_000);
    const episode = makeEpisode([seg("U01", 0, 30_000)]);
    const { episodes } = ensureFullCoverage([episode], shots, constantDuration(40_000));
    expectContinuousCoverage(episodes[0], 40_000);
    for (const segment of episodes[0].segments) {
      expect(segment.endMs! - segment.startMs!).toBeLessThanOrEqual(MAX_COVERAGE_SEGMENT_MS);
    }
  });
});
