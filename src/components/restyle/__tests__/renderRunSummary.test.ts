// ====================================================================
// renderRunSummary 测试（队列收尾播报矛盾回归）：
// 本轮失败可见 / 跨 run 不串原因 / 成片口径 / 标签
// ====================================================================
import { describe, expect, it } from "vitest";
import {
  applyRunOutcomesToFiles,
  collectRerunEpisodes,
  episodeRestitchEligibility,
  outcomeLabel,
  summarizeRenderRun,
  type RenderRunOutcome,
} from "../renderRunSummary";

const clip = (overrides: Partial<RenderRunOutcome>): RenderRunOutcome => ({
  attachmentId: "a1",
  generatedKind: "video_clip",
  episode: "EP02",
  segmentId: "U02",
  ok: true,
  ...overrides,
});

describe("summarizeRenderRun", () => {
  it("本轮失败立即可见（不依赖 files 状态）：status=failed 且原因取自本轮", () => {
    const summary = summarizeRenderRun(
      [clip({ ok: false, error: "视频任务失败" })],
      { hasFinalVideos: false },
    );
    expect(summary.status).toBe("failed");
    expect(summary.failedOutcomes).toHaveLength(1);
    expect(summary.failedOutcomes[0].error).toBe("视频任务失败");
  });

  it("台账只含本轮记录：上一轮的历史错误不在输入即不串原因", () => {
    // 上一轮 U03 失败的残留不会出现在新一轮台账里（台账每 run 重置）
    const summary = summarizeRenderRun(
      [clip({ segmentId: "U01", ok: true, resultUrl: "https://cdn/u01.mp4" })],
      { hasFinalVideos: false },
    );
    expect(summary.status).toBe("succeeded");
    expect(summary.failedOutcomes).toEqual([]);
  });

  it("同一分段两轮重跑各自记账：新一轮失败照常判 failed", () => {
    const summary = summarizeRenderRun(
      [
        clip({ attachmentId: "run2", ok: false, error: "upstream 400" }),
      ],
      { hasFinalVideos: false },
    );
    expect(summary.status).toBe("failed");
    expect(summary.failedOutcomes[0].attachmentId).toBe("run2");
  });

  it("有整集合成任务：分段全成但成片未成功也判 failed", () => {
    const summary = summarizeRenderRun(
      [clip({ resultUrl: "https://cdn/u01.mp4" })],
      { hasFinalVideos: true },
    );
    expect(summary.status).toBe("failed");
    expect(summary.finalOk).toBe(false);
  });

  it("成片合成成功且有 URL：finalOk", () => {
    const summary = summarizeRenderRun(
      [
        clip({ resultUrl: "https://cdn/u01.mp4" }),
        clip({ generatedKind: "final_video", segmentId: undefined, resultUrl: "https://cdn/final.mp4" }),
      ],
      { hasFinalVideos: true },
    );
    expect(summary.status).toBe("succeeded");
    expect(summary.finalOk).toBe(true);
  });

  it("空台账（中止/未跑任何段）：succeeded 不报错", () => {
    expect(summarizeRenderRun([], { hasFinalVideos: false }).status).toBe("succeeded");
  });
});

describe("outcomeLabel", () => {
  it("集号+分段号拼接；缺省回退占位", () => {
    expect(outcomeLabel(clip({}))).toBe("EP02 U02");
    expect(outcomeLabel(clip({ episode: undefined, segmentId: undefined }))).toBe("该分段");
  });
});

