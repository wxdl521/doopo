# 转绘工作台右栏改为分段切换（Tab）

## 设计判断
你的方案合理，我建议在此基础上稍作优化：右栏顶部标题行改成 **三段式 Tab**：`设置` / `流程` / `文件`，默认停在「设置」。这样每次只渲染一块内容，右栏不再堆叠三大块，配合内部滚动条即可完整查看长内容（调色台不会再被截断）。

比纯 Tab 更好的两处细节：
- **Tab 上带状态角标**：流程 Tab 在分析/生图/渲染进行中时显示小圆点或进度数字，文件 Tab 显示文件数量，用户切走也知道后台在跑。
- **记住上次选中的 Tab（按项目）**：切项目/刷新后回到用户上次看的那一栏，避免每次都要重新点。
- 需要人工确认时（分步护航/自定义干预的关卡），自动跳到对应 Tab 并高亮，避免用户停在「设置」页错过确认。

## 实施内容
1. 右栏 `<aside>` 顶部：保留「项目文件」标题与上传/画布按钮，其下加一行分段控件（设置 / 流程 / 文件），选中态用 accent 底色。
2. 内容区：`min-h-0 flex-1 overflow-y-auto`，按当前 Tab 只渲染对应面板（`RestyleSetupPanel` / `RestyleProcessPanel` / 项目文件树），保证任意一栏都能上下滚动到底。
3. `RestyleProcessPanel` 去掉内部 `max-h-[52vh]` 限高，交给外层统一滚动，避免双滚动条。
4. Tab 角标：流程栏取现有 `isAnalyzing` / `assetRunStatus` 状态；文件栏取文件树节点数。
5. Tab 选择状态按 `projectId` 记在组件 state（配合 localStorage 记忆最近一次选择）。
6. 出现待确认关卡时自动切到「流程」Tab。
7. i18n：`zh.ts` / `en.ts` 同步补三个 Tab 文案。

## 技术说明
仅改动 `src/components/restyle/RestyleStudio.tsx` 右栏渲染、`RestyleProcessPanel.tsx` 限高类名，以及 i18n 文案；不涉及业务逻辑、数据结构与接口。现有面板组件保持原样复用，测试（RestyleStudio.test / RestyleSetupPanel.test）若因默认只渲染设置栏而受影响，会同步调整用例先切到对应 Tab 再断言。
