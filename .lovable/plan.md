## 目标

转绘工作台的「文本模型」下拉里增加 **GPT-5.5** 选项，调用 Lovable AI 提供的 `openai/gpt-5.5`，用于资产提取与转绘方案生成两个环节。

## 现状

- 下拉选项来自 `src/components/restyle/RestyleStudio.tsx` 的 `RESTYLE_MODELS`（目前 5 项：ARK DeepSeek / Doubao、DashScope Qwen ×3）。
- 服务端 `src/lib/restyleAnalysis.functions.ts` 里的 `analyzeRestyleAssets` 与 `generateRestylePlan` 用 `ark:` / `qwen:` 前缀二选一分流，各自拼 endpoint、Key 与请求体。

## 改动

1. `RESTYLE_MODELS` 增加 `{ id: "lovable:openai/gpt-5.5", label: "GPT-5.5 · 视觉" }`。
2. `restyleAnalysis.functions.ts`
   - `InputSchema.model` 枚举加入该 id（`generateRestylePlan` 复用同一枚举，自动生效）。
   - 把现有的 `isArk` 布尔分流改成三分支的小工具函数：返回 `{ provider, model, endpoint, apiKey }`。
     - `lovable` → `https://ai.gateway.lovable.dev/v1/chat/completions`，`Authorization: Bearer ${process.env.LOVABLE_API_KEY}`（在 handler 内读取）。
   - 请求体按 GPT-5 系列要求裁剪：不发 `temperature`、不发 `max_tokens`，改用 `max_completion_tokens`；`thinking` 字段仅 ARK 发送；`response_format: { type: "json_object" }` 在方案生成里保留。
   - 关键帧：GPT-5.5 支持图片输入，因此 `canReadFrames` 判定放开为「非 ARK 且非 qwen3.7-max」，Lovable 分支同样走 `image_url` 多模态消息。
   - 错误文案与缺 Key 提示补上 Lovable 分支（缺 `LOVABLE_API_KEY` 时提示未配置）。
3. 前端错误重标签 `relabelRestyleError` 无需改动（按 label 匹配已覆盖）。

## 验证

- 单测跑 `src/components/restyle/__tests__`，确保无回归。
- 选中 GPT-5.5 实际发一次资产分析请求，读取响应确认 200 且返回可解析 JSON；若网关返回 400 按报错调整请求字段。

## 技术备注

- `LOVABLE_API_KEY` 已由平台自动注入，只在服务端 handler 内读取，不暴露前端。
- 费用由工作区积分扣减，429/402 的错误信息会原样透传到聊天面板。
