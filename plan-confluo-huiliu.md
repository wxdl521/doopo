# 接入「汇流 Confluo」供应商

OpenAI 兼容聚合网关,统一地址 `https://models.iystd.com/v1`,鉴权 `Authorization: Bearer sk-xxx`。接入 1 图 + 3 视频:
- 图像 `gpt-image-2` → id `confluo/gpt-image-2`
- 视频 `doubao-seedance-2-0-260128` / `-fast-260128` / `-mini-260615` → id `confluo-doubao-seedance-*`

## 改动清单

1. **新建 `src/lib/confluoImage.functions.ts`** — 套 `meridianImage.functions.ts` 模板(纯 OpenAI 兼容 gpt-image-2):`callConfluoImage` 无参考图走 `/v1/images/generations`,有参考图走 `/v1/images/edits`(multipart `image[]`);gpt-image-2 不发 `n`/`response_format`;瞬时 5xx 重试 1 次;导出 `generateConfluoImage` server fn。

2. **改 `src/lib/seedream.functions.ts`** — 4 个 server fn(`generateImage`/`regenerateCharacterLook`/`generateStoryboardShotImage`/`regenerateStoryboardShot`)各加一个 `confluo/` 前缀委托分支(紧跟 meridian 分支)。

3. **改 `src/lib/videoGenerate.functions.ts`** — 新增 `confluo` backend:`getVideoBackend` 加判断、`VideoBackend` 联合类型 + `PollServerInput` 枚举加 `"confluo"`、新增 `CONFLUO_MODELS`/`getConfluoVideoConfig`/`confluoSubmit`/`confluoPoll`、`submitVideoTask`/`pollVideoTask` 加分支。剥离 `confluo-` 前缀后 upstream model = `doubao-seedance-2-0-*`。

4. **改 `src/lib/imageModels.ts`** — `IMAGE_MODELS` 加 `confluo/gpt-image-2` 选项 + 分组分隔符。

5. **改 `src/components/NewProjectDialog.tsx`** — `videoModels` 加 3 个 confluo 选项 + `__video_sep_confluo__` 分隔符(放 vapeur 后)。

6. **改 `.env`** — 加 `CONFLUO_BASE_URL="https://models.iystd.com/v1"` 注释(key 移至 Secrets)。

## 实施首步:实测视频端点
文档只给 chat 例子,视频端点未明确。先用残缺请求探测(不花钱)确认是 `POST /v1/videos/generations`(newapi 风格,默认假设)还是 `POST /v1/contents/generations/tasks`(ARK 原生透传),再定稿 confluoSubmit/Poll 的端点与响应解析。

## 验证
`bun run lint` + 图像 T2I/I2I 各一次 + 视频 mini T2V 一次。
