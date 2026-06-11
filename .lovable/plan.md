## 目标

让 `src/lib/videoGenerate.functions.ts` 成为统一的"视频生成 AI Gateway",完整对接火山方舟 Seedance(包括参考视频/参考音频/多参考图/音频生成)以及即梦 3.0 Pro,前端调用入口不变。

## 改动范围

### 1. `src/lib/videoGenerate.functions.ts`(主改动)

扩展 ARK Seedance 提交载荷,以匹配官方 cURL 示例的完整能力:

- 新增模型注册:
  - `doubao-seedance-2-0-260128`(已存在,作为默认)
  - `doubao-seedance-2-0-fast-260128`(新增,720p fast)
- `submitVideoTask` 输入扩展:
  - `referenceImageUrls: string[]`(支持多张 reference_image,而不是只把第二张起当 reference)
  - `referenceVideoUrl?: string`(role=`reference_video`)
  - `referenceAudioUrl?: string`(role=`reference_audio`)
  - `generateAudio?: boolean` → `generate_audio`
  - `watermark?: boolean`
  - `duration` 上限提升到 12(覆盖示例的 11s)
- 在 `arkSubmit` 里按官方格式拼装 `content` 数组:`text` + 多个 `image_url` + `video_url` + `audio_url`,每项带 `role`
- 抽出 `buildArkContent()` 帮助函数,集中处理 ContentItem 拼装,便于测试

### 2. 新增即梦后端 `jimeng`

火山即梦 3.0 Pro 用的是独立的视觉服务端点(非 ARK Chat 协议),需要单独的提交/轮询实现:

- 新增 `getVideoBackend` 分支:`jimeng-3.0-pro` / `jimeng-3.0-pro-i2v` → `'jimeng'`
- 新增 `jimengSubmit` / `jimengPoll`,读取 `JIMENG_ACCESS_KEY` / `JIMENG_SECRET_KEY`(Volcengine visual API 需 AK/SK 签名)。如果用户没配置 AK/SK,接口会返回明确错误提示去 Project Settings 添加 secrets。
- `submitVideoTask` / `pollVideoTask` 增加 `'jimeng'` 分支
- `SubmitResult.backend` / `PollInput.backend` 联合类型扩展为 `'ark' | 'dashscope' | 'jimeng'`

### 3. 模型列表 UI

- `src/components/NewProjectDialog.tsx`:在 Seedance 分组里追加 `doubao-seedance-2-0-fast-260128`;新增"即梦 3.0 Pro"分组项
- `src/pages/Models.tsx`:同步新增条目(中英文名)

### 4. 调用端可选扩展

`src/routes/workspace.$workspaceId.tsx` 里的 `callGenVideo` 已经传 `referenceImageUrls`,改动后这些会真正按 `reference_image` 多次出现在 ARK 载荷里(目前实现已经把第 2+ 张当 reference,只是没带 role)。`generateAudio` / `watermark` / `duration` 字段已支持,无需改前端。

### 5. Secrets

- 已有:`ARK_API_KEY`(Seedance)、`Qwen`(DashScope)
- 新增:`JIMENG_ACCESS_KEY`、`JIMENG_SECRET_KEY` —— 通过 `add_secret` 在用户确认接入即梦后再请求

## 不改动

- 前端 `generateVideoForGroup` 业务逻辑、轮询超时(已是 5 min)
- 数据库 schema
- DashScope HappyHorse 路径(保持兼容)
- AI SDK / Lovable AI Gateway(视频模型不走 LLM gateway,我们用项目自己的内部 dispatcher,这就是用户说的"AI gateway 统一管理"的位置)

## 需要确认

1. **即梦凭据**:即梦 3.0 Pro 调用走 Volcengine 视觉服务,需要 `JIMENG_ACCESS_KEY` + `JIMENG_SECRET_KEY`(AK/SK)。如果你已经有,我会在切到 build 后通过安全表单让你录入;如果你不打算现在接入即梦,可以先只完成 Seedance 全量参数扩展。请选择:
   - (a) 全部接入(Seedance 完整 + 即梦 3.0 Pro,需提供 AK/SK)
   - (b) 仅先完成 Seedance 完整对接,即梦留作下个阶段
