# 接入腾讯云 COS + CDN 加速媒体分发

## 目标

把当前存放在 Supabase `workspace-media` 的所有生成产物（角色/场景/道具图、分镜图/参考图、剧集视频、参考音频）统一通过腾讯云 COS + CDN 分发；新上传直接落 COS，历史文件通过一次性脚本预迁移，数据库 URL 一并重写。

## 技术方案总览

```text
生成侧          持久化服务端                CDN 分发
─────           ─────────────               ───────
AI 供应商 ─► fetchMedia() ─► COS putObject ─► CDN 公开 URL ─► 前端 <img>/<video>/<audio>
临时 URL        (取代 Supabase                 (自定义域名 或
或 data:         Storage upload)                cos.<region>...)
```

- **供应商**：腾讯云 COS + CDN
- **访问方式**：公开 URL（`https://<cdn-domain>/<key>`），路径继续使用现有 UUID + timestamp 结构，不可猜测
- **鉴权**：服务端使用 `cos-nodejs-sdk-v5`（COS SDK for Node），密钥仅在 Server Function 中读取
- **URL 结构**：`https://{CDN_HOST}/{userId}/{workspaceId}/{kind}/{id}.{ext}`

## 需要用户提供的信息

在开工前，需要用户在腾讯云控制台准备好并填入以下 Secrets（用 `add_secret`）：


| Secret           | 说明                                        |
| ---------------- | ----------------------------------------- |
| `COS_SECRET_ID`  | 腾讯云 API 密钥 SecretId                       |
| `COS_SECRET_KEY` | 腾讯云 API 密钥 SecretKey                      |
| `COS_BUCKET`     | COS 存储桶名（形如 `doopoo-media-1300000000`）    |
| `COS_REGION`     | 存储桶所在地域（如 `ap-shanghai` / `ap-guangzhou`） |
| `COS_CDN_HOST`   | CDN 加速域名（如 `cdn.doopoo.ai`，不带协议不带 `/`）    |


同时需要用户在腾讯云侧：

1. 创建 COS 桶（公有读、私有写）
2. 绑定并解析 CDN 加速域名（HTTPS 证书 + 回源到 COS）
3. 在 CDN 侧开启合适的缓存策略（图/视频 1 年、`Cache-Control: public, max-age=31536000, immutable`）

## 改动清单

### 1. 新增服务端工具 `src/lib/cosClient.ts`（服务端专用）

- 懒初始化 `new COS({ SecretId, SecretKey })`（`process.env` 读入 handler 内）
- 导出 `uploadToCos(key, body, contentType) => cdnUrl`
- 导出 `isCosCdnUrl(url)`（用于「已入库」检测）
- 导出 `getCosKeyFromUrl(url)`
- 上传时统一设置 `CacheControl: 'public, max-age=31536000, immutable'`
- 上传对象 `ACL: 'default'`（继承桶公共读）

### 2. 依赖

```bash
bun add cos-nodejs-sdk-v5
```

### 3. 替换所有 Supabase Storage 写路径

统一改用 `uploadToCos` + 返回 `https://{COS_CDN_HOST}/{key}`：


| 文件                                                                   | 现状                                       | 改动                             |
| -------------------------------------------------------------------- | ---------------------------------------- | ------------------------------ |
| `src/lib/workspaceMedia.functions.ts` · `saveOneStoryboard`          | Supabase `.upload()` + `createSignedUrl` | 改 `uploadToCos`；返回 CDN URL     |
| 同上 · `saveOneVideo`                                                  | Supabase `.upload()` + `getPublicUrl`    | 改 `uploadToCos`                |
| 同上 · `persistAssetImage`（角色/场景/道具/panel/shot）                        | 同上                                       | 改 `uploadToCos`                |
| 同上 · `persistWorkspaceMedia` 批量                                      | 同上                                       | 改 `uploadToCos`                |
| `src/lib/uploadImage.functions.ts` · `uploadLocalImage`（用户本地上传、参考音频） | Supabase `.upload()` + `createSignedUrl` | 改 `uploadToCos`；`kind` 加音频分支   |
| `src/lib/videoGenerate.functions.ts` L2600-2720（参考音频转存）              | 上传到 workspace-media + `getPublicUrl`     | 改 `uploadToCos`，公网 URL 直接给 ARK |


