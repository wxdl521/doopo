import { describe, expect, it, vi } from "vitest";
import {
  clampSegmentRange,
  ensureSegmentReferenceClip,
  estimateSourceDurationMs,
  rangeFromEvenSplit,
  rangeFromShots,
  resolveSegmentTimeRange,
  trimCacheKey,
  withBackoffRetry,
  type TrimPollResult,
  type TrimSubmitResult,
} from "./segmentReference";
import type { DirectionShot } from "./cameraDirection";

function shot(startMs: number, endMs: number, shotNo = `SC${startMs}`): DirectionShot {
  return { shotNo, startMs, endMs, scene: "客厅", shotType: "中景", emotion: "中性" };
}

// 8 镜 × 15s = 120s 原片
const SHOTS: DirectionShot[] = Array.from({ length: 8 }, (_, i) =>
  shot(i * 15_000, (i + 1) * 15_000, `SC00${i + 1}`),
);

describe("clampSegmentRange", () => {
  it("合法区间原样通过（取整）", () => {
    expect(clampSegmentRange(0, 12_400)).toEqual({ startMs: 0, endMs: 12_400 });
    expect(clampSegmentRange(1_000.4, 5_000.6)).toEqual({ startMs: 1_000, endMs: 5_001 });
  });

  it("超过 30 秒向后截断", () => {
    expect(clampSegmentRange(10_000, 80_000)).toEqual({ startMs: 10_000, endMs: 40_000 });
  });

  it("不足 1.8 秒向后补齐", () => {
    expect(clampSegmentRange(5_000, 5_500)).toEqual({ startMs: 5_000, endMs: 6_800 });
  });

  it("非法区间返回 undefined", () => {
    expect(clampSegmentRange(10_000, 10_000)).toBeUndefined();
    expect(clampSegmentRange(10_000, 9_000)).toBeUndefined();
    expect(clampSegmentRange(-1, 5_000)).toBeUndefined();
    expect(clampSegmentRange(Number.NaN, 5_000)).toBeUndefined();
  });
});

describe("rangeFromShots · 逐镜表就近推算", () => {
  it("8 镜 4 段：每段恰好 2 镜（30s，夹取上限内）", () => {
    expect(rangeFromShots(SHOTS, 0, 4)).toEqual({ startMs: 0, endMs: 30_000 });
    expect(rangeFromShots(SHOTS, 3, 4)).toEqual({ startMs: 90_000, endMs: 120_000 });
  });

  it("8 镜 8 段：每段 1 镜（15s）", () => {
    expect(rangeFromShots(SHOTS, 2, 8)).toEqual({ startMs: 30_000, endMs: 45_000 });
  });

  it("8 镜 2 段：每段 4 镜 60s，夹取截断到 30s", () => {
    expect(rangeFromShots(SHOTS, 1, 2)).toEqual({ startMs: 60_000, endMs: 90_000 });
  });

  it("空逐镜表 / 非法序号返回 undefined", () => {
    expect(rangeFromShots([], 0, 4)).toBeUndefined();
    expect(rangeFromShots(SHOTS, -1, 4)).toBeUndefined();
  });
});

describe("rangeFromEvenSplit · 均分兜底", () => {
  it("120s 原片 8 段：每段 15s", () => {
    expect(rangeFromEvenSplit(120_000, 3, 8)).toEqual({ startMs: 45_000, endMs: 60_000 });
  });

  it("分钟级原片分段跨度超 30s 时夹取截断", () => {
    expect(rangeFromEvenSplit(300_000, 0, 4)).toEqual({ startMs: 0, endMs: 30_000 });
  });

  it("非法时长返回 undefined", () => {
    expect(rangeFromEvenSplit(0, 0, 4)).toBeUndefined();
    expect(rangeFromEvenSplit(Number.NaN, 0, 4)).toBeUndefined();
  });
});

describe("resolveSegmentTimeRange · 三级推算", () => {
  it("模型显式区间优先，且会被夹取", () => {
    expect(
      resolveSegmentTimeRange({
        segmentId: "U01",
        explicit: { startMs: 0, endMs: 90_000 },
        shots: SHOTS,
        segmentCount: 4,
      }),
    ).toEqual({ startMs: 0, endMs: 30_000 });
  });

  it("显式区间非法 → 逐镜表就近推算", () => {
    expect(
      resolveSegmentTimeRange({
        segmentId: "U02",
        explicit: { startMs: 50_000, endMs: 10_000 },
        shots: SHOTS,
        segmentCount: 4,
      }),
    ).toEqual({ startMs: 30_000, endMs: 60_000 });
  });

  it("缺失显式区间 → 逐镜表就近推算", () => {
    expect(resolveSegmentTimeRange({ segmentId: "U04", shots: SHOTS, segmentCount: 4 })).toEqual({
      startMs: 90_000,
      endMs: 120_000,
    });
  });

  it("无逐镜表 → 按分段数均分原片时长", () => {
    expect(
      resolveSegmentTimeRange({
        segmentId: "U02",
        segmentCount: 4,
        sourceDurationMs: 120_000,
      }),
    ).toEqual({ startMs: 30_000, endMs: 60_000 });
  });

  it("segmentId 无法解析且没有显式区间 → undefined", () => {
    expect(
      resolveSegmentTimeRange({
        segmentId: "分段一",
        shots: SHOTS,
        segmentCount: 4,
        sourceDurationMs: 120_000,
      }),
    ).toBeUndefined();
  });

  it("什么都不可用 → undefined（调用方维持旧行为）", () => {
    expect(resolveSegmentTimeRange({ segmentId: "U01", segmentCount: 4 })).toBeUndefined();
  });
});

