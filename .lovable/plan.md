# 修复：角色详情页「重新生成」没有真正使用用户修改后的提示词

## 问题

渠道（Azure gpt-image-2）返回 400「被内容安全系统拒绝」后，用户在角色弹窗的「角色提示词（可编辑）」里改掉了敏感/问题描述再点「重新生成」，但送到接口的仍是旧提示词，于是继续报同样的错。

已确认原因（`src/routes/workspace.$workspaceId.tsx`）：

- `submitCharacterDetailT2I` 只要该角色历史图上存在 `record.rawPrompt`，普通角色就会走 `mergeRawPromptWithLatestEdits`：把**旧的完整原始提示词整段保留**，仅在末尾追加一段 `[LATEST USER EDITS — T2I]`。
- `processCharacter` 收到 `rawPrompt` 后直接原样提交给渠道，不再按用户编辑后的角色属性重建提示词。
- 结果：用户删除/改写的旧内容依旧在提示词主体里，安全系统再次判定为违规；用户的修改只是一段被主体压过的附加说明。
- 生成失败时不会写入新的 prompt 记录，所以被复用的 `rawPrompt` 往往还是更早那一版，和用户当前看到的编辑内容脱节。

## 修复方案

1. **普通角色以用户编辑为唯一来源**：`submitCharacterDetailT2I` 中，仅当当前图是预设模板（`three-view` / `multi-asset`，需要逐版块回填完整模板）时才复用 `record.rawPrompt`；普通角色不再传 `rawPrompt`，让 `processCharacter` 用已解析的 `editedCharacter`（来自用户编辑后的中文提示词）重新拼装 T2I 提示词。
2. **移除追加式覆盖**：`mergeRawPromptWithLatestEdits` 的「保留旧全文 + 末尾追加编辑」策略不再用于普通角色重新生成（预设模板走的逐版块替换 `mergePromptEditorBlocksForGeneration` 保持不变）。
3. **失败记录不参与复用**：只有成功出图时写入的 prompt 记录才可作为重放来源；上一轮失败后，重新生成一律按当前编辑内容重建。
4. **错误提示更明确**：`classifyError` 增加对「safety system / content policy / 400」的识别，提示「提示词被内容安全系统拒绝，请修改敏感描述后重试」，并保留 requestId 便于排查，避免只显示「生成失败」。
5. **回归测试**：为提示词组装加单测，覆盖「普通角色编辑后重新生成 → 提交内容等于编辑后重建的提示词，且不含旧提示词残留」「预设模板重新生成仍按版块合并」两种情况。

## 影响范围

- `src/routes/workspace.$workspaceId.tsx`（角色详情页重新生成路径、错误提示）
- 新增单测文件（`src/lib/__tests__/` 或对应组件测试目录）
- 场景/道具的详情页重新生成沿用相同判定，一并核对，避免同类残留。
