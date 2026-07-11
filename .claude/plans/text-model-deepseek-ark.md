# 文本模型切换：Qwen → DeepSeek V4 Pro（火山方舟）为主，Qwen 兜底

## 决策（已与用户确认）

- **Model ID**：`deepseek-v4-pro-260425`（DeepSeek V4 Pro，ARK Chat API `/v3/chat/completions`，支持 Function Call / 结构化输出 / 流式 / `thinking.type` 开关）
- **策略**：DeepSeek 为主，失败回退 Qwen（保留现有 Qwen 代码作 fallback）
- **Key**：复用现有 `process.env.ARK_API_KEY`（与图片/视频同 key，base `https://ark.cn-beijing.volces.com/api/v3`）。不改 `.env.local`。
- **thinking**：所有 ARK DeepSeek 调用显式带 `thinking: { type: "disabled" }`（通用对话快模式，避免深度思考 30 分钟级超时，与 Qwen 无思考行为对齐）。
- **范围**：5 处纯文本调用改为「DeepSeek 优先 + Qwen 兜底」；1 处 qwen-vl 视觉模型（`describeCharacterImage`）**不动**（DeepSeek 文本模型无法看图）；UI 模型选择器（`Scripts.tsx` / `ScriptComposer.tsx` 默认 gemini）**不动**（用户显式选的模型照旧，只改「系统默认/无 model」这条路）。

## 新增共享 helper：`src/lib/arkText.ts`

集中 ARK 文本调用常量，避免 5 个文件各自硬编码 model id / endpoint 漂移：

```ts
export const ARK_TEXT_MODEL = "deepseek-v4-pro-260425";
export const ARK_TEXT_THINKING_DISABLED = { type: "disabled" } as const;
export function arkTextApiKey(): string | undefined {
  return process.env.ARK_API_KEY;
}
export function arkTextEndpoint(): string {
  const base = (process.env.ARK_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3").replace(/\/+$/, "");
  return `${base}/chat/completions`;
}
```

## 逐文件改动

### 1. `src/lib/aiGenerate.functions.ts` — 舞台结构化生成（tool calling，非流式）

当前：`generateStageAi` 里 `if (qwenKey) { tryQwen; ok 则 return }`，后面 lovable/minimax 注释掉。

改法：在 `tryQwen` **之前**插入 `tryArkDeepSeek`（若 `ARK_API_KEY` 存在）。成功即 return；失败落到 `tryQwen`。

- endpoint = `arkTextEndpoint()`，key = `arkTextApiKey()`，model = `ARK_TEXT_MODEL`
- body 跟 `tryQwen` 同构（`tools` / `tool_choice` / messages），额外加 `thinking: ARK_TEXT_THINKING_DISABLED`
- 不传 `temperature`（ARK DeepSeek 默认即可；如需可加 0.7）
- 响应解析同 qwen：`json.choices[0].message.tool_calls[0].function.arguments` → JSON.parse
- 错误处理与 `tryQwen` 一致（429→rate_limit / 402→no_credits / AbortError→timeout）
- 超时沿用 55s（与 tryQwen 一致；DeepSeek V4 Pro 通用模式够快）

### 2. `src/lib/scriptAgent.functions.ts` — 剧本智能体流式生成

当前：`pickModel(raw)` 默认（空/裸 id）→ `{provider:"qwen", model:"qwen-plus"}`；`streamChat` 按 provider 选 endpoint/key，403 内容审核会递归回退 lovable gemini。

改法：
- `Provider` 类型加 `"ark"`；`pickModel` 默认改为 `{provider:"ark", model: ARK_TEXT_MODEL}`（裸 id / 空 → ark deepseek）。其余前缀（`qwen:` / `lovable:` / `openrouter:` / `gemini:` …）保持原语义。
- `streamChat`：
  - apiKey 选择加 ark 分支：`provider==="ark" ? arkTextApiKey() : ...`
  - endpoint 选择加 ark 分支：`provider==="ark" ? arkTextEndpoint() : ...`
  - body 当 `provider==="ark"` 时加 `thinking: ARK_TEXT_THINKING_DISABLED`
  - key 缺失处理：若 ark 但 `ARK_API_KEY` 缺失且有 Qwen → 直接改走 qwen（不报错）
  - **失败回退**：在 `!upstream.ok` 分支，若 `picked.provider==="ark"` 且尚未回退过，递归 `yield* streamChat({...opts, model: "qwen:qwen-plus", _fallback: true})`（新增内部可选字段 `_fallback?: boolean` 防重入）。403 内容审核的 lovable gemini 回退逻辑保留。
  - 流已开始吐 delta 后出错：维持现状（yield error），不回退（与现有「部分输出不可撤回」语义一致）。

### 3. `src/lib/parseImportedScript.functions.ts` — 导入剧本解析（tool calling，非流式单发）

当前：`fetchChat(provider, model, ...)`；`pickModel(data.model)` 默认 qwen；catch 到 `content_policy` 会回退 lovable gemini。

