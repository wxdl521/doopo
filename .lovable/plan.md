## 角色生成功能完善

当前 `/characters` 页面直接调用了硬编码的代理服务器 (`http://43.130.52.57:8080`)，且图片接口已不可用。本次将其重构为走项目已有的 OpenRouter 服务函数体系，并接入 OpenRouter 提供的多模态图像生成模型，自动产出 5 个视图。

### 1. 新增图像生成服务函数

文件：`src/lib/openrouterImage.functions.ts`

- 使用 `createServerFn({ method: 'POST' })`，输入 `{ prompt: string, model?: string }`。
- 通过 `OPENROUTER_API_KEY` 调用 `https://openrouter.ai/api/v1/chat/completions`，请求体附带 `modalities: ['image','text']`。
- 默认模型链（自动回退）：
  1. `google/gemini-2.5-flash-image-preview`（Nano Banana，OpenRouter 多模态出图主力）
  2. `google/gemini-2.0-flash-exp:free`（备用，多模态可出图）
- 解析返回的 `choices[0].message.images[0].image_url.url`（OpenRouter 兼容 OpenAI/Gemini 风格的 base64 data URL）。
- 复用现有 retry/timeout 模式：`AbortController` 超时 55s，对 403/404/429 自动切换下一模型，401 直接返回错误。
- 返回 `{ url: string, error: string | null }`，url 为 data URL 可直接 `<img src>`。

### 2. 文本生成沿用 `generateScript`

`src/lib/openrouter.functions.ts` 已具备文本生成 + 模型回退 + 超时处理，无需新写一份；角色描述（200 字以内的设定）调用 `generateScript`，传入：
- `system`: `t.char_system_designer`
- `user`: 角色描述提示词
- `max_tokens: 600, temperature: 0.85`
- `model: 'google/gemini-2.5-flash'`（同样会自动回退）

### 3. 重构 `src/pages/Characters.tsx`

- 删除硬编码 `PROXY_URL`、`IMG_PROXY` 与对应 fetch。
- 通过 `useServerFn` 引入 `generateScript` 与新的 `generateImage`。
- `handleGenerate` 流程：
  1. 把用户描述加入聊天。
  2. 调 `generateScript` 拿到角色设定文本，加入聊天。
  3. 并行 `Promise.allSettled` 调 5 次 `generateImage`，分别对应 5 个视图（正/侧/背/表情/配饰），prompt 为 `Character portrait, {style} style, {description}, {viewMap[v]}, clean background, high quality illustration`。
  4. 任一视图失败则该视图保持空，其他正常显示；全部失败提示错误。
- 错误处理：把每步的 `error` 字段统一展示在底部红字。
- 下载按钮已支持 data URL，无需改动。

### 4. i18n

仅新增一个文案：
- `char_image_generation_failed`：「图片生成失败，请重试或更换风格」/ "Image generation failed, please retry or change style".

### 5. 安全/密钥

`OPENROUTER_API_KEY` 已配置（`generateScript` 在用），无需再加 secret。

### 6. 验证

- 调用 `invoke-server-function` 直接打 `/api/openrouter-image`（如果暴露 HTTP 路由的话）或在 UI 触发一次"生成"，检查浏览器网络与服务函数日志。
- 确认 5 张图按 data URL 形式显示，描述文本正确写入气泡。

### 范围

- 仅修改：`src/pages/Characters.tsx`、新增 `src/lib/openrouterImage.functions.ts`、`src/i18n/{zh,en}.ts` 一行文案。
- 不改 DB、不改样式系统、不动其他页面。
