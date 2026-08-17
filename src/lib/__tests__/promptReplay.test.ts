// ====================================================================
// promptReplay + errorClassify 纯函数测试
// （角色详情页「重新生成」提示词被旧全文覆盖的修复回归）
// ====================================================================
import { describe, expect, it } from "vitest";
import { classifyError } from "../errorClassify";
import { shouldReplayRawPrompt } from "../promptReplay";

describe("shouldReplayRawPrompt（详情页重新生成的 rawPrompt 复用判定）", () => {
  const CHARACTER_PRESETS = ["three-view", "multi-asset"] as const;

  it("普通角色（initial/modify）编辑后重生成不复用 rawPrompt —— 提交走编辑重建,无旧提示词残留", () => {
    // 即使历史记录带 rawPrompt,普通模式也判不复用（调用方因此不传 rawPrompt,
    // processCharacter 按 editedCharacter 重建,旧全文不会进提交内容）
    expect(
      shouldReplayRawPrompt({ mode: "initial", rawPrompt: "old sensitive full prompt" }, CHARACTER_PRESETS),
    ).toBe(false);
    expect(
      shouldReplayRawPrompt({ mode: "modify", rawPrompt: "old prompt" }, CHARACTER_PRESETS),
    ).toBe(false);
  });

  it("预设模板（three-view/multi-asset）且 rawPrompt 非空 → 复用（逐版块回填）", () => {
    expect(
      shouldReplayRawPrompt({ mode: "three-view", rawPrompt: "preset template" }, CHARACTER_PRESETS),
    ).toBe(true);
    expect(
      shouldReplayRawPrompt({ mode: "multi-asset", rawPrompt: "preset template" }, CHARACTER_PRESETS),
    ).toBe(true);
  });

  it("无记录 / rawPrompt 为空 → 不复用", () => {
    expect(shouldReplayRawPrompt(undefined, CHARACTER_PRESETS)).toBe(false);
    expect(shouldReplayRawPrompt(null, CHARACTER_PRESETS)).toBe(false);
    expect(shouldReplayRawPrompt({ mode: "three-view", rawPrompt: "  " }, CHARACTER_PRESETS)).toBe(
      false,
    );
  });

  it("场景侧预设为 multi-view（与角色预设模式集合相互独立）", () => {
    expect(shouldReplayRawPrompt({ mode: "multi-view", rawPrompt: "p" }, ["multi-view"])).toBe(true);
    expect(shouldReplayRawPrompt({ mode: "multi-view", rawPrompt: "p" }, CHARACTER_PRESETS)).toBe(
      false,
    );
    expect(shouldReplayRawPrompt({ mode: "initial", rawPrompt: "p" }, ["multi-view"])).toBe(false);
  });
});

describe("classifyError 内容安全识别", () => {
  it("safety system / content policy / moderation → 引导改提示词", () => {
    expect(classifyError("400: rejected by safety system", "生成失败")).toContain(
      "内容安全系统拒绝",
    );
    expect(classifyError("content_policy_violation detected", "生成失败")).toContain(
      "请修改敏感描述后重试",
    );
    expect(classifyError("HTTP 400: blocked by content management policy", "生成失败")).toContain(
      "内容安全系统拒绝",
    );
  });

  it("保留 requestId 便于排查", () => {
    const message = classifyError(
      "400 safety system rejection (request id: abc-123-def)",
      "生成失败",
    );
    expect(message).toContain("requestId: abc-123-def");
  });

  it("既有归类不受影响（超时/额度/限流/普通错误）", () => {
    expect(classifyError("request timed out", "生成失败")).toBe("AI 处理超时，请重试");
    expect(classifyError("402 no_credits", "生成失败")).toBe("AI 额度不足，请充值");
    expect(classifyError("429 too many requests", "生成失败")).toBe("请求过于频繁，请稍后重试");
    expect(classifyError("some other error", "生成失败")).toBe("some other error");
    expect(classifyError(undefined, "生成失败")).toBe("生成失败");
  });
});
