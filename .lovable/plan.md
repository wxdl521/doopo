## 目标

让用户在工作区生成的**剧本 / 角色 / 分镜 / 时间轴**等内容自动缓存，刷新页面后仍可继续显示之前的成果，无需手动点"保存工作区"。

## 现状

- `src/routes/workspace.$workspaceId.tsx` 已经有完整的服务端持久化能力：`saveWorkspaceData` / `loadWorkspaceData`（写入 `projects.workspace_data` JSONB）。
- 加载逻辑（约 line 1257）已经在挂载时调用 `callLoadWorkspace`，把 outline / scenes / characters / storyboard / storyboardGroups / timeline / episodeTexts / props / 各类图片缓存等还原到 state。
- 但 **保存只在两种情况下触发**：
  1. 用户手动点击「保存工作区」按钮；
  2. `completedStages` 五个阶段全部完成时自动保存一次（`autoSavedRef` 只跑一次）。
- 后果：刷新前如果没点保存、且尚未完成全部阶段，剧本/角色/分镜/时间轴等阶段性产物会丢失。

## 方案：阶段性内容自动持久化（防抖保存）

在已有 `handleSaveWorkspace` 基础上，新增 **数据变更自动保存（debounce）**，保证生成的任何一个阶段内容都会在短时间内落到服务端，刷新即可恢复。

### 改动点（仅 `src/routes/workspace.$workspaceId.tsx`）

1. **新增 debounce 自动保存 effect**（放在 `handleSaveWorkspace` 定义之后）：
   - 依赖项：`dataLoaded`、`data.outline`、`data.scenes.length`、`data.characters.length`、`data.storyboardGroups`（hash）、`data.timeline`、`data.episodeTexts.length`、`data.synopsisText`、`data.props.length`，以及 `charImages` / `shotImages` / `sceneImages` / `propImages` / `panelImages` / `groupVideos` / `persistGroupStoryboards` 的 hash key。
   - 行为：`dataLoaded` 后，任意上述依赖变更 → 设置 1.5 秒 `setTimeout` 调 `handleSaveWorkspace()`，新变更进来时清掉旧 timer 重新计时（典型 debounce）。
   - 用 `savingWorkspace` 状态做互斥：正在保存就跳过本轮，等下一次依赖变化再触发。
   - 卸载时清理 timer，避免内存泄漏。
   - 不弹 `toast`（"工作区已保存"由手动按钮触发）：抽出 `handleSaveWorkspace` 的 silent 版本，或加一个 `silent: boolean` 参数，自动保存走 silent 路径。

2. **解除"只自动保存一次"的限制**：
   - 现有 `autoSavedRef.current = true` 的"五阶段完成才自动保存一次"逻辑保留，但不再是唯一保存路径——上面的 debounce effect 是主路径。

3. **保持现有手动保存按钮 + toast 提示行为不变**，用户手动保存仍然有反馈。

### 不改动

- 不动 `loadWorkspaceData` / `saveWorkspaceData` 服务端函数和 DB schema。
- 不动 localStorage，不引入新的缓存层（服务端 JSONB 已足够，且跨设备一致）。
- 不动 AI 生成逻辑、UI 布局、aigcfamily 模型相关代码。

## 验收

- 在工作区生成剧本 → 等约 2 秒 → 刷新 → 剧本仍在。
- 生成角色后刷新 → 角色列表 + 形象图仍在。
- 生成分镜组 / 分镜图后刷新 → 分镜组 + shot 图仍在。
- 生成时间轴后刷新 → 时间轴仍在。
- 多次连续编辑（如改 shot action）不会触发频繁请求，1.5 秒 debounce 合并为一次保存。
