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
