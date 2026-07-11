# 修复：刷新后角色阶段生成的场景/道具"后面几个"丢失

## 问题

在角色阶段提取/生成场景和道具后刷新页面，"后面几个"会消失。

## 根因

`saveWorkspaceData` 对 `projects.workspace_data` 列做的是**整体覆盖**（`projects.functions.ts:330-336` 的 `.update({ workspace_data })`，非 merge）。因此任何一次保存请求都会用"当时手里的 data"完整覆盖数据库——**谁的快照旧，谁就赢**。

`handleSaveWorkspace`（`workspace.$workspaceId.tsx:6127`）是组件体内定义的普通 async 函数，每次 render 重建，闭包捕获**当前 render 的所有 state**（`data`、`shotImages`、`panelImages`、`groupVideos`、`groupStoryboards`、`selectedCharImages`…）。

两个延迟调用点的闭包是陈旧的：

1. **beforeunload flush**（`6447-6460`）的 `useEffect` 依赖只有 `[dataLoaded, user]`，**不含 data/state**。handler 捕获的 `handleSaveWorkspace` 永远停在**页面加载完成那一刻**的实例——它保存的是加载时的旧快照（已有"前几个"），刷新时整体覆盖掉本次会话新生成的"后面几个"。这是主因。
2. **auto-save 防抖**（`6428-6443`）的 setTimeout 回调里 `if (savingWorkspace)` 读的也是闭包陈旧的 state。

时序：生成 → setData 更新 → auto-save 600ms 还没到 → 用户刷新 → beforeunload 用加载时旧快照整体覆盖 → 刷新后只看到"前几个"。即使 auto-save 已存过最新数据，也可能被这次旧快照覆盖请求抹掉。该 bug 是间歇性的（取决于旧快照请求是否抢在卸载前到达服务端），与用户"有时丢"的体验一致。

## 方案：`handleSaveWorkspaceRef` 模式

引入一个 ref，每次 render 同步写入**最新的 `handleSaveWorkspace` 实例**（该实例闭包捕获最新所有 state）。所有**延迟/异步**调用点改为调 `handleSaveWorkspaceRef.current(...)`，保证永远用最新快照保存，杜绝"旧覆盖新"。

这是项目已有模式（`charImagesRef` 同步写，`934-960`）的自然延伸，无需给每个 state 加 ref，无需改 `setData` 几十处调用，无需改 `handleSaveWorkspace` 签名。

### 不采用 keepalive/sendBeacon

`serverFnFetcher` 虽支持自定义 fetch（`first.fetch`），但 `fetch(..., { keepalive: true })` 和 `navigator.sendBeacon` 都有 **64KB body 限制**，而 `workspace_data`（剧本全文 + 角色/场景/道具 + 所有图片 URL）远超 64KB，对大工作区会直接失败。故不依赖 keepalive，改由"始终用最新快照"消除覆盖，配合现有 600ms auto-save 兜底落库。

## 改动点（均在 `src/routes/workspace.$workspaceId.tsx`）

1. **声明 ref**（`6115` `pendingSaveRef` 旁）：
   ```ts
   const handleSaveWorkspaceRef = useRef<(opts?: { silent?: boolean }) => Promise<void>>(
     async () => {},
   );
   ```

2. **每次 render 同步写 ref**（`handleSaveWorkspace` 定义之后，约 `6387`）：
   ```ts
   // 2026/07 修复:beforeunload / auto-save 等延迟调用若直接用闭包里的
   // handleSaveWorkspace,会捕获注册时的旧 state 快照,刷新时用旧 data 整体覆盖
   // workspace_data,抹掉本次会话新生成的场景/道具。改走 ref 永远拿最新实例。
   handleSaveWorkspaceRef.current = handleSaveWorkspace;
   ```

3. **延迟/异步调用点改调 ref**（同步事件回调如按钮 onClick 保留原样，它们用当前 render 最新实例）：
   - `6122` `scheduleSave` 内 `void handleSaveWorkspace(opts)` → `void handleSaveWorkspaceRef.current(opts)`
   - `6383` finally 排队重试 `void handleSaveWorkspace({ silent: true })` → ref
   - `6432-6438` auto-save setTimeout 回调：去掉陈旧的 `if (savingWorkspace)` 前置检查（`handleSaveWorkspace` 内部 `6133-6136` 已用最新 `savingWorkspace` 排队），改为 `void handleSaveWorkspaceRef.current({ silent: true })`
   - `6449-6456` beforeunload handler：`void handleSaveWorkspace({ silent: true })` → `void handleSaveWorkspaceRef.current({ silent: true })`
   - `6469` completedKey effect `void handleSaveWorkspace()` → ref

4. **beforeunload handler 保持 `clearTimeout(autoSaveTimerRef.current)`**（取消未触发的防抖，避免与 flush 重复），但不再有"旧快照覆盖"风险。

## 验证

- `bun run lint` 通过。
- 手动：新建工作区 → 提取某集角色/场景/道具 → **立即刷新**（<600ms）→ 场景/道具全部保留（含"后面几个"）。
- 手动：生成后等待 >600ms 再刷新 → 同样全部保留（回归 auto-save 路径）。
- 回归：正常编辑各阶段后刷新，内容不丢失、不被回退到旧版本。

## 残留风险（可接受，不本次处理）

用户生成后 <600ms 立即刷新、且 beforeunload 的 fetch 因页面卸载未完成时，本次生成可能未落库（但**不会被旧快照覆盖**，下次加载显示生成前的状态）。概率低、严重性低（非错乱性丢失）。如需进一步消除，可在场景/道具提取完成后用 `setTimeout(() => handleSaveWorkspaceRef.current({ silent: true }), 0)` 立即落库一次——留作后续增强，本次不做以保持改动聚焦。
