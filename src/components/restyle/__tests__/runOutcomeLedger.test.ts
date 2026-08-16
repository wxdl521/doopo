// ====================================================================
// runOutcomeLedger 时序契约测试（772bbb2「本轮台账：空」根因回归）
// ====================================================================
import { describe, expect, it } from "vitest";
import { createRunOutcomeLedger } from "../runOutcomeLedger";
import type { RenderRunOutcome } from "../renderRunSummary";

const okOutcome = (overrides: Partial<RenderRunOutcome> = {}): RenderRunOutcome => ({
  attachmentId: "a1",
  generatedKind: "video_clip",
  episode: "EP02",
  segmentId: "U01",
  ok: true,
  resultUrl: "https://a/1.mp4",
  ...overrides,
});

describe("runOutcomeLedger（记账→收尾读取时序模型）", () => {
  it("record 后 snapshot 立即可见（同步契约：不经过任何渲染帧）", () => {
    const ledger = createRunOutcomeLedger();
    ledger.reset("p1");
    ledger.record("p1", okOutcome());
    // 模拟 completeRenderQueue 收尾的同步读取：同一微任务内必须读得到
    expect(ledger.snapshot("p1")).toHaveLength(1);
    expect(ledger.snapshot("p1")[0].resultUrl).toBe("https://a/1.mp4");
  });

  it("未 reset 的项目 record 自动建账（兜底）", () => {
    const ledger = createRunOutcomeLedger();
    ledger.record("p1", okOutcome());
    expect(ledger.snapshot("p1")).toHaveLength(1);
  });

  it("reset 清空上一 run 的账（跨 run 不串）", () => {
    const ledger = createRunOutcomeLedger();
    ledger.record("p1", okOutcome());
    ledger.reset("p1");
    expect(ledger.snapshot("p1")).toEqual([]);
  });

  it("drain 时序：上一 run 收尾先读账，下一 run reset 后互不污染", () => {
    const ledger = createRunOutcomeLedger();
    // run A：记账 → 收尾读取（completeRenderQueue 在 finishRun/drain 之前读）
    ledger.reset("p1");
    ledger.record("p1", okOutcome({ segmentId: "U01" }));
    const runA = ledger.snapshot("p1");
    expect(runA).toHaveLength(1);
    // drain 拉起 run B：重置 → 记新账；run A 的读取结果不受影响
    ledger.reset("p1");
    ledger.record("p1", okOutcome({ segmentId: "U02" }));
    expect(runA[0].segmentId).toBe("U01");
    expect(ledger.snapshot("p1").map((o) => o.segmentId)).toEqual(["U02"]);
  });

  it("snapshot 返回副本，调用方修改不污染账本", () => {
    const ledger = createRunOutcomeLedger();
    ledger.record("p1", okOutcome());
    ledger.snapshot("p1").pop();
    expect(ledger.snapshot("p1")).toHaveLength(1);
  });
});
