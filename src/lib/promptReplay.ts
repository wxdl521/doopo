// ====================================================================
// promptReplay —— 详情页「重新生成」的历史 rawPrompt 复用判定（纯函数）
//
// 线上事故（2026-08，Azure gpt-image-2 400 safety system）：普通角色的
// 重新生成复用历史 rawPrompt 时采用「保留旧全文 + 末尾追加编辑段」策略,
// 用户删掉/改写的敏感描述仍随旧主体送审,安全系统反复拒绝。
// 修复口径：仅预设模板（角色 three-view/multi-asset、场景 multi-view,
// 需逐版块回填完整模板）且记录来自成功出图时,才复用 rawPrompt;
// 普通角色/场景/道具一律按当前编辑内容重建（processCharacter/genSceneImage
// 的 editedX 路径）。
// ====================================================================

/** 历史生图 prompt 记录的最小形状（CharacterImagePromptRecord 等的子集）。 */
export interface PromptReplayRecord {
  mode?: string;
  rawPrompt?: string;
}

/**
 * 是否复用历史 rawPrompt 重放：仅当记录是指定预设模板模式且 rawPrompt 非空。
 * 失败记录不会写入 prompt 记录（persistAndSetImage 只在成功时写）,
 * 所以这里拿到的 rawPrompt 必然来自成功出图。
 */
export function shouldReplayRawPrompt(
  record: PromptReplayRecord | undefined | null,
  presetModes: readonly string[],
): boolean {
  if (!record?.rawPrompt?.trim()) return false;
  return presetModes.includes(record.mode ?? "");
}
