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


// --------------------------------------------------------------------
// 成功产物保留（返工不丢已有片子回归）
// --------------------------------------------------------------------
import { withoutSupersededClips } from "../rerunAttachments";

const playableClip = (overrides: Partial<ClipAttachmentRef> = {}): ClipAttachmentRef => ({
  id: "good-1",
  generatedKind: "video_clip",
  episode: "EP02",
  segmentId: "U02",
  renderStatus: "succeeded",
  resultUrl: "https://cdn.example.com/good.mp4",
  ...overrides,
});

describe("isSupersededClipAttachment · 成功产物保留", () => {
  it("succeeded 且有 URL 的旧 clip：返工开始时不移除（新旧并存到新产物落地）", () => {
    expect(isSupersededClipAttachment(playableClip(), { episode: "EP02", segmentId: "U02" })).toBe(false);
    expect(
      isSupersededClipAttachment(playableClip(), { rerunOfAttachmentId: "good-1" }),
    ).toBe(false);
  });

  it("succeeded 但 URL 缺失（持久化剥离/异常）：按占位处理，仍被取代", () => {
    expect(
      isSupersededClipAttachment(
        playableClip({ resultUrl: undefined, url: undefined }),
        { episode: "EP02", segmentId: "U02" },
      ),
    ).toBe(true);
  });

  it("failed 占位 clip 的取代逻辑不变", () => {
    expect(
      isSupersededClipAttachment(
        playableClip({ renderStatus: "failed", resultUrl: undefined, url: undefined }),
        { episode: "EP02", segmentId: "U02" },
      ),
    ).toBe(true);
  });
});

describe("withoutSupersededClips · 新成功后旧让位", () => {
  const newClip = playableClip({ id: "new-1", resultUrl: "https://cdn.example.com/new.mp4" });

  it("新产物成功写回：同集同段的旧成功与失败占位全部移除", () => {
    const files = [
      playableClip(), // 旧成功
      playableClip({ id: "bad-1", renderStatus: "failed", resultUrl: undefined, url: undefined }),
      newClip,
    ];
    const result = withoutSupersededClips(files, newClip);
    expect(result.map((f) => f.id)).toEqual(["new-1"]);
  });

  it("其他分段/其他集的 clip 与成片、源片不受影响", () => {
    const files = [
      playableClip({ segmentId: "U01" }),
      playableClip({ episode: "EP01" }),
      playableClip({ generatedKind: "final_video", segmentId: undefined }),
      newClip,
    ];
    const result = withoutSupersededClips(files, newClip);
    expect(result).toHaveLength(4);
  });

  it("completed 不是 video_clip（如成片写回）：原样返回", () => {
    const finalCompleted = playableClip({ id: "final-1", generatedKind: "final_video", segmentId: undefined });
    const files = [playableClip(), finalCompleted];
    expect(withoutSupersededClips(files, finalCompleted)).toEqual(files);
  });
});
