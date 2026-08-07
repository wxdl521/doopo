// ====================================================================
// renderRunSummary 测试（队列收尾播报矛盾回归）：
// 本轮失败可见 / 跨 run 不串原因 / 成片口径 / 标签
// ====================================================================
import { describe, expect, it } from "vitest";
import {
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
