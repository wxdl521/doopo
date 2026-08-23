# 修复：转绘模块的图片/视频链接过期失效

## 核实到的现状

转绘和「我的项目」存在同一类问题：`workspace-media` 是私有桶，读地址是 7 天签名 URL，
但这些临时地址被直接写进了持久化数据。

- 转绘 v1（`RestyleStudio`）：会话存 localStorage（`restyleStorage.ts`），
  附件里保存的是 `url`（签名，7 天过期）。较新的附件另存了 `storageKey`，
  可现签自愈；**旧附件只有 url**，过期即裂图/视频打不开。
- 分段/成片视频：`persistRestyleVideo`、`signMediaReadUrl`
  （`restyleMedia.functions.ts`）返回的都是 604800 秒签名 URL，
  被写入 `restyle_segments.result_url` 与附件 `resultUrl`。
- 转绘 v2：`restyle_episodes.source_media_url`、
  `restyle_characters.main_image_url / turnaround_url`、
  `restyle_character_looks.*_url`、`restyle_scenes/props.image_url`
  存的同样是签名 URL，`restyleV2Db.ts` 的读取函数直接原样返回给
  `ImageGenPanel` 等组件渲染。

## 修复方案

复用上一轮已落地的自愈机制（`src/lib/mediaUrl.ts` 的路径解析
+ `workspaceMedia.functions.ts` 的 `refreshMediaUrls` 批量重签），
把它接进转绘的三条读取路径。

### 1. v1 会话加载时批量重签

`RestyleStudio` 载入某个项目的会话后（切项目/首屏），
用 `collectWorkspaceMediaUrls` 收集消息附件里的 `url` / `resultUrl`，
一次性调 `refreshMediaUrls`，就地替换内存态。
同时把解析出的对象路径回填到附件的 `storageKey`，
让旧附件此后也能走现签通道。替换随下次正常保存写回 localStorage。

### 2. v2 数据库读取时重签

在 `restyleV2Db.ts` 的读取函数（集列表、角色/造型/场景/道具、分段结果）
返回前，统一过一层 `refreshMediaUrls`，把行内的媒体字段替换成新签名 URL；
解析不出对象路径的三方链接原样返回。集中做一个
`resignRows(rows, fields)` 小工具，避免每个函数各写一遍。

### 3. 渲染兜底

图片/视频 `onError` 时，若该 URL 属于 `workspace-media`，
先尝试一次重签并重试加载，仍失败才显示失效占位，
避免把「签名过期」误判成「文件丢失」。

## 技术要点

- 签名有效期仍保持 7 天（安全审计要求），靠「读时重签」解决过期。
- 重签走用户自己的 Supabase 客户端，遵守 RLS，不使用 service role。
- 不做数据迁移：库里/本地存的过期 URL 仍能解析出对象 key，读时自愈。
- 单次重签数量上限沿用 300 条保护。
