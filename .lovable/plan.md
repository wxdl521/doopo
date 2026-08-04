# 转绘右栏面板：去掉重复的面板标题

## 现状确认（已读代码）

右栏结构是「顶部栏（文件夹图标 + 项目文件）→ 设置/流程/文件 三个 Tab → Tab 内容」。
三块内容各自又带了一层标题，与 Tab 名重复：

- 设置：`RestyleSetupPanel.tsx` 第 211-213 行，`Gauge` 图标 + `t.restyle_setup_title`（视频转绘工作台）—— 即截图红框。
- 流程：`RestyleProcessPanel.tsx` 第 87-89 行，`ListTree` 图标 + `t.restyle_process_panel`，且这行同时是折叠/展开按钮。
- 文件：`RestyleStudio.tsx` 第 5502-5503 行的顶部栏 `FolderOpen` + 「项目文件」；文件 Tab 内部另有一行项目名 + 「跟转绘步骤一一对应」说明。

## 变更内容

1. **设置 Tab**：删除 `Gauge` 图标 + 标题那一行，内容上移，保留内边距。
2. **流程 Tab**：同样删除图标 + 标题行。该行兼作折叠开关，Tab 切换已能隐藏整块内容，折叠开关冗余，改为始终展开（移除 `collapsed` 状态与 chevron），避免出现无标题的空按钮。
3. **文件 Tab**：顶部栏的「项目文件」标题不再准确（它是整个右栏的标题，而三个 Tab 里只有一个是文件）。改为不显示写死标题，只保留左侧图标位与右侧上传/画布按钮；文件 Tab 内部保留项目名与说明行不变。
4. 清理因此不再被引用的 i18n 键与图标 import（`restyle_setup_title`、`restyle_process_panel`、`restyle_project_files` 视引用情况处理，zh/en 同步）。

## 涉及文件

- `src/components/restyle/RestyleSetupPanel.tsx`
- `src/components/restyle/RestyleProcessPanel.tsx`
- `src/components/restyle/RestyleStudio.tsx`（右栏顶部栏）
- `src/i18n/zh.ts`、`src/i18n/en.ts`

## 验证

- 打开 `/restyle`，三个 Tab 依次切换：内容顶部不再出现与 Tab 名重复的标题，间距正常无空白塌陷。
- 流程 Tab 内容默认完整展开，滚动正常。
- 运行现有 vitest（含 `restyle-setup-panel` / `restyle-process-panel` 相关用例）与类型检查通过。
