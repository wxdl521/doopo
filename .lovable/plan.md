## 问题根因

前端调用了 `otu/...` 前缀的图像模型(例如 `otu/image2`),走到 `src/lib/otuImage.functions.ts` → `callOtuImage()`。该函数读取 `process.env.OTU_API_KEY`,但项目当前已配置的 20 个 Secret 中**没有** `OTU_API_KEY`,因此命中:

```ts
if (!apiKey) {
  return { url: '', urls: [], error: 'OTU_API_KEY not configured', model }
}
```

错误透传到前端,显示为"OTU_APL KEY not configured"(用户描述里的 APL = API 的 OCR/笔误)。

其他同类供应商(ARK / AZURE / PIXFLOW / ONETOKEN / TOKENFLASH / AIGCFAMILY 等)的 Key 都已配置,只有 OTU 这一家缺失。这不是代码 Bug,代码逻辑是对的:在缺密钥时给出明确报错而不是 500。

## 解决方案

需要把 OTU AI Gateway 的 API Key 录入到 Lovable Cloud 后端 Secret 里。流程:

1. 你登录 https://otuapi.com 控制台,复制账号下的 API Key(形如 `sk-xxxxxxxx`)。
2. 把它发我,我用 `add_secret` 工具写入名为 `OTU_API_KEY` 的后端密钥,仅在服务端可见,不会进入前端 bundle。
3. (可选)如果你使用的 OTU 接入地址不是默认的 `https://otuapi.com`,再告诉我新的 base url,我同步写入 `OTU_BASE_URL`;否则保持默认即可。
4. 写入后服务端函数立刻读到环境变量,无需改任何代码。重试生成即可。

## 备选方案

如果你**不打算继续使用 OTU 这一路供应商**,告诉我之后,我可以从前端模型选择器里移除所有 `otu/` 前缀的选项,避免用户误触发同样的报错。这条不需要密钥,只是 UI 清理。

## 不会改动的内容

- `src/lib/otuImage.functions.ts` 不修改,缺密钥的报错路径是合理设计。
- 其它供应商的代码、RLS、迁移、bucket、`assetsStorage.ts`、`workspaceMedia.functions.ts` 均不动。