describe("episodeRestitchEligibility（局部返工收尾补合成判定）", () => {
  const clipFile = (segmentId: string, url?: string) => ({
    generatedKind: "video_clip",
    episode: "EP02",
    segmentId,
    url,
    renderStatus: url ? "succeeded" : "failed",
  });
  const finalFile = (overrides: { url?: string; renderStatus?: string } = {}) => ({
    generatedKind: "final_video",
    episode: "EP02",
    ...overrides,
  });

  it("分段齐 + 成片 failed → 可重触发（首轮合成失败的返工补齐场景）", () => {
    const files = [
      clipFile("U01", "https://a/1.mp4"),
      clipFile("U02", "https://a/2.mp4"),
      finalFile({ renderStatus: "failed" }),
    ];
    expect(episodeRestitchEligibility(files, "EP02")).toEqual({ eligible: true });
  });

  it("分段未齐 → 不触发（原因列出缺失分段）", () => {
    const files = [
      clipFile("U01", "https://a/1.mp4"),
      clipFile("U02"),
      finalFile({ renderStatus: "failed" }),
    ];
    const r = episodeRestitchEligibility(files, "EP02");
    expect(r.eligible).toBe(false);
    expect(r.reason).toContain("U02");
  });

  it("成片合成中（running）→ 不重复触发", () => {
    const files = [clipFile("U01", "https://a/1.mp4"), finalFile({ renderStatus: "running" })];
    expect(episodeRestitchEligibility(files, "EP02").eligible).toBe(false);
  });

  it("已有可用成片（有 URL 且非 failed）→ 不重复触发", () => {
    const files = [
      clipFile("U01", "https://a/1.mp4"),
      finalFile({ renderStatus: "succeeded", url: "https://a/final.mp4" }),
    ];
    expect(episodeRestitchEligibility(files, "EP02").eligible).toBe(false);
  });

  it("成片占位缺失 → 可触发（占位由调用方补建）", () => {
    const files = [clipFile("U01", "https://a/1.mp4")];
    expect(episodeRestitchEligibility(files, "EP02").eligible).toBe(true);
  });

  it("本集没有分段视频 → 不触发；他集附件不干扰", () => {
    const files = [
      { generatedKind: "video_clip", episode: "EP01", segmentId: "U01", url: "https://a/1.mp4" },
    ];
    expect(episodeRestitchEligibility(files, "EP02").eligible).toBe(false);
    expect(episodeRestitchEligibility(files, "EP01").eligible).toBe(true);
  });
});

describe("collectRerunEpisodes / applyRunOutcomesToFiles", () => {
  it("从 jobs 提取涉及的集：去重、保序、滤空", () => {
    expect(
      collectRerunEpisodes([
        { episode: "EP02" },
        { episode: undefined },
        { episode: "EP01" },
        { episode: "EP02" },
      ]),
    ).toEqual(["EP02", "EP01"]);
    expect(collectRerunEpisodes([])).toEqual([]);
  });

  it("台账覆盖：stale ref 缺失的本轮成功 url 由同步台账补回（78577c8 根因）", () => {
    // 模拟渲染帧滞后：ref 里返工片段还没有 url,但台账已同步记录成功
    const staleFiles = [
      {
        id: "clip-u01",
        generatedKind: "video_clip",
        episode: "EP02",
        segmentId: "U01",
        renderStatus: "running",
      },
      {
        id: "clip-u02",
        generatedKind: "video_clip",
        episode: "EP02",
        segmentId: "U02",
        url: "https://a/2.mp4",
        renderStatus: "succeeded",
      },
      { id: "final-ep02", generatedKind: "final_video", episode: "EP02", renderStatus: "failed" },
    ];
    // 未覆盖前:分段未齐（U01 缺 url）→ 不触发
    expect(episodeRestitchEligibility(staleFiles, "EP02").eligible).toBe(false);
    const overlaid = applyRunOutcomesToFiles(staleFiles, [
      {
        attachmentId: "clip-u01",
        generatedKind: "video_clip",
        episode: "EP02",
        segmentId: "U01",
        ok: true,
        resultUrl: "https://a/1-new.mp4",
      },
    ]);
    // 覆盖后:url 补回、状态 succeeded → 可触发
    const hit = overlaid.find((file) => file.id === "clip-u01");
    expect(hit?.url).toBe("https://a/1-new.mp4");
    expect(hit?.renderStatus).toBe("succeeded");
    expect(episodeRestitchEligibility(overlaid, "EP02")).toEqual({ eligible: true });
  });

  it("失败台账不覆盖；他附件台账不串", () => {
    const files: import("../renderRunSummary").RestitchFileShape[] = [
      { id: "a", generatedKind: "video_clip", episode: "EP02", segmentId: "U01" },
    ];
    const overlaid = applyRunOutcomesToFiles(files, [
      { attachmentId: "a", ok: false, error: "x" },
      { attachmentId: "b", ok: true, resultUrl: "https://a/b.mp4" },
    ]);
    expect(overlaid[0].url).toBeUndefined();
  });
});

describe("episodeRestitchEligibility resultUrl 兼容", () => {
  it("旧路径只写 resultUrl 的 clip/final 判定不吃假阴性", () => {
    const files = [
      {
        generatedKind: "video_clip",
        episode: "EP02",
        segmentId: "U01",
        resultUrl: "https://a/1.mp4",
        renderStatus: "succeeded",
      },
      {
        generatedKind: "final_video",
        episode: "EP02",
        resultUrl: "https://a/f.mp4",
        renderStatus: "succeeded",
      },
    ];
    // 成片有可用 resultUrl → 不重复触发
    expect(episodeRestitchEligibility(files, "EP02").eligible).toBe(false);
    // 去掉成片:只有 resultUrl 的分段也算「已齐」→ 可触发
    expect(episodeRestitchEligibility(files.slice(0, 1), "EP02").eligible).toBe(true);
  });
});
