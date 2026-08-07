// ====================================================================
// rerunAttachments —— 返工片段附件的替换口径（纯函数，可单测）
//
// 回归根因：聊天点名返工（handleSegmentRerunIntent）不带 rerunOfAttachmentId，
// generateRenderedVideos 重建附件列表时只按 id 移除被返工的旧附件——同
// (episode, segmentId) 的旧片段（含上一轮失败记录）被留在 files 里，新一轮
// 再失败就出现「EP02 U02、EP02 U02」双条目，且汇总播报的首条失败原因抓到
// 旧附件上的历史错误。修复：返工开始时把同 (episode, segmentId) 的旧片段
// 一律视为被取代移除——旧错误随旧附件清除，播报只反映本轮结果。
// ====================================================================

/** 参与替换判定的最小附件字段集。 */
export interface ClipAttachmentRef {
  id: string;
  generatedKind?: string;
  episode?: string;
  segmentId?: string;
}

/** 返工请求的最小字段集（RestyleRerunRequest 的子集）。 */
export interface RerunRef {
  episode?: string;
  segmentId?: string;
  rerunOfAttachmentId?: string;
}

/**
 * 附件是否被本次返工取代（应从 files 中移除）：
 * 1. 显式 rerunOfAttachmentId 命中（重试按钮 / 片段卡片返工路径）；
 * 2. 返工点名了 segmentId 时，同 (episode, segmentId) 的旧 video_clip
 *    一律取代（聊天点名路径不带 rerunOfAttachmentId）。
 * 整集/全量重跑（未点名 segmentId）不在此处处理，由调用方的整体重建逻辑覆盖。
 */
export function isSupersededClipAttachment(file: ClipAttachmentRef, rerun?: RerunRef): boolean {
  if (!rerun) return false;
  if (file.id === rerun.rerunOfAttachmentId) return true;
  return Boolean(
    rerun.segmentId &&
      file.generatedKind === "video_clip" &&
      file.episode === rerun.episode &&
      file.segmentId === rerun.segmentId,
  );
}
