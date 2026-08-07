// ====================================================================
// planWindowDriver 测试：窗任务驱动（重试/跳过/全败/按集合并/进度/中止）
// ====================================================================
import { describe, expect, it } from "vitest";
import type { PlanWindowJob, WindowedSegment } from "@/lib/restyle/planWindows";
import { driveWindowedPlanCalls } from "../planWindowDriver";

function makeJobs(): PlanWindowJob[] {
  return [
    {
      videoId: "v1",
      durationMs: 258_000,
      window: { index: 0, startMs: 0, endMs: 90_000 },
      windowCount: 3,
    },
    {
      videoId: "v1",
      durationMs: 258_000,
      window: { index: 1, startMs: 90_000, endMs: 180_000 },
      windowCount: 3,
    },
    {
      videoId: "v1",
      durationMs: 258_000,
      window: { index: 2, startMs: 180_000, endMs: 258_000 },
      windowCount: 3,
    },
  ];
}

function seg(startMs: number, endMs: number): WindowedSegment {
  return { id: "U01", prompt: `分段 ${startMs}-${endMs}`, startMs, endMs };
}

describe("driveWindowedPlanCalls", () => {
  it("全部成功：按集合并重排段号，进度逐窗播报", async () => {
    const progress: string[] = [];
    const result = await driveWindowedPlanCalls({
      jobs: makeJobs(),
      callWindow: async (job) => ({
        ok: true as const,
        segments: [seg(job.window.startMs, job.window.startMs + 10_000)],
      }),
      onProgress: (done, total) => progress.push(`${done}/${total}`),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const segments = result.segmentsByVideo["v1"];
    expect(segments.map((s) => s.id)).toEqual(["U01", "U02", "U03"]);
    expect(segments.map((s) => s.startMs)).toEqual([0, 90_000, 180_000]);
    expect(result.warnings).toEqual([]);
    expect(progress).toEqual(["1/3", "2/3", "3/3"]);
  });

  it("单窗第一次失败会重试，第二次成功则不计 warning", async () => {
    let calls = 0;
    const result = await driveWindowedPlanCalls({
      jobs: makeJobs().slice(0, 1),
      callWindow: async (job) => {
        calls += 1;
        if (calls === 1) return { ok: false as const, error: "HTTP 500" };
        return { ok: true as const, segments: [seg(job.window.startMs, job.window.endMs)] };
      },
    });
    expect(calls).toBe(2);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.warnings).toEqual([]);
  });

  it("单窗两次都失败：记 warning 继续，缺口交覆盖兜底", async () => {
    const jobs = makeJobs().slice(0, 2);
    const result = await driveWindowedPlanCalls({
      jobs,
      callWindow: async (job) =>
        job.window.index === 0
          ? ({ ok: true as const, segments: [seg(0, 90_000)] })
          : ({ ok: false as const, error: "方案生成超时" }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.segmentsByVideo["v1"]).toHaveLength(1);
    expect(result.warnings.some((w) => w.includes("第 2/3 窗生成失败（方案生成超时）"))).toBe(true);
    // 失败窗透出给调用方做断连退款对账（D6）
    expect(result.failedJobs.map((j) => j.window.index)).toEqual([1]);
  });

  it("某集全部窗失败：该集给空分段并记占位 warning，其他集照常", async () => {
    const jobs: PlanWindowJob[] = [
      ...makeJobs().slice(0, 1),
      {
        videoId: "v2",
        durationMs: 200_000,
        window: { index: 0, startMs: 0, endMs: 90_000 },
        windowCount: 1,
      },
    ];
    const result = await driveWindowedPlanCalls({
      jobs,
      callWindow: async (job) =>
        job.videoId === "v1"
          ? ({ ok: false as const, error: "HTTP 500" })
          : ({ ok: true as const, segments: [seg(0, 90_000)] }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.segmentsByVideo["v1"]).toBeUndefined();
    expect(result.segmentsByVideo["v2"]).toHaveLength(1);
    expect(result.warnings.some((w) => w.includes("「v1」全部时间窗未产出分段"))).toBe(true);
  });

  it("全部窗失败：整体报错（不用兜底掩盖渠道故障）", async () => {
    const result = await driveWindowedPlanCalls({
      jobs: makeJobs().slice(0, 2),
      callWindow: async () => ({ ok: false as const, error: "HTTP 502" }),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("HTTP 502");
  });

  it("中止：停在当前窗，已完成的窗照常合并", async () => {
    let done = 0;
    const result = await driveWindowedPlanCalls({
      jobs: makeJobs(),
      isAborted: () => done >= 1,
      callWindow: async (job) => {
        done += 1;
        return { ok: true as const, segments: [seg(job.window.startMs, job.window.endMs)] };
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.segmentsByVideo["v1"]).toHaveLength(1);
  });
});
