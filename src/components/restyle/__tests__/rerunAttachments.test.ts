// ====================================================================
// rerunAttachments 测试：返工附件替换口径（重复入队/旧错误残留回归）
// ====================================================================
import { describe, expect, it } from "vitest";
import { isSupersededClipAttachment, type ClipAttachmentRef } from "../rerunAttachments";

const clip = (overrides: Partial<ClipAttachmentRef> = {}): ClipAttachmentRef => ({
  id: "old-1",
  generatedKind: "video_clip",
  episode: "EP02",
  segmentId: "U02",
  ...overrides,
});

describe("isSupersededClipAttachment", () => {
  it("显式 rerunOfAttachmentId 命中即移除（重试按钮路径）", () => {
    expect(isSupersededClipAttachment(clip(), { rerunOfAttachmentId: "old-1" })).toBe(true);
    expect(isSupersededClipAttachment(clip(), { rerunOfAttachmentId: "other" })).toBe(false);
  });

  it("聊天点名路径（无 rerunOfAttachmentId）：同 (episode, segmentId) 旧片段移除", () => {
    // 上一轮失败残留的旧附件必须被取代，否则汇总播报出现双条目+旧错误
    expect(isSupersededClipAttachment(clip(), { episode: "EP02", segmentId: "U02" })).toBe(true);
  });

  it("不同分段 / 不同集的片段保留", () => {
    const rerun = { episode: "EP02", segmentId: "U02" };
    expect(isSupersededClipAttachment(clip({ segmentId: "U03" }), rerun)).toBe(false);
    expect(isSupersededClipAttachment(clip({ episode: "EP01" }), rerun)).toBe(false);
  });

  it("非片段附件（成片 / 源片 / 资产图）保留", () => {
    const rerun = { episode: "EP02", segmentId: "U02" };
    expect(isSupersededClipAttachment(clip({ generatedKind: "final_video", segmentId: undefined }), rerun)).toBe(false);
    expect(isSupersededClipAttachment(clip({ generatedKind: undefined }), rerun)).toBe(false);
  });

  it("整集/全量重跑（未点名 segmentId）：不按此口径移除", () => {
    expect(isSupersededClipAttachment(clip(), { episode: "EP02" })).toBe(false);
    expect(isSupersededClipAttachment(clip(), undefined)).toBe(false);
  });
});