改法：
- `Provider` 类型加 `"ark"`；`fetchChat` 加 ark 分支（endpoint=`arkTextEndpoint()`，key=`arkTextApiKey()`，body 加 `thinking`）。
- `pickModel` 默认已变 ark（改动 #2 自动生效，本文件 import 自 scriptAgent）。
- **失败回退**：在 catch 块，若 `picked.provider==="ark"` 且错误非 content_policy（即网络/超时/4xx/5xx/限流），回退 `fetchChat({provider:"qwen", model:"qwen-plus", ...})`；content_policy 仍走 lovable gemini。ark key 缺失则在请求前直接降级 qwen。

### 4. `src/lib/scriptPipeline.functions.ts` — logline/大纲/场次/角色（tool calling，死代码但顺手改）

当前：`parseModel` 默认 qwen；`callToolCall` 选定一个 provider 后在其 endpoint 上循环 `[model, ...fallbacks]`。

改法：
- `parseModel` 默认改 `{provider:"ark", model: ARK_TEXT_MODEL}`；`Provider` 加 `"ark"`。
- `callToolCall` 重构「尝试序列」为**每条 attempt 自带 provider 信息**，使跨 provider 兜底成立：
  - attempts = `[ {provider:"ark", model:ARK_TEXT_MODEL}, ...QWEN_FALLBACKS.map(m=>({provider:"qwen",model:m})) ]`（仅当 ark key 存在才把 ark 放首位；否则纯 qwen）
  - 循环内按 attempt.provider 取 endpoint/key/headers/body（ark 加 `thinking`，qwen 加 `temperature`，lovable 不加 temperature）
  - 解析 `tool_calls[0].function.arguments` 同现有
  - 保留现有 content_policy → lovable gemini 跨 provider 回退

### 5. `src/lib/storyboard.functions.ts` — 剧情切分镜（SSE 流式 JSON）

当前：`modelAttempts = [data.model||"qwen3.6-flash", "qwen3.6-flash", "qwen3.6-plus", "qwen3.7-max"]`，单 endpoint（DashScope）单 key 循环；用 `response_format:{type:"json_object"}` + `StreamingGroupExtractor` + `extractJsonBlock`；有 `yieldedAny` 不回退的语义。

改法：
- 把 `modelAttempts` 改为**带 provider 的尝试序列**：
  ```
  [
    {provider:"ark", model:ARK_TEXT_MODEL, timeout:120_000},
    {provider:"qwen", model:"qwen3.6-flash", timeout:60_000},
    {provider:"qwen", model:"qwen3.6-plus", timeout:90_000},
    {provider:"qwen", model:"qwen3.7-max", timeout:180_000},
  ]
  ```
  （ark 仅在 `ARK_API_KEY` 存在时放首位；`data.model` 仍可覆盖首项）
- key/endpoint 按 attempt.provider 选（ark 用 `arkTextEndpoint()`/`ARK_API_KEY`，qwen 用 DashScope/`Qwen||DASHSCOPE_API_KEY`）。
- body：ark attempt **不传** `response_format`（避免 ARK 对该参数潜在的 400 浪费首尝试），改靠强 JSON prompt + `StreamingGroupExtractor` + `extractJsonBlock` 兜底（extractor 的 `waiting_array` 状态可吞掉 prose 前导）；ark body 加 `thinking:disabled`。qwen attempt 保持 `response_format:{type:"json_object"}`。
- `yieldedAny` / `modelSucceeded` / 超时 / `FALLBACK_RETRYABLE` 语义全部保留。
- progress 文案里模型名仍用 attempt.model，无影响。

### 不改的文件

- `src/lib/describeCharacterImage.functions.ts`：qwen-vl 视觉模型，DeepSeek 文本模型替代不了，**保持 Qwen-VL**。
- `src/pages/Scripts.tsx` / `src/components/scripts/ScriptComposer.tsx`：UI 模型选择器与默认（gemini）不动。用户显式选模照旧；只有「无 model / 系统默认」这条路改走 DeepSeek 优先。

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| ARK DeepSeek `response_format:json_object` 可能 400 | storyboard 的 ark attempt 不传该参数，靠 prompt+extractor；其余路径用 tool calling 强结构化，不需 `response_format` |
| 流式 DeepSeek 中途失败无法回退 | 与现有 qwen 语义一致：仅「请求未开始流」时回退；已吐 delta 则报错（可接受） |
| ARK_API_KEY 未配置 | 各处均先判 `arkTextApiKey()`，缺失则跳过 ark、直接走 qwen（功能不中断） |
| tool calling 兼容性 | DeepSeek V4 Pro 官方支持 Function Call，响应格式与 OpenAI 兼容（`tool_calls[0].function.arguments`） |
| thinking 默认开启导致超时 | 显式 `thinking:{type:"disabled"}` |

## 验证

- `bun run lint` 通过
- 手动/日志确认：舞台生成、剧本流式、导入解析、分镜切分四条链路首请求落到 `deepseek-v4-pro-260425`（ARK host），失败时日志可见回退到 qwen
- 角色图描述仍走 qwen-vl（未改动）

## 不在本次范围

- UI 选择器新增「DeepSeek V4 Pro」选项（用户未要求，可选后续）
- 生产 env 配置（用户自行确保 `ARK_API_KEY` 已含 DeepSeek 权限；ARK key 账号级，图片/视频已在用，大概率已开通）
