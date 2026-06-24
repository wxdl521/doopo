## 根因

`persistAssetImage` 后台入库 8 张全部失败，根因是 **入参 URL 长度上限太小，data: base64 图被 zod 拒绝**。

调用链：
1. 客户端 `persistAllImagesInBackground`（`workspace.$workspaceId.tsx:4621`）遍历 `charMap / shotMap / sceneMap / propMap`，对每个 URL 调 `persistAssetImage`。
2. 它只过滤 `blob:` 和 `isPersistedUrl(...)`，没过滤 `data:`。
3. 而项目里大量生图函数（`azureImage`、`aigcfamilyImage`、`onetokenImage`、`pixflow`、`tokenflash`、`openrouterImage`、`lovableImage` 等）的返回值就是 `data:image/png;base64,...`，单条动辄数百 KB ~ 几 MB。
4. `persistAssetImage` 的 zod schema：
   ```ts
   url: z.string().min(1).max(2000)
   ```
   data: 图远超 2000，validator 直接 throw → 客户端 `catch { fail++ }` → 8/8 失败。
5. 退一步，即便放开长度，`fetchMedia` 走的是 `fetch(url)` —— 在 Cloudflare Workers 运行时里 `fetch('data:...')` 也不一定可靠，需要直接 base64 解码。

`saveOneStoryboard` 已经有同样隐患（`url.max(5000000)` 够大但 `fetchMedia` 仍不会正确处理 data:），客户端故事板入库链路里 `data:` 已被预先过滤掉（`workspace.$workspaceId.tsx:1370`），所以没暴露；图片资产链路没过滤，所以炸了。

## 修复

只动 `src/lib/workspaceMedia.functions.ts`（后端）—— 客户端不需要再过滤 data:，因为入库的目的就是把 data:/三方临时 URL 都替换成永久 Storage URL。

1. **放开 `PersistAssetImageInput.url` 长度上限**
   - `z.string().min(1).max(15_000_000)`（覆盖到 ~10MB base64 图）。
2. **在 `fetchMedia` 里短路处理 `data:` URL**
   - 解析 `data:[mime];base64,xxx`，直接 `Buffer.from(b64, 'base64')` → `ArrayBuffer`，返回 `{ buf, contentType }`。
   - 非 base64 形式的 data: URL（极少见的纯文本变体）直接 throw 一个清晰错误。
   - 这样 `persistAssetImage`、`saveOneStoryboard`、`saveOneVideo`、`persistWorkspaceMedia` 都受益，不再因为 data: 失败。
3. **顺手把上传错误 `error: string` 也透传给客户端**（已经透传，无需改）。客户端 `console.warn('[persist] persistAssetImage failed:', r.error)` 已存在，便于以后排查。

## 验证

- 跑现有 vitest 套件（`src/lib/__tests__/...`）确认不回归。
- 新增 1 个轻量单元测试：直接调 `fetchMedia('data:image/png;base64,iVBORw0...')`，断言 `buf.byteLength > 0` 且 `contentType === 'image/png'`。
- 手动：在 workspace 里触发一次保存，控制台应看到 `图片入库完成: N 张成功`，failed 计数为 0；刷新页面后图片仍在（已是 Storage 签名 URL）。

## 不在本次修改范围

- 不动 `workspace.$workspaceId.tsx`（业务流程已经正确，只是被后端 validator 卡住）。
- 不动 RLS / migration / bucket 配置（`workspace-media` 已 OK）。
- 不调并发数 / 超时（与本 bug 无关）。
