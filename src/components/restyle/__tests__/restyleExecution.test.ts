import { describe, expect, it } from "vitest";
import {
  DEFAULT_AUTO_BUDGET,
  GATES,
  isInsufficientCreditsError,
  isOverBudget,
  isRestyleGateId,
  resolveExecutionConfig,
  shouldPauseAt,
} from "../restyleExecution";

describe("GATES", () => {
  it("包含 11 个环节且 id 唯一", () => {
    expect(GATES).toHaveLength(11);
    expect(new Set(GATES.map((gate) => gate.id)).size).toBe(11);
  });

  it("每个环节都映射到已知流水线节点", () => {
    const nodes = new Set(["analysis", "asset_images", "voice", "plan", "render", "stitch"]);
    for (const gate of GATES) {
      expect(nodes.has(gate.node)).toBe(true);
      expect(isRestyleGateId(gate.id)).toBe(true);
    }
  });

  it("isRestyleGateId 拒绝未知 id", () => {
    expect(isRestyleGateId("not_a_gate")).toBe(false);
    expect(isRestyleGateId(undefined)).toBe(false);
  });
});

describe("shouldPauseAt 三模式判定", () => {
  it("极速全自动：任何环节都不暂停", () => {
    for (const gate of GATES) {
      expect(shouldPauseAt({ executionMode: "auto" }, gate.id)).toBe(false);
    }
  });

  it("分步护航（默认）：任何环节都暂停", () => {
    for (const gate of GATES) {
      expect(shouldPauseAt({ executionMode: "guided" }, gate.id)).toBe(true);
    }
    // 未配置时回落默认 = 分步护航
    expect(shouldPauseAt(undefined, "storyboard")).toBe(true);
    expect(shouldPauseAt(null, "asset_setting")).toBe(true);
    expect(shouldPauseAt({}, "subtitle_final")).toBe(true);
  });

  it("自定义干预：仅暂停勾选的环节", () => {
    const config = { executionMode: "custom" as const, manualGates: ["character_images"] };
    expect(shouldPauseAt(config, "character_images")).toBe(true);
    expect(shouldPauseAt(config, "asset_setting")).toBe(false);
    expect(shouldPauseAt(config, "storyboard")).toBe(false);
    expect(shouldPauseAt(config, "video_quote")).toBe(false);
  });

  it("自定义干预：manualGates 含非法 id 时被过滤", () => {
    const config = { executionMode: "custom" as const, manualGates: ["voice_plan", "bogus"] };
    expect(shouldPauseAt(config, "voice_plan")).toBe(true);
    expect(resolveExecutionConfig(config).manualGates).toEqual(["voice_plan"]);
  });
});

describe("isOverBudget 预算校验", () => {
  it("达到 / 超过上限返回 true", () => {
    expect(isOverBudget(100_000, DEFAULT_AUTO_BUDGET)).toBe(true);
    expect(isOverBudget(100_001, DEFAULT_AUTO_BUDGET)).toBe(true);
  });

  it("未达上限返回 false", () => {
    expect(isOverBudget(0, DEFAULT_AUTO_BUDGET)).toBe(false);
    expect(isOverBudget(99_999, DEFAULT_AUTO_BUDGET)).toBe(false);
  });

  it("预算未设置或非正数时不拦截", () => {
    expect(isOverBudget(1_000_000, undefined)).toBe(false);
    expect(isOverBudget(1_000_000, null)).toBe(false);
    expect(isOverBudget(1_000_000, 0)).toBe(false);
    expect(isOverBudget(1_000_000, Number.NaN)).toBe(false);
  });
});

describe("resolveExecutionConfig 默认值", () => {
  it("空配置回落：分步护航 + 默认预算 + 系统来源", () => {
    expect(resolveExecutionConfig(undefined)).toEqual({
      executionMode: "guided",
      autoBudget: DEFAULT_AUTO_BUDGET,
      assetImageSource: "system",
      voiceSource: "auto",
      manualGates: [],
    });
  });

  it("非法预算回落默认值", () => {
    expect(resolveExecutionConfig({ autoBudget: 0 }).autoBudget).toBe(DEFAULT_AUTO_BUDGET);
    expect(resolveExecutionConfig({ autoBudget: -5 }).autoBudget).toBe(DEFAULT_AUTO_BUDGET);
    expect(resolveExecutionConfig({ autoBudget: 500 }).autoBudget).toBe(500);
  });
});

describe("isInsufficientCreditsError 余额不足识别", () => {
  it("识别 code 与文案两种形态", () => {
    expect(isInsufficientCreditsError("INSUFFICIENT_CREDITS")).toBe(true);
    expect(isInsufficientCreditsError("积分余额不足，请充值")).toBe(true);
    expect(isInsufficientCreditsError("insufficient credits")).toBe(true);
  });

  it("普通错误不误判", () => {
    expect(isInsufficientCreditsError("网络错误")).toBe(false);
    expect(isInsufficientCreditsError(null)).toBe(false);
    expect(isInsufficientCreditsError(undefined)).toBe(false);
  });
});
