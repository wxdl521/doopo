# 修复：生成转绘方案时无报错、一直卡在「生成中」

## 现象与定位

你反馈的不是弹出报错，而是「转绘方案」步骤永远停在生成中。截图里红框的 `inpage.js` MetaMask 报错来自浏览器插件，与本功能无关，可忽略。

定位结果（已核对代码，未修改）：

`src/components/restyle/RestyleStudio.tsx` 的 `runPlanGeneration()`（1727 行起）**没有 try / catch / finally**：

```text
beginRun(...)                      // 标记 running = true
result = await callGenerateRestylePlan(...)   // 一旦这里 throw，下面全部跳过
if (!result.ok) { finishRun("failed"); ... }  // 只处理「服务端返回 ok:false」
finishRun(...)
```

只要服务端函数是「抛异常」而不是「返回 ok:false」——例如请求被平台在约 100 秒处切断、502/500、鉴权失败、网络中断——异常会直接冒泡出 `runPlanGeneration`，于是：

- `finishRun` 永远不会被调用 → 进度卡片一直 running（「生成中」）；
- 不会 `appendConversationMessage` → 聊天区没有任何失败提示；
- `isProjectRunning()` 恒为 true → 该项目后续消息被「已有任务正在进行中」挡住，只能刷新页面。

对照 `runSourceAnalysis()`（原片分析）就有完整的 try/catch/finally，所以「分析」失败会报错、「方案」失败会静默卡死——与你观察到的现象完全一致。

叠加因素：`src/lib/restyleAnalysis.functions.ts` 的 `generateRestylePlan` 自带 180 秒超时，但它是一次性（非流式）返回，托管平台在约 100 秒无字节时就会切断连接。也就是说方案生成一旦跑满两三分钟，必然走到「客户端抛异常」这条无人接管的路径。

同样缺少异常兜底的还有 3913 行的「分段提示词微调」分支（同一个 `callGenerateRestylePlan` 调用）。其余分支（分析、生图、视频）均已有 try/catch。

## 修复方案

### 1. 给方案生成加异常兜底（根因）

`runPlanGeneration()` 改为：

- 整段调用包进 `try / catch / finally`，与 `runSourceAnalysis()` 保持同一套写法；
- `catch`：`finishRun(projectId, "failed", detail)` + 在聊天区追加「转绘方案生成失败：<原因>」+ `setAnalysisError`；
- `finally`：未中止时兜底 `finishRun(projectId)`，保证 running 一定被清掉；
- 中止（用户点停止）时保持现有 `isRunAborted` 早退语义，不误报失败。

3913 行「分段提示词微调」分支做同样处理。

### 2. 避免请求被平台静默切断

`generateRestylePlan` 的 180 秒超时下调到平台切断阈值以内（90 秒），让超时由服务端自己返回可读的 `{ ok:false, error:"方案生成超时，请稍后重试。" }`，而不是连接被切断后在客户端抛异常。

### 3. 全局兜底

在 `sendChatMessage()` 外层补一层 `try / catch`：任何未预期异常都落到「失败」态并给出提示，防止以后新增分支再次出现「静默卡死」。

## 涉及文件

- `src/components/restyle/RestyleStudio.tsx`：`runPlanGeneration()`、提示词微调分支、`sendChatMessage()` 兜底
- `src/lib/restyleAnalysis.functions.ts`：`generateRestylePlan` 超时时长

## 验证

- 断网 / 模拟服务端 500 后触发「继续下一步」：聊天区应出现「转绘方案生成失败：…」，进度卡片变为失败，可继续发下一条消息；
- 正常链路：方案照常生成，行为不变。
