# 修复：历史项目的图片/视频打不开（提示“图片已失效”）

## 问题定位（已核对代码）

存储桶 `workspace-media` 是私有桶，所有读地址都是 **7 天有效期的签名 URL**
（`src/lib/workspaceMedia.functions.ts` 的 `createSignedUrl(key, 604_800)`，
`restyleMedia.functions.ts`、`uploadImage.functions.ts`、`videoGenerate.functions.ts` 同样）。

这些**带签名的临时地址被直接写进了数据库**：`projects.custom_cover`、
`projects.workspace_data` 里的 `groupStoryboards / shotImages / charImages /
sceneImages / groupVideos`、以及资产表的 `cover_url`。

超过 7 天后签名过期 → Storage 返回 400/403 → 前端渲染裂图，
工作区把它判成“图片已失效”（`workspace.$workspaceId.tsx` 约 13242 行）。

更糟的是现有的自愈逻辑判不出过期：`toLongLivedStoryboardUrl` 与自动入库 effect
都是“只要 URL 里含 `/object/sign/workspace-media/` 就当作有效直接跳过”，
所以过期的签名 URL 永远不会被重新签发，只能一直裂图。

## 修复方案

### 1. 读取时按对象路径重新签名（核心）

新增服务端函数 `refreshMediaUrls`（`src/lib/workspaceMedia.functions.ts`）：
输入一批 URL，凡是能解析出 `workspace-media` 对象路径的（public 或 sign 形式，
不管签名是否过期），一律用当前用户的 Supabase 客户端 `createSignedUrl` 重签，
返回「原 URL → 新 URL」映射；非本桶的三方 URL 原样返回。
用 `Promise.all` 批量处理，并做单次上限（如 300 条）保护。

同时修正判定函数：把「已是签名 URL 就跳过」改为「能解析出对象路径就重签」，
让 `toLongLivedStoryboardUrl` 具备自愈能力。

### 2. 项目列表封面自愈

`listMyProjects` / `getProject` 返回前，对 `custom_cover` 走同一套重签逻辑，
封面即时可用；解析不出路径（三方临时链接已彻底失效）时返回 `null`，
前端回落到渐变占位而不是裂图。

### 3. 工作区打开时批量刷新

`workspace.$workspaceId.tsx` 加载 `workspace_data` 后、在渲染前，收集其中所有
`workspace-media` 链接，调用一次 `refreshMediaUrls`，就地替换到各 state
（`groupStoryboards`、`shotImages`、`charImages`、`sceneImages`、`groupVideos`）。
替换只发生在内存态，随下次正常保存写回，不额外触发整列覆盖写。

### 4. 兜底：过期不再误判为“永久失效”

图片 `onError` 时，如果该 URL 属于 `workspace-media`，先尝试一次重签并重试加载，
仍失败才标记 broken 显示“图片已失效”。避免用户看到假失效。

## 技术要点

- 签名有效期维持 7 天（安全审计要求，不回退到长期签名）；靠“读时重签”解决过期。
- 重签用 `requireSupabaseAuth` 上下文里的用户客户端，遵守 RLS，不使用 service role。
- 不做数据迁移：老数据里存的过期 URL 仍可从路径解析出 key，读时即可自愈。
- 视频同理：`groupVideos`、转绘分段/成片的 URL 走同一批量重签通道。
