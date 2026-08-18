import { describe, expect, it, vi } from "vitest";
import {
  clampSegmentRange,
  ensureSegmentReferenceClip,
  estimateSourceDurationMs,
  rangesFromSceneGroups,
  resolveSegmentTimeRange,
  trimCacheKey,
  withBackoffRetry,
  type TrimPollResult,
  type TrimSubmitResult,
} from "./segmentReference";
import type { DirectionShot } from "./cameraDirection";

function shot(
  startMs: number,
  endMs: number,
  shotNo = `SC${startMs}`,
  scene = "客厅",
): DirectionShot {
  return { shotNo, startMs, endMs, scene, shotType: "中景", emotion: "中性" };
}

// 8 镜 × 15s = 120s 原片
const SHOTS: DirectionShot[] = Array.from({ length: 8 }, (_, i) =>
  shot(i * 15_000, (i + 1) * 15_000, `SC00${i + 1}`),
);

// 多场景逐镜表：客厅 0–12s（2 镜）→ 街道 12–24s（2 镜）→ 卧室 24–30s（1 镜）
const MULTI_SCENE_SHOTS: DirectionShot[] = [
  shot(0, 6_000, "SC001", "客厅"),
  shot(6_000, 12_000, "SC002", "客厅"),
  shot(12_000, 18_000, "SC003", "街道"),
  shot(18_000, 24_000, "SC004", "街道"),
  shot(24_000, 30_000, "SC005", "卧室"),
];

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

describe("rangesFromSceneGroups · 场景优先分组", () => {
  it("多场景逐镜表：分段边界全部落在场景切换处，无场景中间切", () => {
    const ranges = rangesFromSceneGroups(MULTI_SCENE_SHOTS, 3);
    expect(ranges).toHaveLength(3);
    expect(ranges[0]).toMatchObject({
      startMs: 0,
      endMs: 12_000,
      scene: "客厅",
      firstShotNo: "SC001",
      lastShotNo: "SC002",
    });
    expect(ranges[1]).toMatchObject({
      startMs: 12_000,
      endMs: 24_000,
      scene: "街道",
      firstShotNo: "SC003",
      lastShotNo: "SC004",
    });
    expect(ranges[2]).toMatchObject({
      startMs: 24_000,
      endMs: 30_000,
      scene: "卧室",
      firstShotNo: "SC005",
      lastShotNo: "SC005",
    });
    // 每个分段边界（12s、24s）都是场景切换点；组内不出现第二个场景。
    for (const range of ranges) expect(range.scene).not.toContain("/");
  });

  it("单场景长段不被拆分：分段边界保持完整，仅参考区间被裁到 30s", () => {
    const ranges = rangesFromSceneGroups([shot(0, 45_000, "SC001", "仓库")], 1);
    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toMatchObject({
      startMs: 0,
      endMs: 30_000, // clampSegmentRange 只裁参考视频代表性区间
      scene: "仓库",
      firstShotNo: "SC001",
      lastShotNo: "SC001",
    });
  });

  it("尾部短段并入前组，不单独成段", () => {
    const ranges = rangesFromSceneGroups(
      [
        shot(0, 6_000, "SC001", "客厅"),
        shot(6_000, 12_000, "SC002", "客厅"),
        shot(12_000, 18_000, "SC003", "街道"),
        shot(18_000, 24_000, "SC004", "街道"),
        shot(24_000, 26_000, "SC005", "卧室"), // 2s 不足最短时长，并入前组
      ],
      3,
    );
    expect(ranges).toHaveLength(2);
    expect(ranges[1]).toMatchObject({
      startMs: 12_000,
      endMs: 26_000,
      scene: "街道 / 卧室",
      firstShotNo: "SC003",
      lastShotNo: "SC005",
    });
  });

  it("空逐镜表 / 非法分段数返回空数组", () => {
    expect(rangesFromSceneGroups([], 3)).toEqual([]);
    expect(rangesFromSceneGroups(MULTI_SCENE_SHOTS, 0)).toEqual([]);
  });
});

describe("resolveSegmentTimeRange · 两级推算（无均分兜底）", () => {
  it("模型显式区间优先，且会被夹取", () => {
    expect(
      resolveSegmentTimeRange({
        segmentId: "U01",
        explicit: { startMs: 0, endMs: 90_000 },
        shots: MULTI_SCENE_SHOTS,
        segmentCount: 3,
      }),
    ).toEqual({ startMs: 0, endMs: 30_000 });
  });

  it("显式区间非法 → 场景分组推算", () => {
    expect(
      resolveSegmentTimeRange({
        segmentId: "U02",
        explicit: { startMs: 50_000, endMs: 10_000 },
        shots: MULTI_SCENE_SHOTS,
        segmentCount: 3,
      }),
    ).toEqual({ startMs: 12_000, endMs: 24_000 });
  });

  it("缺失显式区间 → 场景分组推算", () => {
    expect(
      resolveSegmentTimeRange({ segmentId: "U03", shots: MULTI_SCENE_SHOTS, segmentCount: 3 }),
    ).toEqual({ startMs: 24_000, endMs: 30_000 });
  });

  it("无逐镜表 → undefined（降级路径，不再均分原片时长）", () => {
    expect(resolveSegmentTimeRange({ segmentId: "U01", segmentCount: 4 })).toBeUndefined();
    expect(
      resolveSegmentTimeRange({ segmentId: "U02", shots: [], segmentCount: 4 }),
    ).toBeUndefined();
  });

  it("分段序号超出场景组数 → undefined", () => {
    expect(
      resolveSegmentTimeRange({ segmentId: "U05", shots: MULTI_SCENE_SHOTS, segmentCount: 5 }),
    ).toBeUndefined();
  });

  it("segmentId 无法解析且没有显式区间 → undefined", () => {
    expect(
      resolveSegmentTimeRange({
        segmentId: "分段一",
        shots: MULTI_SCENE_SHOTS,
        segmentCount: 3,
      }),
    ).toBeUndefined();
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
  it("v2|sourceId|startMs|endMs 格式，同一片段键稳定", () => {
    expect(trimCacheKey("src-1", 0, 12_400)).toBe("v2|src-1|0|12400");
    expect(trimCacheKey("src-1", 0, 12_400)).toBe(trimCacheKey("src-1", 0, 12_400));
    expect(trimCacheKey("src-1", 0, 12_400)).not.toBe(trimCacheKey("src-2", 0, 12_400));
  });

  it("v2 版本隔离：2026-08-16 前流复制 bug 的旧缓存键（无版本前缀）全部失效重裁", () => {
    // 旧格式 `src-1|0|12400` 与新键不同 → 旧片段元数据（nb_frames 不可信）不再复用
    expect(trimCacheKey("src-1", 0, 12_400)).not.toBe("src-1|0|12400");
    expect(trimCacheKey("src-1", 0, 12_400).startsWith("v2|")).toBe(true);
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
