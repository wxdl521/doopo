// ====================================================================
// imageModelFallback 纯函数测试：错误分类 / fallback 候选顺序
// ====================================================================
import { describe, expect, it } from "vitest";
import { imageModelFallbackCandidates, isQuotaLikeImageError } from "../imageModelFallback";

describe("isQuotaLikeImageError", () => {
  it("余额/配额/403/401 类判定为可换渠道", () => {
    expect(isQuotaLikeImageError("HTTP 403: insufficient balance")).toBe(true);
    expect(isQuotaLikeImageError("当前账户余额不足（$0.00），请充值")).toBe(true);
    expect(isQuotaLikeImageError("quota exceeded for this model")).toBe(true);
    expect(isQuotaLikeImageError("HTTP 401 Unauthorized")).toBe(true);
    expect(isQuotaLikeImageError("billing required: payment method missing")).toBe(true);
  });

  it("内容审核类判定为不可换渠道（即使同时带 403）", () => {
    expect(isQuotaLikeImageError("输入图片包含敏感内容，未通过审核")).toBe(false);
    expect(isQuotaLikeImageError("InputImageSensitiveContentDetected")).toBe(false);
    expect(isQuotaLikeImageError("HTTP 403: content policy violation (nsfw)")).toBe(false);
    expect(isQuotaLikeImageError("may contain real person")).toBe(false);
  });

  it("普通网络/超时错误不换渠道", () => {
    expect(isQuotaLikeImageError("Failed to fetch")).toBe(false);
    expect(isQuotaLikeImageError("生图超时，请稍后重试。")).toBe(false);
    expect(isQuotaLikeImageError(undefined)).toBe(false);
    expect(isQuotaLikeImageError("")).toBe(false);
  });
});

describe("imageModelFallbackCandidates", () => {
  const available = ["tokenflash/gpt-image-2", "azure/gpt-image-2", "pixflow/gpt-image-2"];

  it("按列表顺序给出候选并排除当前模型", () => {
    expect(imageModelFallbackCandidates("tokenflash/gpt-image-2", available)).toEqual([
      "azure/gpt-image-2",
      "pixflow/gpt-image-2",
    ]);
  });

  it("排除已知不可用渠道", () => {
    const dead = new Set(["azure/gpt-image-2"]);
    expect(imageModelFallbackCandidates("tokenflash/gpt-image-2", available, dead)).toEqual([
      "pixflow/gpt-image-2",
    ]);
  });

  it("当前模型在列表末尾时环绕到列表头部候选（保持列表顺序）", () => {
    expect(imageModelFallbackCandidates("pixflow/gpt-image-2", available)).toEqual([
      "tokenflash/gpt-image-2",
      "azure/gpt-image-2",
    ]);
  });

  it("其余渠道全部已知不可用时无候选", () => {
    const dead = new Set(["tokenflash/gpt-image-2", "azure/gpt-image-2"]);
    expect(imageModelFallbackCandidates("pixflow/gpt-image-2", available, dead)).toEqual([]);
  });

  it("空列表返回空", () => {
    expect(imageModelFallbackCandidates("any", [])).toEqual([]);
  });
});
