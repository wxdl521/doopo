# 腾讯云 COS + CDN 接入说明

项目所有生成的媒体（角色/场景/道具图、分镜图、剧集视频、参考音频、用户上传）
统一通过腾讯云 COS 存储 + CDN 域名分发。未配置 COS 时代码自动回落 Supabase Storage。

## 一、腾讯云侧准备

1. 开通 [对象存储 COS](https://console.cloud.tencent.com/cos)，创建桶（推荐地域 `ap-shanghai` 或 `ap-guangzhou`）。
   - 访问权限：**公有读、私有写**
   - 跨域规则（CORS）：Origin `*`；Method `GET`、`HEAD`；Headers `*`
2. 开通 [内容分发网络 CDN](https://console.cloud.tencent.com/cdn)，添加加速域名：
   - 源站类型：**COS 源**，选中上一步的桶
   - 回源协议：HTTPS
   - 缓存规则：全部文件 `Cache-Control: public, max-age=31536000, immutable`（代码上传时已带此头）
   - HTTPS 配置：申请免费证书并强制 HTTPS
3. 前往 [API 密钥管理](https://console.cloud.tencent.com/cam/capi) 记录 SecretId 和 SecretKey。

## 二、配置 Secrets

在 Lovable Cloud 中添加以下 5 个 Secret：

| Secret           | 示例                              |
| ---------------- | -------------------------------- |
| `COS_SECRET_ID`  | `AKIDxxxxxxxxxxxxxxxx`           |
| `COS_SECRET_KEY` | `xxxxxxxxxxxxxxxxxxxxxxxxxxxx`   |
| `COS_BUCKET`     | `doopoo-media-1300000000`        |
| `COS_REGION`     | `ap-shanghai`                    |
| `COS_CDN_HOST`   | `cdn.doopoo.ai`（不带协议不带 `/`） |

配置完成后无需重启，代码里的 `isCosConfigured()` 在下次调用时自动生效。

## 三、历史数据迁移

一次性把 `workspace-media` 里的历史文件搬到 COS，并把数据库里旧的 Supabase URL
替换为新的 CDN URL。

```bash
# 干跑（不写入，只统计）
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
COS_SECRET_ID=... COS_SECRET_KEY=... COS_BUCKET=... COS_REGION=... COS_CDN_HOST=... \
bun run scripts/migrate-workspace-media-to-cos.ts

# 实际执行
bun run scripts/migrate-workspace-media-to-cos.ts --apply
```

脚本行为：

- 分页列 `workspace-media` bucket 全部对象，并发 8 上传到 COS（`headObject` 命中即跳过）
- 扫描 `characters/scenes/props`（`cover_url`、`images` JSON）、`projects.workspace_data`、`community_posts.cover_url`、`scripts.cover_url`，把旧 URL 重写为 CDN URL
- 幂等：多次执行不会重复上传，也不会重复重写

> 服务端角色 Key（`SUPABASE_SERVICE_ROLE_KEY`）请只在本地/CI 使用，不要写入生产环境或提交仓库。

## 四、验证清单

- 新生成的角色图 `cover_url` 前缀是 `https://{COS_CDN_HOST}/`
- 分镜视频可在 CDN 域名直接播放
- 参考音频上传 → ARK 视频生成成功（此前依赖 workspace-media 公开桶）
- 打开老项目 → Network 面板资源域名为 `COS_CDN_HOST`
- CDN 二次命中 `X-Cache-Lookup: Hit`

## 五、回滚

若需临时禁用 CDN，只需删除或清空任一 `COS_*` Secret；代码检测到未配置后
会自动回落 Supabase Storage 路径。已写入 CDN 的 URL 仍可通过 CDN 域名访问。