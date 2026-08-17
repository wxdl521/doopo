// ====================================================================
// workspaceSavePatch —— 字段级合并保存的 patch 组装（纯函数,可单测）
//
// 背景（2026-08「离开项目再回来分镜全丢」）：workspace_data 整列覆盖式
// 保存时,某段加载没成功（state 里是空数组）会把数据库里的旧内容抹掉。
// 改走 merge_workspace_data RPC（jsonb || patch）后,本函数决定哪些键进
// patch。语义约定:
//   - 「未加载成功」的键不进 patch（数据库旧值原样保留）;
//   - 「显式空数组」是用户真实清空,允许覆盖（不剔除）;
//   - 与值无关的 undefined 键本就不该出现（调用方组装的值均有定义）。
// ====================================================================

/** 分镜结构段（loadWorkspaceStoryboardStructure）覆盖的键。 */
export const STORYBOARD_STRUCTURE_KEYS = ["storyboard", "storyboardGroups"] as const;

/**
 * 组装保存 patch：分镜结构未 ready 时剔除其覆盖的键;ready 时全量提交。
 * 显式空数组不在此剔除（用户清空是合法覆盖）。
 */
export function buildWorkspaceDataPatch(input: {
  workspaceData: Record<string, unknown>;
  storyboardStructureReady: boolean;
}): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input.workspaceData)) {
    // undefined 键不进 patch（防御;正常组装路径不会产生）
    if (value === undefined) continue;
    patch[key] = value;
  }
  if (!input.storyboardStructureReady) {
    for (const key of STORYBOARD_STRUCTURE_KEYS) delete patch[key];
  }
  return patch;
}
