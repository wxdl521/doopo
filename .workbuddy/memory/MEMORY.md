# Doopoo AI Creative Studio — Project Memory

## 项目概览
AI 驱动的短剧/创意内容全流程生产平台（灵感→剧本→角色/场景→分镜→视频）。
技术栈：TanStack Start + Cloudflare Workers + Supabase + Bun（唯一包管理器）。

## 图像供应商接入模式
新增 OpenAI 兼容图像供应商的标准流程：
1. 新建 `src/lib/xxxImage.functions.ts`（参考 `otuImage.functions.ts`，含 I2I 支持）
2. 在 `src/lib/seedream.functions.ts` 的 6 个路由分发块中添加 `xxx/` 前缀分支
3. 在 `src/lib/imageModels.ts` 添加模型目录条目
4. 在 `src/components/NewProjectDialog.tsx` 的 `imageModelOptions` 添加选项
5. 在 `.env` 添加 `XXX_BASE_URL`，API Key 放 Cloudflare Secrets

## API Key 管理
- 生产环境：Cloudflare Workers Secrets（`wrangler secret put KEY_NAME`）
- 本地开发：`.env.local`（不提交 Git）
- 代码读取：`process.env.XXX_API_KEY`（服务端 Server Function 内）

## 当前图像供应商（2026-06）
ARK Seedream（主力）/ Pixflow / Tokenflash / AIGCFamily / Azure / OneToken / OTU / AI Tokenvibe / 天鸿智算 / ailinzi / TokenHub / nagora.ai(Azure 渠道) / vapeur.ai / DashScope

## 视频生成后端（2026-06）
ARK Seedance（主力）/ DashScope HappyHorse/Wan / 即梦 3.0 Pro / 筷子科技丽帧（中转 Seedance）/ ToAPIs（中转 Seedance 2）/ k99.tw（Sora 风格 API）/ vapeur.ai（中转 Seedance 2.0，待充值验证）

## 视频供应商接入模式
新增视频后端的标准流程：
1. 在 `src/lib/videoGenerate.functions.ts` 的 `getVideoBackend()` 加前缀分支
2. 新增 `xxxSubmit()` / `xxxPoll()` 两个函数
3. 在 `submitVideoTask()` 和 `pollVideoTask()` 各加分支
4. `VideoBackend` 类型加新值，`PollServerInput` zod 枚举同步
5. 在 `src/components/NewProjectDialog.tsx` 的 `videoModels` 加选项
6. 在 `.env` 加 `XXX_BASE_URL`，API Key 放 Cloudflare Secrets
