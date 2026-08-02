## 目标

新增独立的「台词稿转写」功能：用户上传音频或视频文件 → 服务端调用 Lovable AI Gateway 官方语音转写端点 → 生成带时间码的台词稿 → 可复制 / 导出 / 回填到剧本。

## 用户流程

```text
/transcribe 页面
  ├─ 拖拽或选择文件（mp3/wav/m4a/aac/mp4/mov/webm）
  ├─ 浏览器端预处理：视频抽音轨 → 16k 单声道 WAV → 按 ~45s 切片
  ├─ 逐片上传转写（进度条：第 3/12 片）
  ├─ 结果面板：左侧时间码句列表（可编辑文本/说话人），右侧整稿纯文本
  └─ 操作：复制全文 / 导出 SRT / 导出 TXT / 保存到剧本
```

## 实现要点

### 1. 后端转写函数（新文件 `src/lib/transcribeAudio.functions.ts`）

- `createServerFn({ method: "POST" })` + `requireSupabaseAuth` + Zod 校验。
- 走 Gateway 官方端点 `POST https://ai.gateway.lovable.dev/v1/audio/transcriptions`（`multipart/form-data`，模型 `openai/gpt-4o-transcribe`），比现有 `input_audio` chat 路径更稳、更省。
- 入参：`audioBase64`（≤15MB 单片）、`format`、`offsetSeconds`、可选 `language`。
- 出参：`{ ok: true, text, sentences: [{ begin_ms, end_ms, text }] }`；失败时透传 Gateway 状态码与错误体（402/429/400 分别给出中文提示）。
- 复用 `creditsGuard.ensureEnoughCredits` 做余额预校验，失败返回 `INSUFFICIENT_CREDITS`。
- 失败时写入现有 `generation_error_logs`，与其他链路保持一致。

### 2. 客户端音频处理（新文件 `src/lib/audioExtract.ts`）

- 复用/抽取转绘模块 `restyleTranscript.ts` 中已有的 WAV 编码逻辑（`decodeAudioData` → 16k 单声道 → 手写 WAV 头）。
- 视频文件同样用 `AudioContext.decodeAudioData` 解出音轨，无需 ffmpeg。
- 按时长切片，逐片串行调用后端并累积时间码偏移；空片/静音片跳过。

### 3. 页面与路由

- 新增 `src/routes/transcribe.tsx` + `src/pages/Transcribe.tsx`，配 `head()`（独立 title/description/og）。
- UI 使用现有 shadcn 组件与语义色（`bg-background` / `text-muted-foreground`），弹窗统一走 `AssetEditDialog` 风格，不用原生 `prompt/alert`。
- 在主导航（`MainLayout`）「剧本」相关分组下增加入口。

### 4. 导出与回填

- SRT 由句级时间码生成，TXT 为纯文本；均在前端拼装下载，无需后端。
- 「保存到剧本」：复用现有 `scripts.functions.ts` 的创建/更新接口，把整稿写入剧本正文（弹窗选择新建剧本或追加到已有剧本）。

### 5. i18n 与测试

- `src/i18n/zh.ts` / `en.ts` 同步新增 `transcribe.*` 键。
- 新增 `src/lib/__tests__/transcribeAudio.test.ts`：覆盖时间码偏移累积、SRT 生成、错误码映射。

## 技术说明

- 转写端点由 Lovable 托管，使用项目自动下发的 `LOVABLE_API_KEY`，仅在服务端读取 `process.env`，绝不进入浏览器包。
- 音频以 base64 经服务函数中转（同源，无 CORS）；单片 ≤15MB，超长文件由前端切片解决，不截断音频。
- 不改动转绘模块现有的 `transcribeRestyleAudio` 链路；如后续验证新端点更优，可再单独提议迁移。
