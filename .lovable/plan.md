# 修复：离开项目再回来，分镜图 / 故事板全部丢失

## 现象

在「分镜」环节做了大量分镜图、故事板后，用户跳出项目去充值 / 分配积分，再点回该项目，分镜相关内容全部消失。

## 已确认的根因

工作区的 `workspace_data` 是**整列覆盖式**保存（`src/lib/projects.functions.ts` 的 `saveWorkspaceData` 直接 `.update({ workspace_data })`），而读取被拆成了三段请求：

```text
loadWorkspaceData                  → 剧本 / 角色 / 场景 / 道具（不含 storyboard）
loadWorkspaceStoryboardStructure   → storyboard + storyboardGroups
loadWorkspaceMedia                 → shotImages / panelImages / groupStoryboards / groupVideos …
```

保存前的保护只有两个开关：`workspaceLoadError` 与 `workspaceMediaReady`。**分镜结构这一段没有任何 ready 守卫**（`src/routes/workspace.$workspaceId.tsx` 约 3420-3455 行）：它失败时只弹一句 `toast.warning("分镜结构暂未恢复…")`，随后媒体请求照常成功、`workspaceMediaReady` 置为 `true`，保存闸门被打开。

于是链路变成：

```text
分镜结构请求超时 / 失败 → state 里 storyboard = []、storyboardGroups = []
        ↓（媒体加载成功，保存闸门打开）
任意一次自动保存（1.5s 防抖 / beforeunload / 阶段完成）
        ↓
整列覆盖写回 workspace_data，storyboard 与 storyboardGroups 被写成空数组 → 永久丢失
```

分镜结构正是三段里最容易超时的一段（内容大、与媒体查询抢数据库资源），项目做得越久越容易触发；中途离开再回来会重新走一遍加载，因此恰好在这个场景暴露。

## 修复方案

### 1. 补齐分镜结构的 ready 守卫（前端，主修复）

- 新增 `storyboardStructureReady` / `storyboardStructureError` 两个状态，只有该段请求成功返回后才置为 ready。
- `handleSaveWorkspace` 增加与媒体同样的前置拦截：未 ready 时终止保存（静默模式也不写库），非静默模式提示「分镜内容尚未恢复，已停止保存以保护原有数据」。
- 三处延迟保存 effect（自动保存防抖、beforeunload、阶段完成）的依赖同样加上该守卫。
- 分镜结构加载失败从 `toast.warning` 升级为持续可见的错误条：「分镜内容未加载，保存已暂停，请刷新重试」，避免用户在残缺状态下继续操作。

### 2. 加载失败自动重试一次（前端）

分镜结构与媒体两段请求各做一次延迟 1.5s 的自动重试，覆盖偶发的语句超时，减少用户手工刷新。

### 3. 保存改为字段级合并，从根上消除「整列覆盖」（后端 + 一条 SQL）

即使守卫失效，也不该让一次保存抹掉未加载的字段。新增按 JSONB 合并的数据库函数：

```sql
create or replace function public.merge_workspace_data(
  p_project_id text,
  p_patch jsonb,
  p_completed_stages text[]
) returns void
language sql
security invoker
set search_path = public
as $$
  update public.projects
     set workspace_data = coalesce(workspace_data, '{}'::jsonb) || p_patch,
         completed_stages = p_completed_stages
   where id = p_project_id;
$$;

grant execute on function public.merge_workspace_data(text, jsonb, text[]) to authenticated;
```

`saveWorkspaceData` 改为调用该 RPC；前端在某段未 ready 时即便走到保存，也只提交自己确实加载成功的键，`storyboard` / `storyboardGroups` 不进入 patch，数据库中的旧值原样保留。RLS 仍由 `projects` 表现有策略生效（函数用 `security invoker`）。

> 数据库变更需交由有 Supabase 权限的同学执行上述 SQL（本项目约定不自动执行 `db:push`）。SQL 未执行前，第 1、2 步已经能阻断丢失。

## 涉及文件

- `src/routes/workspace.$workspaceId.tsx`：加载分支置位、保存守卫、失败提示与重试、patch 组装。
- `src/lib/projects.functions.ts`：`saveWorkspaceData` 改走合并 RPC，输入允许部分字段。
- `supabase/manual/`：新增待执行的 SQL 文件。

## 验证

- 模拟分镜结构请求失败：确认保存被拦截、出现错误提示、数据库中 storyboard 字段不变。
- 正常路径：进入项目 → 生成分镜 / 故事板 → 切到积分页 → 返回项目，内容完整。
- 回归：正常编辑剧本 / 角色 / 道具后保存仍生效，`completed_stages` 正常更新。