## 背景

Lovable Cloud 底层的 Supabase Storage 本身就通过 Cloudflare CDN 边缘节点分发文件——公开 bucket 的 URL（`/storage/v1/object/public/...`）和签名 URL 都会自动经过 CDN 缓存，无需额外接入第三方 CDN。既然腾讯云 COS+CDN 配置遇到问题，可以直接回退到这条内置链路，保留缓存能力、减少一层依赖。

## 方案

移除 COS 代码路径，恢复到"生成即写 workspace-media bucket → 直接使用 Supabase 公开/签名 URL"的原始形态；同时补充 `Cache-Control` 上传头，让 Supabase CDN 命中率最大化。历史数据无需迁移（本就在 workspace-media 里）。

## 具体改动

### 代码回退

1. **删除** `src/lib/cosClient.ts`
2. **删除** `scripts/migrate-workspace-media-to-cos.ts`
3. **删除** `docs/cos-cdn.md`
4. `**src/lib/workspaceMedia.functions.ts**`：移除 `isCosConfigured` / `uploadToCos` 分支和 `isCosCdnUrl` 判断，只保留 Supabase Storage 上传路径；`isAlreadyPersisted` 恢复为仅识别 supabase URL。
5. `**src/lib/uploadImage.functions.ts**`：移除 COS 优先分支，直接走 supabase.storage.upload。
6. `**src/lib/videoGenerate.functions.ts**`：移除参考音频/视频结果的 COS 分支。
7. `**package.json` / `bun.lock**`：卸载 `cos-nodejs-sdk-v5`（`bun remove cos-nodejs-sdk-v5`）。
8. **Secrets**：`COS_SECRET_ID / COS_SECRET_KEY / COS_BUCKET / COS_REGION / COS_CDN_HOST` 保留不用即可（不动它们不会影响运行）；如需清理可稍后手工删。

### 缓存优化（保留）

- `workspace-media` bucket 保持公开读，上传时统一带 `cacheControl: '31536000'`（Supabase Storage 会转成 `Cache-Control: public, max-age=31536000`，走 Supabase CDN 边缘节点）——目前部分调用点已带，补齐剩余几处。
- 无需 URL 重写：现有数据库里的 `/storage/v1/object/public/workspace-media/...` URL 本身就命中 CDN。

## 影响 & 风险

- **无数据迁移**：所有历史/新生成媒体依旧留在 workspace-media，URL 不变。
- **性能**：Supabase Storage CDN 全球边缘缓存，图片/视频首帧加载与自建 CDN 基本一致；对国内用户，若未来延迟明显再评估重新接入 COS。
- **安全**：workspace-media 是公开 bucket，路径含 `userId/workspaceId/uuid`，不可猜——与 COS 公开 URL 策略等价。

## 你需要确认

1. 是否直接回退（删除 COS 相关文件 + 代码分支）？还是希望**保留 COS 代码但默认走 Supabase**（未来配好 COS 时一键切回）？后者只需保留 `cosClient.ts` 和分支判断，仅需你不配置 `COS_*` Secret 即可——已经是当前行为，不需要任何改动。希望**保留 COS 代码但默认走 Supabase；**

如果选"直接回退"，我按上面的清单执行；如果选"保留双通道"，其实**现在什么都不用改**，只要不填 COS Secret，系统已经在走 Supabase CDN。保留双通道