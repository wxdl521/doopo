# 转绘：用聊天指令重跑指定集/片段的视频

## 问题

用户在视频阶段说「重新生成第一集01片段」，系统却从资产图片开始重跑了一遍。

原因在对话指令路由（`src/components/restyle/RestyleStudio.tsx` 的 `sendChatMessageInner`）：

- 「重新生成…」命中 `isRegenerateIntent`，而只要项目里已有资产图（`generatedAssetFiles.length > 0`），该消息就被判定为 `isAssetImageRequest`（生图纠错分支），进而调用 `generateAssetImages`。
- 消息里没有任何资产名，`requestedAssets` 回落成「整张资产表」，于是全部角色/场景/道具重画。
- 现有的按集/按片段重跑能力（`generateRenderedVideos(projectId, conversationId, { episode, segmentId, feedback })`）目前只有右侧「返工」按钮能触发，聊天里没有入口。

失败提示方面：单个片段失败会写进该片段的 `renderError` 与生成状态日志（如时长超限的上游 400），但对话里的收尾播报只说「某某片段失败，请在右侧查看原因」，没有把具体原因和可执行的下一步说清楚。

## 修复方案

### 1. 新增「片段/整集重跑」意图识别（`src/components/restyle/restyleIntent.ts`）

新增 `parseSegmentRerunIntent(message)`：当消息含「重新生成 / 重跑 / 重出 / 再生成 / 重做」等重做词，且出现视频语境（片段 / 分段 / U01 / 集 / EP01 / 成片 / 视频）时，解析出：

- `episode`：支持 `EP01`、`第一集`、`第1集`、`01集`（中文数字与阿拉伯数字都覆盖）。
- `segmentId`：支持 `U01`、`01片段`、`片段1`、`第二段`；未指定表示整集重跑。
- `feedback`：用户原话，作为返工反馈透传。

仅在消息未指向资产语义（资产表 / 角色 / 场景 / 道具 / 资产图片）时才判为视频重跑，避免抢走「重新生成场景图片」。

### 2. 在指令路由中前置分支（`RestyleStudio.tsx`）

在生图纠错分支（`isAssetImageRequest`）之前插入：

- 解析成功且项目已有 `planEpisodes` 或已有渲染产物 → 调用 `generateRenderedVideos(projectId, conversationId, { episode, segmentId, feedback })`，等价于点「返工」按钮，只重跑目标片段。
- 命中集号但项目没有该集，或命中片段号但该集没有该分段 → 不启动渲染，直接回一条明确提示，列出当前可用的集与分段编号。
- 只说「重新生成01片段」没说集号时：取唯一集，或最近一次渲染所在集；多集且无法唯一确定时反问要哪一集。

### 3. 明确的失败提示

- 单段失败：在渲染队列的失败处理里，除写 `renderError` 外，向对话追加一条消息，包含「集号 + 分段号 + 原始错误文本 + 建议动作」。已知上游错误做归类文案：
  - 参考视频时长超限（TopenRouter `Duration must be between 1.8s and 30.2s`）→ 说明该分段对应原片区间超出模型限制，建议缩短分段或改用无参考视频提交。
  - 缺少资产图 / 参考图 → 指向「生成资产图片」。
  - 其他上游 4xx/5xx → 原样展示错误与 requestId（若有）。
- 队列收尾播报 `completeRenderQueue`：把失败分段的首条错误摘要直接拼进消息，而不是只让用户去右侧看。

## 技术要点

- 改动文件：`src/components/restyle/restyleIntent.ts`（新增解析函数）、`src/components/restyle/RestyleStudio.tsx`（新增路由分支与失败播报）、`src/i18n/zh.ts` 与 `src/i18n/en.ts`（新增提示文案键）。
- 复用既有 `generateRenderedVideos` 的 rerun 参数，不新增服务端函数，不触碰资产生成链路。
- 为 `parseSegmentRerunIntent` 补 Vitest 用例：集 / 片段各种写法、与资产生图语句的互斥、缺集号回退。