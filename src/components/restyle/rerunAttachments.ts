// ====================================================================
// rerunAttachments —— 返工片段附件的替换口径（纯函数，可单测）
//
// 回归根因①：聊天点名返工（handleSegmentRerunIntent）不带 rerunOfAttachmentId，
// generateRenderedVideos 重建附件列表时只按 id 移除被返工的旧附件——同
// (episode, segmentId) 的旧片段（含上一轮失败记录）被留在 files 里，新一轮
// 再失败就出现「EP02 U02、EP02 U02」双条目，且汇总播报的首条失败原因抓到
// 旧附件上的历史错误。修复：返工开始时把同 (episode, segmentId) 的旧片段
// 一律视为被取代移除——旧错误随旧附件清除，播报只反映本轮结果。
// 回归根因②（本次）：取代口径对「已成功且有可播放产物」的 clip 不能生效——
// 返工开始就把好片子移除/置空，新产物还没生成，已有产物先丢了。修正：
// 成功的旧 clip 在返工开始时保留；只有新渲染成功写回（withoutSupersededClips）
// 时旧 clip 才让位；新渲染失败，旧成功 clip 保持可用。失败/占位 clip 的
// 取代逻辑不变（返工开始即移除）。
// ====================================================================

/** 参与替换判定的最小附件字段集。 */
export interface ClipAttachmentRef {
  id: string;
  generatedKind?: string;
  episode?: string;
  segmentId?: string;
  renderStatus?: string;
  url?: string;
  resultUrl?: string;
}

/** 返工请求的最小字段集（RestyleRerunRequest 的子集）。 */
export interface RerunRef {
  episode?: string;
  segmentId?: string;
  rerunOfAttachmentId?: string;
}

/**
 * 「可播放的成功产物」：renderStatus=succeeded 且有 URL。
 * 新产物未生成前必须保留——用户不应因一次失败的重试失去已有片子。
 */
function isPlayableClip(file: ClipAttachmentRef): boolean {
  return file.renderStatus === "succeeded" && Boolean(file.resultUrl ?? file.url);
}

/**
 * 附件是否被本次返工取代（应从 files 中移除）：
 * 1. 显式 rerunOfAttachmentId 命中（重试按钮 / 片段卡片返工路径）；
 * 2. 返工点名了 segmentId 时，同 (episode, segmentId) 的旧 video_clip 取代。
 * 两类都只取代「非可播放」的旧 clip（失败/占位）；已成功有 URL 的 clip
 * 在返工开始时保留，待新渲染成功写回时由 withoutSupersededClips 让位。
 * 整集/全量重跑（未点名 segmentId）不在此处处理，由调用方的整体重建逻辑覆盖。
 */
export function isSupersededClipAttachment(file: ClipAttachmentRef, rerun?: RerunRef): boolean {
  if (!rerun) return false;
  if (isPlayableClip(file)) return false;
  if (file.id === rerun.rerunOfAttachmentId) return true;
  return Boolean(
    rerun.segmentId &&
      file.generatedKind === "video_clip" &&
      file.episode === rerun.episode &&
      file.segmentId === rerun.segmentId,
  );
}

/**
 * 新渲染成功写回时的让位过滤：移除与 completed 同 (episode, segmentId) 的
 * 其余 video_clip（旧成功产物与失败占位都从此刻起被新产物取代）。
 * completed 不是 video_clip 时原样返回。
 */
export function withoutSupersededClips<T extends ClipAttachmentRef>(
  files: T[],
  completed: T,
): T[] {
  if (completed.generatedKind !== "video_clip") return files;
  return files.filter(
    (file) =>
      file.id === completed.id ||
      !(
        file.generatedKind === "video_clip" &&
        file.episode === completed.episode &&
        file.segmentId === completed.segmentId
      ),
  );
}
