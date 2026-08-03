import { describe, expect, it } from "vitest";
import { isRegenerateIntent } from "../restyleIntent";

describe("isRegenerateIntent", () => {
  it("recognises corrections", () => {
    for (const message of [
      "场景图片生成不对，请重新生成",
      "这张错了，重画一张",
      "人物不像，换一张",
    ]) {
      expect(isRegenerateIntent(message)).toBe(true);
    }
  });

  it("does not treat confirmations as corrections", () => {
    for (const message of ["确认", "继续下一步", "可以了", ""]) {
      expect(isRegenerateIntent(message)).toBe(false);
    }
  });
});
import { isConfirmIntent, isVideoRenderIntent } from "../restyleIntent";

describe("restyle intent", () => {
  it("recognises spoken confirmations", () => {
    for (const message of ["确认", "确认资产", "继续下一步", "可以了", "没问题", "OK", "生成方案"]) {
      expect(isConfirmIntent(message), message).toBe(true);
    }
  });

  it("does not treat revision requests as confirmation", () => {
    for (const message of ["这个角色不对", "请重新生成场景", "把光影调整为冷白色调"]) {
      expect(isConfirmIntent(message), message).toBe(false);
    }
  });

  it("recognises video render intent", () => {
    expect(isVideoRenderIntent("确认生成视频")).toBe(true);
    expect(isVideoRenderIntent("继续")).toBe(false);
  });
});

import { isReanalyzeIntent, isReplanIntent } from "../restyleIntent";

describe("isReanalyzeIntent", () => {
  it("recognises requests to re-analyse the source video", () => {
    for (const message of [
      "重新分析原片",
      "请再分析一遍原视频",
      "重新提取资产",
      "重新识别角色和场景",
      "重看原片",
      "资产表不对，重新分析",
      "补充分析，漏了一个角色",
      "漏了一个场景",
      "Re-analyse source",
    ]) {
      expect(isReanalyzeIntent(message), message).toBe(true);
    }
  });

  it("is mutually exclusive with confirm intent", () => {
    for (const message of ["确认", "确认资产", "继续下一步", "可以了", "OK"]) {
      expect(isReanalyzeIntent(message), message).toBe(false);
    }
  });

  it("leaves image-pointing corrections to the regenerate branch", () => {
    for (const message of [
      "场景图片生成不对，请重新生成",
      "这张错了，重画一张",
      "重新生成角色图片",
      "人物不像，换一张",
    ]) {
      expect(isReanalyzeIntent(message), message).toBe(false);
      // 这些说法仍由资产生图纠错分支接管。
      expect(isRegenerateIntent(message), message).toBe(true);
    }
  });

  it("does not fire on empty or unrelated messages", () => {
    for (const message of ["", "生成资产图片", "确认生成视频"]) {
      expect(isReanalyzeIntent(message), message).toBe(false);
    }
  });
});

describe("isReplanIntent", () => {
  it("recognises requests to redo the whole plan", () => {
    for (const message of [
      "方案不对，重新出方案",
      "重做方案",
      "重新生成方案",
      "重新分镜",
      "redo the plan",
    ]) {
      expect(isReplanIntent(message), message).toBe(true);
    }
  });

  it("is mutually exclusive with confirm intent", () => {
    for (const message of ["确认", "继续下一步", "可以了"]) {
      expect(isReplanIntent(message), message).toBe(false);
    }
  });

  it("does not catch local segment tweaks or re-analyse requests", () => {
    for (const message of [
      "请将第一个视频的 U01 光影调整为冷白色调",
      "重新分析原片",
      "",
    ]) {
      expect(isReplanIntent(message), message).toBe(false);
    }
  });
});
