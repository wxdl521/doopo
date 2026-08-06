# 转绘返工与结果目录三处修复

## 1. 一句话点名多个片段，只重跑了一个

现状：`parseSegmentRerunIntent` 只解析出第一个片段号（正则取首个匹配），所以「重新生成EP01 U02片段、EP01 U03片段」只提交了 U02。

改法（`src/components/restyle/restyleIntent.ts`）：
- 把 `segmentId?: string` 扩展为 `segments: string[]`（保留 `segmentId` 作为兼容首项），用全局匹配收集所有 `U0x / 0x片段 / 第x段 / segment x`。
- 同理收集多集号 `episodes: number[]`（如「第1集U02、第2集U01」），未指定集时沿用当前唯一集的推断逻辑。
- 补齐单测：多片段、多集、混合表达、去重与排序。

`RestyleStudio.tsx` 的 `handleSegmentRerunIntent`：对解析出的每个片段做校验（该集是否存在该分段），把全部合法片段一次性入队，播报改为「已提交 第1集 U02、U03 局部返工，将按队列逐个重跑」；对不存在的片段单独提示。

## 2. 多次点「重试」不排队，直接被「已有任务进行中」拒绝

现状：`generateRenderedVideos` 开头 `isProjectRunning(projectId)` 即拒绝，用户连点多个失败片段时后面的全被丢弃。

改法（`RestyleStudio.tsx`）：
- 新增按项目的返工待办队列 `pendingRerunsRef: Map<projectId, RerunRequest[]>`。
- `generateRenderedVideos` 在项目忙时：若本次是 `rerun`（含聊天点名与按钮重试），入队并回一句「已加入队列，前面还有 N 个任务，完成后自动开始」，同时把该片段卡片状态置为 `queued`；只有「整集/全量生成」在忙时才保留原来的拒绝提示。
- 队列去重：同 `episode + segmentId` 已在队列或正在跑时，不重复入队，提示「该片段已在队列中」。
- 在渲染队列收尾处（`runRenderQueue` 完成 / `finishRun` 之后、包括失败与合成结束分支）检查待办队列，取出下一个自动调用 `generateRenderedVideos`；点击「停止」时清空该项目待办队列。

## 3. 文件目录「结果 / 成片 / 视频片段」显示错误

现状：`buildRestyleFileTree` 里 `成片` 与 `视频片段` 直接列出所有 `final_video` / `video_clip` 附件。这些附件在任务入队时就以「原片的名字与体积」创建（49.4 MB 即原片大小），因此未生成完成时也会显示，且预览打开的是原片占位，失败片段也被计入数量。

改法（`RestyleStudio.tsx` `buildRestyleFileTree`）：
- 只把 `renderStatus === "succeeded"` 且有 `resultUrl`（或 `url` 指向渲染结果）的文件放进「成片 / 视频片段」，节点体积改用结果文件体积，无则不显示 MB。
- 同一 `episode + segmentId` 只保留最新一条（解决截图 2 里 EP01 U02 出现两行的重复问题，同一处 dedupe 也用于右侧「分段返工」列表）。
- 未完成/失败的片段不进结果目录，统一在右侧「生成状态」里展示，文件夹角标 count 与实际子节点数一致。

## 技术备注

改动集中在 `src/components/restyle/restyleIntent.ts`、`src/components/restyle/RestyleStudio.tsx` 与 `src/components/restyle/__tests__/restyleIntent.test.ts`；不涉及服务端函数与数据库。
