# 失败调用日志面板

在图片生成与 Seedance 视频提交失败时，把请求 payload、响应体、时间戳、模型、耗时等信息落库并提供可视化查看面板，方便排查 400/超时等问题。

## 一、数据存储

新增表 `public.generation_error_logs`（迁移 SQL 交由老板执行）：

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid PK | |
| user_id | uuid, FK auth.users | 记录归属 |
| kind | text | `image` / `video` |
| provider | text | `ark-seedance` / `pixflow` / `azure` … |
| model | text | 具体 model id |
| status | int | HTTP status（0 表示网络异常） |
| duration_ms | int | 耗时 |
| request_payload | jsonb | 提交给上游的 body（自动脱敏 key） |
| response_body | text | 上游返回原文，截断至 4KB |
| error_message | text | 摘要 |
| created_at | timestamptz default now() | |

- RLS：仅 `user_id = auth.uid()` 可读；`service_role` 可写。
- GRANT SELECT to authenticated；GRANT ALL to service_role。
- 索引：`(user_id, created_at desc)`、`(kind, created_at desc)`。

## 二、写入侧（Server Functions）

新增 `src/lib/errorLogs.functions.ts`：
- `logGenerationError(input)`：内部函数，使用 `client.server.ts` 的 `supabaseAdmin`（绕过 RLS）写入。参数含 `userId, kind, provider, model, status, durationMs, requestPayload, responseBody, errorMessage`。
- `listMyGenerationErrors({ limit, kind })`：`requireSupabaseAuth` 中间件，读当前用户最近 100 条。

在失败分支注入调用：
1. `src/lib/videoGenerate.functions.ts` 的 `submitVideoTask`（`ark-seedance` 分支）：`submit 400/网络异常` 处调用 `logGenerationError`，payload = 发给 ARK 的 body，response = 上游文本。
2. `src/lib/seedream.functions.ts` 的 `generateImage` 主流程失败/兜底后仍失败时调用；同样覆盖 pixflow/azure/tokenflash 等分支的失败返回点（统一在 `generateImage` 出口处判断 `error` 后集中记录，避免每个 provider 侧写重复）。
3. 通过 `getRequest()` 或已存在的鉴权 context 获取 `userId`；无 userId 时也写（`user_id = null`）以便后台观察。

脱敏：`request_payload` 序列化前，剔除 `authorization` header 和 `api_key` 字段；保留 prompt/size/model/refs 等。

## 三、查看面板

新增页面路由 `src/routes/account.error-logs.tsx`：
- 使用 TanStack Query + `useServerFn(listMyGenerationErrors)`。
- 表格列：时间、类型（image/video 徽章）、provider、model、status、耗时、错误摘要。
- 行展开：显示格式化后的 `request_payload`（JSON pretty）和 `response_body`（monospace，滚动容器，最多 4KB）。
- 顶部筛选：类型（全部/图片/视频）、复制按钮（复制单条 JSON 便于粘贴报错）。
- 在 `src/routes/account.tsx` 侧边栏加入「调用错误日志」入口；i18n 键 `account.errorLogs.*` 同步 `zh.ts` / `en.ts`。

## 四、验证

- 手动触发一次 Seedance 400（用非法 size）→ 检查记录出现并可展开。
- 手动触发一次 Seedream 尺寸不合法失败 → 同上。
- 成功调用不写入，避免污染。

## 技术细节

- 写日志使用 fire-and-forget（`.catch(console.warn)`），不阻塞主流程失败返回。
- `response_body` 使用 `.slice(0, 4096)` 截断，`request_payload` 深拷贝后过滤敏感字段。
- 迁移 SQL 放在 `supabase/migrations/<timestamp>_generation_error_logs.sql`，产出后由老板执行 `bun run db:push`。