### 4. `isAlreadyPersisted` 扩展

`workspaceMedia.functions.ts` 中的 `isAlreadyPersisted` 增加 COS/CDN 域名判断（`COS_CDN_HOST` 前缀 + `.cos.<region>.myqcloud.com`），避免历史 supabase.co URL 再重复上传，也避免已迁移的 CDN URL 触发第二次上传。

### 5. 前端「已入库」判断兼容

`src/routes/workspace.$workspaceId.tsx` 和 `StoryboardTimeline.tsx` 目前根据 `/object/public/` `/object/sign/` 判断是否已入库。改为「以 CDN host 判断」，把这段逻辑抽到 `src/lib/mediaUrl.ts` 中，前后端共享。

### 6. 数据库无表结构改动

所有 URL 都是字符串字段（`characters.cover_url`、`characters.images` JSON、`scenes.cover_url`、`scenes.images`、`props.cover_url`、`props.images`、`projects.workspace_data` JSON 里的 storyboards/videos、`community_posts.cover_url` 等）。无需 migration，只需在一次性迁移脚本中重写字段值。

### 7. 一次性历史数据迁移脚本

新增 `scripts/migrate-workspace-media-to-cos.ts`（Node 脚本，走 Service Role Key，本地/CI 一次性运行）：

1. 列 `workspace-media` bucket 下所有对象（分页 `supabase.storage.from().list()`）
2. 逐个 downloadObject → `uploadToCos(key, body)`（key 保持原路径）
3. 完成后扫描以下表把旧 URL 重写为新 CDN URL：
  - `characters.cover_url`、`characters.images`
  - `scenes.cover_url`、`scenes.images`
  - `props.cover_url`、`props.images`
  - `projects.workspace_data`（JSON 深度替换：正则 `/https?:\/\/[^"]*\/workspace-media\/[^"]+/g` → 提取 key → 拼 CDN URL）
  - `community_posts.cover_url` / `community_posts.media`（若存在）
  - `scripts.cover_url`（若存在）
4. 并发控制：并行 8，失败重试 2 次，记录 `migration.log`
5. 迁移完成后可选择保留 workspace-media（历史备份）或人工清空

**运行方式**（脚本中说明）：

```bash
COS_SECRET_ID=... COS_SECRET_KEY=... COS_BUCKET=... COS_REGION=... COS_CDN_HOST=... \
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
bun run scripts/migrate-workspace-media-to-cos.ts
```

（不在生产 db:push，由老板本地跑；老板不给数据库权限的部分只涉及读+更新，走 Service Role Key，可以自己跑）

### 8. 文档

`docs/cos-cdn.md`：说明 COS/CDN 配置步骤、Cache-Control 策略、密钥获取、迁移脚本用法、回滚（把 `COS_CDN_HOST` 清空则代码回落 Supabase 的路径—— 通过一个 feature flag）。

## 灰度与回滚

- 加环境变量开关 `USE_COS_STORAGE`（默认 `true`）；若未配置 COS 相关 Secret，`uploadToCos` 内部回落到 Supabase Storage 逻辑（保底 5 天）
- 迁移脚本幂等：以 CDN URL 特征跳过

## 验证清单

- 新生成角色图 → cover_url 为 `https://{COS_CDN_HOST}/…`
- 新生成分镜视频 → 可在 CDN 域名直接播放
- 参考音频上传 → ARK 视频生成成功（此前 workspace-media 公开桶就是为了这个）
- 打开老项目 → 历史图片经迁移后从 CDN 加载，Network 面板域名为 `COS_CDN_HOST`
- 数据库 `workspace_data` JSON 内 URL 均已重写
- CDN 首次未命中回源 COS 成功；二次命中缓存（`X-Cache-Lookup: Hit`）

## 后续（不在本次范围）

- workspace-media Supabase 桶迁完后转私有 + 保留 30 天备份
- 后端签发 CDN 防盗链 Token（若日后开启热链接防护）
- 视频转码（HLS/MP4 多码率）建议接入云点播 VOD，不在本次

## 需要用户确认

是否已经在腾讯云侧准备好上面 5 个配置项？若还没，我可以先把代码改造完成，最后由老板填 Secrets + 运行迁移脚本上线。 还没有准备好，你先完成改造