
## 问题 1：数字输入框的输入 bug

**根因**：四个 `<input type="number">`（预计集数 / 第 1 集分镜数 / 下一集分镜数 / 连跑至第 N 集）的 `onChange` 都写成
```ts
setX(Math.max(min, Math.min(max, Number(e.target.value) || fallback)))
```
导致两类问题：
1. 用户清空输入框时 `Number('')=0`，触发 `|| fallback`，瞬间跳回默认值（15 / 100），无法删除重输。
2. 边输边 clamp：min=5 时输入 "2" 立刻被改成 5；min=`nextEpIndex=2` 时输入 "1" 立刻变成 2，导致无法输入两位数（如 20、10）。

**修复**：抽一个轻量 `NumberField` 子组件，内部用 string 本地态：
- `onChange`：只接受空串或纯数字字符串，原样存入本地态并向上同步 `Number(value)`（空串时不调用 setter 或传 `NaN` 由父级保留旧值）。
- `onBlur`：解析 → clamp 到 [min, max] → 若为空回填上次有效值或默认值，再 setter + 同步本地态。
- 替换 `ScriptComposer.tsx` 中 4 处 number input。

## 问题 2：保存的剧本会丢失 → 接入云端持久化

**根因**：`src/lib/scriptStorage.ts` 只写浏览器 `localStorage`（key=`doopoo_scripts`），清缓存 / 换设备 / 隐私模式都会丢；且 `Scripts.tsx`、`scripts.$scriptId.tsx` 只从 localStorage 读。

**方案**：用户登录后同时落 Supabase；未登录仍走 localStorage（兼容现状）。本地缓存作为云端的镜像，保证离线/即时可读。

### 数据库迁移（一次性）

新表 `public.scripts`：
- `id text primary key`（沿用前端生成的 `scr-...` id，便于本地/云端 id 一致）
- `user_id uuid not null`（写入时由 serverFn 注入 `auth.uid()`，不暴露给客户端）
- `title text not null`、`type`、`genre`、`tone`、`updated_at timestamptz`（用于列表展示与排序的少量索引列）
- `payload jsonb not null`（完整 `SavedScript` 结构：synopsisText / episodesText[] / characters / quality 等都塞这里，避免每加字段就改表）
- `created_at`、`updated_at`，触发器自动更新 `updated_at`
- 索引：`(user_id, updated_at desc)`

RLS：启用，4 条策略（select/insert/update/delete）均 `using (auth.uid() = user_id)`。

### 服务端函数（`src/lib/scripts.functions.ts`，全部 `requireSupabaseAuth`）

- `listScriptsRemote()` → `SavedScript[]`：读当前用户全部 payload。
- `getScriptRemote({ id })` → `SavedScript | null`。
- `upsertScriptRemote({ script })` → `{ ok: true }`：`upsert` 写 `payload` 并同步 5 个索引列、`user_id = context.userId`。
- `deleteScriptRemote({ id })` → `{ ok: true }`。

所有 RPC 用 Zod 校验输入。

### 前端改造（最小侵入）

`src/lib/scriptStorage.ts` 新增 async 版本，保留同步 API 兼容：
- `syncFromCloud()`：登录时拉云端 → 与本地按 `updatedAt` 取较新者合并 → 写回 localStorage。
- `upsertScript()`：保持现签名（同步写本地），同时 fire-and-forget 调云端 `upsertScriptRemote`，失败仅 console。
- `removeScript()`：同理双删。

`src/pages/Scripts.tsx`：
- `useEffect` 中先 `refresh()`（读本地，秒出 UI），再调用 `syncFromCloud()`，完成后再 `refresh()`。
- 删除按钮调用更新后的 `removeScript`（已自动双删）。

`src/routes/scripts.$scriptId.tsx`：
- 当前 `useEffect` 中除 `findScript` 外，再调 `getScriptRemote`，云端结果覆盖本地。

`ScriptComposer.tsx` 的 `persist()` 不需要改（它调用 `upsertScript`，已自动双写）。

未登录时：serverFn 直接 401，前端忽略错误，仍正常走 localStorage，体验不变。

## 改动文件清单

- DB migration（新建 `scripts` 表 + RLS + 触发器）
- 新增 `src/lib/scripts.functions.ts`
- 编辑 `src/lib/scriptStorage.ts`（双写、合并）
- 编辑 `src/components/scripts/ScriptComposer.tsx`（NumberField，替换 4 处 input）
- 编辑 `src/pages/Scripts.tsx`（hydration 后云端同步）
- 编辑 `src/routes/scripts.$scriptId.tsx`（云端覆盖本地）
