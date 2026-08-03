import { describe, expect, it, vi } from "vitest";
import { runAssetAnalysis } from "./analyzeAssetsCore";
import { INTERNAL_VISION_MODEL, type GatewayChatResult } from "./lovableGateway";

const baseDeps = () => ({
  userText: vi.fn(() => "[USER INSTRUCTION]\n测试"),
  systemPrompt: vi.fn(() => "V1_CONTRACT"),
  normalizeResult: vi.fn((content: string, model: string, usedFrames: boolean) => ({
    ok: true as const,
    content,
    model,
    usedFrames,
  })),
});

const okChat = (text = "{\"assets\":[]}"): GatewayChatResult => ({ ok: true, text, model: INTERNAL_VISION_MODEL });

describe("runAssetAnalysis（v1 画面分析统一走 Gemini skill）", () => {
  it("无论用户选什么导演模型，画面分析都调 INTERNAL_VISION_MODEL", async () => {
    const callChat = vi.fn(async (_opts: Parameters<typeof import("./lovableGateway").callLovableChat>[0]) => okChat());
    const deps = baseDeps();
    await runAssetAnalysis(
      { instruction: "分析", model: "qwen:qwen3.6-plus", sourceFiles: [], frameImages: [], transcript: "", existingAssets: [] },
      { ...deps, callChat },
    );
    expect(callChat.mock.calls[0][0].model).toBe(INTERNAL_VISION_MODEL);
    expect(deps.normalizeResult.mock.calls[0][1]).toBe(INTERNAL_VISION_MODEL);
  });

  it("system 由 video-analysis-extract skill + v1 契约覆盖段组成", async () => {
    const callChat = vi.fn(async (_opts: Parameters<typeof import("./lovableGateway").callLovableChat>[0]) => okChat());
    await runAssetAnalysis(
      { instruction: "分析", model: "ark:deepseek-v4-pro-260425", sourceFiles: [], frameImages: [], transcript: "", existingAssets: [] },
      { ...baseDeps(), callChat },
    );
    const system = String(callChat.mock.calls[0][0].messages[0].content);
    expect(system).toContain("video-analysis-extract");
    expect(system).toContain("V1_CONTRACT");
    expect(system).toContain("不要输出 skill 中定义的完整视觉分析 JSON");
  });

  it("有关键帧时以 image_url 传入并标记 usedFrames；无帧不标记", async () => {
    const callChat = vi.fn(async (_opts: Parameters<typeof import("./lovableGateway").callLovableChat>[0]) => okChat());
    const deps = baseDeps();
    await runAssetAnalysis(
      { instruction: "分析", model: "qwen:qwen3.6-plus", sourceFiles: [], frameImages: ["data:image/jpeg;base64,AAA"], transcript: "台词", existingAssets: [] },
      { ...deps, callChat },
    );
    const userParts = callChat.mock.calls[0][0].messages[1].content as Array<Record<string, unknown>>;
    expect(userParts.some((p) => p.type === "image_url")).toBe(true);
    expect(deps.normalizeResult.mock.calls[0][2]).toBe(true);

    await runAssetAnalysis(
      { instruction: "分析", model: "qwen:qwen3.6-plus", sourceFiles: [], frameImages: [], transcript: "", existingAssets: [] },
      { ...baseDeps(), callChat },
    );
    const parts2 = callChat.mock.calls[1][0].messages[1].content as Array<Record<string, unknown>>;
    expect(parts2.every((p) => p.type === "text")).toBe(true);
  });

  it("网关失败时透传错误", async () => {
    const callChat = vi.fn(async (_opts: Record<string, unknown>): Promise<GatewayChatResult> => ({ ok: false, error: "网关 429" }));
    const result = await runAssetAnalysis(
      { instruction: "分析", model: "qwen:qwen3.6-plus", sourceFiles: [], frameImages: [], transcript: "", existingAssets: [] },
      { ...baseDeps(), callChat },
    );
    expect(result).toEqual({ ok: false, error: "网关 429" });
  });
});