describe("estimateSourceDurationMs", () => {
  it("取最后一镜 endMs 作为原片时长", () => {
    expect(estimateSourceDurationMs(SHOTS)).toBe(120_000);
  });
  it("空逐镜表返回 undefined", () => {
    expect(estimateSourceDurationMs([])).toBeUndefined();
    expect(estimateSourceDurationMs(undefined)).toBeUndefined();
  });
});

describe("trimCacheKey", () => {
  it("sourceId|startMs|endMs 格式，同一片段键稳定", () => {
    expect(trimCacheKey("src-1", 0, 12_400)).toBe("src-1|0|12400");
    expect(trimCacheKey("src-1", 0, 12_400)).toBe(trimCacheKey("src-1", 0, 12_400));
    expect(trimCacheKey("src-1", 0, 12_400)).not.toBe(trimCacheKey("src-2", 0, 12_400));
  });
});

describe("withBackoffRetry", () => {
  const noSleep = () => Promise.resolve();

  it("首次成功不重试", async () => {
    const fn = vi.fn(async () => "ok");
    await expect(withBackoffRetry(fn, { sleep: noSleep })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("瞬时失败后退避 2 秒重试一次并成功", async () => {
    const sleep = vi.fn(noSleep);
    const impl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce("ok");
    await expect(withBackoffRetry(impl, { sleep })).resolves.toBe("ok");
    expect(impl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2_000);
  });

  it("重试仍失败则抛出", async () => {
    const impl = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(withBackoffRetry(impl, { sleep: noSleep })).rejects.toThrow("Failed to fetch");
    expect(impl).toHaveBeenCalledTimes(2);
  });
});

describe("ensureSegmentReferenceClip · runRenderQueue 裁剪三条路径", () => {
  const range = { startMs: 0, endMs: 12_400 };
  const noSleep = () => Promise.resolve();

  it("裁剪成功：提交 → 轮询 → 返回片段 URL", async () => {
    const submitTrim = vi.fn(async (): Promise<TrimSubmitResult> => ({ ok: true, jobId: "job-1" }));
    const pollTrim = vi
      .fn<() => Promise<TrimPollResult>>()
      .mockResolvedValueOnce({ ok: true, status: "queued" })
      .mockResolvedValueOnce({
        ok: true,
        status: "succeeded",
        videoUrl: "https://cdn.example.com/clip.mp4",
      });
    const result = await ensureSegmentReferenceClip({
      sourceUrl: "https://cdn.example.com/full.mp4",
      range,
      submitTrim,
      pollTrim,
      sleep: noSleep,
    });
    expect(result).toEqual({
      ok: true,
      url: "https://cdn.example.com/clip.mp4",
      fromCache: false,
    });
    expect(submitTrim).toHaveBeenCalledWith({
      url: "https://cdn.example.com/full.mp4",
      startMs: 0,
      endMs: 12_400,
    });
  });

  it("转码服务未配置：返回明确错误，调用方降级为不带参考视频提交", async () => {
    const result = await ensureSegmentReferenceClip({
      sourceUrl: "https://cdn.example.com/full.mp4",
      range,
      submitTrim: async () => ({
        ok: false,
        error:
          "外部转码服务未配置：请设置 TRANSCODE_API_URL 与 TRANSCODE_API_KEY 后再裁剪参考视频。",
      }),
      pollTrim: async () => ({ ok: false, status: "failed", error: "不应被调用" }),
      sleep: noSleep,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("未配置");
  });

  it("裁剪任务失败：返回错误供降级，不再让整段失败", async () => {
    const result = await ensureSegmentReferenceClip({
      sourceUrl: "https://cdn.example.com/full.mp4",
      range,
      submitTrim: async () => ({ ok: true, jobId: "job-1" }),
      pollTrim: async () => ({ ok: false, status: "failed", error: "转码任务失败" }),
      sleep: noSleep,
    });
    expect(result).toEqual({ ok: false, error: "转码任务失败" });
  });

  it("命中项目级缓存：不重复提交裁剪", async () => {
    const submitTrim = vi.fn(async (): Promise<TrimSubmitResult> => ({ ok: true, jobId: "job-1" }));
    const result = await ensureSegmentReferenceClip({
      sourceUrl: "https://cdn.example.com/full.mp4",
      range,
      cachedUrl: "https://cdn.example.com/cached-clip.mp4",
      submitTrim,
      pollTrim: async () => ({ ok: false, status: "failed", error: "不应被调用" }),
      sleep: noSleep,
    });
    expect(result).toEqual({
      ok: true,
      url: "https://cdn.example.com/cached-clip.mp4",
      fromCache: true,
    });
    expect(submitTrim).not.toHaveBeenCalled();
  });

  it("轮询超限返回超时错误", async () => {
    const result = await ensureSegmentReferenceClip({
      sourceUrl: "https://cdn.example.com/full.mp4",
      range,
      submitTrim: async () => ({ ok: true, jobId: "job-1" }),
      pollTrim: async () => ({ ok: true, status: "running" }),
      sleep: noSleep,
      maxPolls: 3,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("超时");
  });
});
