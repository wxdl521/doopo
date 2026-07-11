# 视频生成分辨率可选 — 实现方案

## 目标
在「新建项目 / 基础设置」对话框的「画面规格」区，把「画幅比例」和「分辨率」并排可选，让丽帧和 Doubao Seedance 2.0 系列模型在调用时可选择输出分辨率。

## 分辨率档位（按模型，技术约束 — 必须动态）
| 模型 id | 可选分辨率 |
|---|---|
| `doubao-seedance-2-0-260128`（默认/标准）| 480p, 720p |
| `doubao-seedance-2-0-fast-260128`（Fast）| 480p, 720p |
| `kuaizi-lizhen-pro` | 480p, 720p, 1080p |
| `kuaizi-lizhen-fast` | 480p, 720p |
| `kuaizi-lizhen-mini` | 480p, 720p |

- 默认值 `720P`
- **不支持 4k**（`generateVideo` schema 现有 enum 仅 `480P/720P/1080P`，无需改）
- 档位必须按模型动态过滤：丽帧 fast/mini 传 1080p 会被后端拒绝，ARK 标准版传 4k 也会被拒
- 其他视频模型（即梦/Kling/k99/HappyHorse/ToAPIs/数安词源/vapeur/汇流）：分辨率选择器**禁用**并提示「该模型不支持自定义分辨率，使用默认 720p」，`resolution` 不传给后端

## 内部约定
- 项目内部统一用**大写** `"480P"/"720P"/"1080P"` 存储（与 `generateVideo` schema、`toKuaiziResolution` 入参一致）
- 各后端 `toXxxResolution` 负责转小写给供应商（ARK 文档示例为小写 `"720p"`）

## 改动清单

### 1. 后端 — ARK 透传缺口（`src/lib/videoGenerate.functions.ts`）
**`arkSubmit`（~L205-269）**：
- 入参加 `resolution?: string`
- 新增 `toArkResolution(r)` 大写→小写（`480p/720p/1080p`），仿 `toKuaiziResolution`
- body 写 `if (input.resolution) body.resolution = toArkResolution(input.resolution)`（ARK 文档：**顶层字段**，非 `parameters` 嵌套；与 `ratio`/`duration` 平级）

**`submitVideoTask` ark 分支（~L1664-1673）**：
- `arkSubmit` 调用补 `resolution: input.resolution`

### 2. 后端 — `generateVideo` schema（已就绪，仅确认不改）
- `resolution: z.enum(["480P","720P","1080P"]).default("720P")`（L2086）已满足全部档位

### 3. 后端 — `submitVideoTaskFn`（低层，前端视频生成未直接用，为一致性顺手加）
- `SubmitServerInput` 加 `resolution: z.enum(["480P","720P","1080P"]).optional()`
- handler 透传 `resolution: data.resolution` 给 `submitVideoTask`

### 4. 配置持久化（`src/lib/projects.functions.ts`）
- `ProjectInput` 加 `resolution: z.string().max(10).optional()`
- `upsertProject` 加 `...(data.resolution !== undefined && { resolution: data.resolution })`
- `ProjectConfigRow` 加 `resolution: string | null`
- `getProject` 的 select 列表加 `resolution`，row 映射补 `resolution: row.resolution`

### 5. 数据库 migration
新建 `supabase/migrations/<时间戳>_add_project_resolution.sql`：
```sql
ALTER TABLE projects ADD COLUMN IF NOT EXISTS resolution text DEFAULT '720P';
```
- **本地**：`bun run db:push`
- **生产**：按既定流程把 SQL 发给老板手动执行（**不在生产跑 db:push**）— 参见记忆 [[db-prod-update-workflow]]
- 存量项目自动得 `720P` 默认值，前端读取不报错

### 6. 前端 — `src/components/NewProjectDialog.tsx`
- `ProjectConfig` 类型加 `resolution?: string`
- 新增工具函数 `videoResolutionOptions(videoModel): {id,label}[]`，返回该模型可选分辨率；5 个支持模型外返回 `[]`
- 新增 state `resolution`，初值 `initial?.resolution ?? initialPrefs.lastResolution ?? "720P"`
- **切换 videoModel 时的回落**（关键）：useEffect 监听 `videoModel`，若当前 `resolution` 不在新档位内，自动回落到 `720P`（避免存了 1080P 后切到 fast 触发后端报错）
- UI：第一行「画面规格」区把画幅比例 + 分辨率并排（`aspect` 旁加一个 resolution `FieldSelect`）。仅当 `videoResolutionOptions(videoModel).length > 0` 时选择器可选；否则禁用 + hint「该模型不支持自定义分辨率」
- `confirm()` 的 `saveProject` data 加 `resolution`
- `onSaved` 回传加 `resolution`

### 7. 前端 — `src/routes/workspace.$workspaceId.tsx`
- `commonData`（~L5034）加 `resolution: project?.resolution || "720P"`
- `currentProject` 透传（~L7465）加 `resolution: project.resolution`（编辑模式回显用）

### 8. 用户偏好（`src/lib/userPreferences.ts`）
- `UserPrefs` 加 `lastResolution?: string`
- `load/save` 加 `lastResolution` 读写
- `NewProjectDialog` 加 useEffect 保存 `lastResolution`（仿 `lastVideoModel`）

### 9. i18n（`src/i18n/zh.ts` + `en.ts` 同步）
新增键：`np_resolution`、`np_resolution_hint`、`np_resolution_480p`、`np_resolution_720p`、`np_resolution_1080p`、`np_resolution_unsupported`（不支持时的提示）

## 不改动
- `kuaiziSubmit`（已传 resolution ✓）
- toapis/vapeur/confluo/shuci 等中转后端（用户范围未含，保持现状）
- 图像生成分镜/场景（resolution 仅视频）

## 部署前置（重要）
生产 DB 必须**先**执行 `ALTER TABLE` 加 `resolution` 列（发 SQL 给老板），再部署代码。否则 `upsertProject` 写 `resolution` 会因列不存在报错。

## 验证清单
- [ ] 新建项目选丽帧 pro + 1080p → 生成 → 抓包确认请求体 `resolution=1080p`
- [ ] 切到 ARK Fast → 分辨率自动回落 720p → 生成 → 确认 ARK 请求体 `resolution=720p`（顶层字段）
- [ ] 编辑现有项目 → 分辨率正确回显
- [ ] 选即梦/Kling → 分辨率选择器禁用 + 提示
- [ ] 存量项目（DB 默认 720P）打开编辑不报错
