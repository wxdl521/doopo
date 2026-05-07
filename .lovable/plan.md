## 目标

把 `src/pages/Scripts.tsx` 中的剧本生成 / 优化两个调用，从 `http://43.130.52.57:8080/v1/chat/completions` 切换到 OpenRouter 官方 API（`https://openrouter.ai/api/v1/chat/completions`）。其它模块（首页、角色页等）暂不动。

## 关键决策

**密钥不放前端**。你给的 `sk-or-v1-...` 是私有 API Key，如果直接写在 React 里会随构建产物公开，任何访问者都能盗用。正确做法：

1. 启用 Lovable Cloud（提供后端运行环境）
2. 将密钥存为后端 secret `OPENROUTER_API_KEY`
3. 创建一个 TanStack Start 服务端函数 `generateScript`，由它去调 OpenRouter，前端只调这个函数

## 实施步骤

1. **启用 Lovable Cloud**（用于运行服务端函数 + 存储 secret）。
2. **添加 secret** `OPENROUTER_API_KEY`，值为你提供的 key。
3. **新增** `src/lib/openrouter.functions.ts`：
  - 导出 `generateScript`（createServerFn，POST）
  - 入参：`{ messages, model?, max_tokens?, temperature? }`
  - 服务端读取 `process.env.OPENROUTER_API_KEY`，请求 OpenRouter，返回 `{ content }`
  - 错误时返回友好错误信息（401 / 429 / 网络错误分别处理）
4. **改造** `src/pages/Scripts.tsx`：
  - 删除 `PROXY_URL` 常量
  - `handleGenerate` 与 `handleOptimize` 改用 `useServerFn(generateScript)`
  - 默认模型：`deepseek/deepseek-chat-v3.1:free`（OpenRouter 上免费，与原模型一致家族）
5. **验证**：在 `/scripts` 创建一条剧本，确认能正常返回内容；查看 network/console 无报错。

## 不在范围

- 不改 `HeroPromptInput`、`Characters` 等其它仍调用旧 PROXY_URL 的模块（如需后续可同样处理）
- 不引入流式输出（保持现有非流式以最小改动）
- 不改 i18n 文案

## 询问

确认两点后开始：

1. 同意启用 Lovable Cloud 来安全存放 OpenRouter 密钥？ 保证安全情况下同意
2. 默认模型用 `deepseek/deepseek-chat-v3.1:free`（免费）还是你指定的其它型号？是