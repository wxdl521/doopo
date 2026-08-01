## 目标

转绘工作台三项改造：把「正在思考…」升级为可见的执行过程、给发送键加停止能力、把单任务串行改成按项目并发。

## 现状（已核对代码）

- `RestyleStudio.tsx:873` 只有一个全局 `isAnalyzing` 布尔。它同时控制：聊天区的思考提示（3660 行）、发送键禁用与转圈（3917-3926 行）、Enter 发送拦截（3805 行）、模型下拉禁用。
- 因为它是组件级单值，**切换到别的转绘项目后发送键依然是禁用态**，这就是「不支持并发」的直接原因。
- 思考态渲染的只是一行静态文案 `t.restyle_analysis_running`（zh.ts:1588 = "正在思考…"），流程内部（分析 → 资产 → 生图 → 视频）的阶段推进只在右侧「过程与提示词」面板体现，聊天流里不可见。
- `sendChatMessage`（2330 行起）内部有 5 处 `setIsAnalyzing(true/false)` 分支，所有 fetch 都通过 `useServerFn` 调用，目前**没有任何 AbortController**，因此没有可中断点。

## 改动

### 1. 并发：按项目隔离运行态

- 用 `runState: Record<projectId, RestyleRunState>` 取代全局 `isAnalyzing`。
  `RestyleRunState = { running: boolean; phase: string; steps: RunStep[]; abort: AbortController; startedAt: number }`（`abort` 存在 ref 里，不进 state）。
- 派生 `const activeRun = runState[activeProjectId]`，UI 一律读 `activeRun?.running`，切项目即读另一份状态，互不阻塞。
- `sendChatMessage` 内所有分支把 `setIsAnalyzing` 换成 `beginRun(projectId, phase)` / `updateRun(projectId, ...)` / `endRun(projectId)`，并在闭包里固定 `projectId`（已有该变量）。
- 同一项目内仍然串行（重复发送给出「当前项目任务进行中」提示），不同项目可同时跑。
- 左侧项目列表 / 对话列表在跑任务的项目上加一个小转圈标记，让用户知道后台还有任务。

### 2. 停止：发送键变停止键

- `RestyleRunState.abort` 持有 `AbortController`；把 `signal` 透传给流程内每个 `useServerFn` 调用（TanStack `useServerFn` 支持 `{ data, signal }`）。
- 发送按钮：`running` 时改为 `type="button"`、方形停止图标（`Square`）、`aria-label` 为「停止」，点击调用 `stopRun(projectId)`；不再显示转圈。
- `stopRun` 触发 abort → 各流程 `catch` 中识别 `AbortError`，不写错误消息，改为在对话里追加一条「已停止：本次任务在「XX 阶段」被用户中止，已生成的资产已保留」。
- 已提交给视频/图片供应商的远端任务无法真正撤单，前端停止轮询并在日志里注明；这一点在停止提示文案里说清楚。
- Enter 发送：`running` 时不发送（保持现状），但按 `Esc` 触发停止。

### 3. 思考过程可视化

- `RestyleRunState.steps` 记录阶段流水：`{ id, label, status: pending|running|done|failed, detail?, at }`。
  阶段来自现有流程节点：接收指令 → 读取原片/关键帧 → 模型分析（显示所用模型）→ 资产表生成 → 逐个资产生图（带 `资产名 3/7`）→ 方案生成 → 视频分段提交 → 轮询进度。
- 聊天流底部把原来那一行文案换成 `RunProgressCard` 组件：竖向步骤列表 + 当前步骤转圈 + 已用时秒数 + 右上角停止按钮，完成后折叠成一行「本次共 8 步 · 用时 42s（点击展开）」。
- 该卡片复用 `RestyleProcessPanel` 的视觉规范（勾选/转圈/灰点三态），避免两套样式。
- 生图/视频子任务的进度沿用已有的 `assetRunStatus` 与 `renderLog`，只是把其摘要投射进步骤卡片，不重复请求。

### 4. i18n

`zh.ts` / `en.ts` 同步新增：停止、已停止、任务进行中、阶段名（分析中/生成资产/生成图片/提交视频/等待模型返回）、耗时与步骤计数模板等键。

## 验证

- 项目 A 发起分析后立即切到项目 B 发送另一条指令：两边各自显示自己的步骤卡片，互不禁用。
- A 跑到「逐个资产生图」时点停止：按钮恢复发送态，对话追加停止说明，已生成资产仍在，B 的任务不受影响。
- 步骤卡片在分析 → 资产 → 生图各阶段依次点亮，失败阶段标红并保留错误文案。
- 跑 `bunx vitest run src/components/restyle` 并更新受影响用例（现有用例用 `发送` 按钮名断言，需要兼容停止态命名）。

## 技术备注

- 只改前端交互与状态组织，不动服务端函数签名与模型路由；`signal` 是 `useServerFn` 既有可选参数。
- 远端已提交的视频任务停止后不再轮询，任务本身仍在供应商侧执行，重新进入项目时按 `renderTaskId` 可继续查询。
