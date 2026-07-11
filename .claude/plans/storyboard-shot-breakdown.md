# 分镜组左侧模块改造：剧情 → 分镜描述

## 目标
把分镜阶段每个分镜组左侧的「剧情 · Plot」模块改成「分镜描述」：
- 文本内容 = **自动镜头分解**（即视频提示词里 `[SHOT BREAKDOWN - for additional sequence hints]` 的内容）+ **现有 plotText 全文**（含台词），合成一段可编辑文本。
- 编辑后的「分镜描述」**覆盖**视频生成提示词里的 `[SHOT BREAKDOWN]` 段。
- 编辑框做大。

## 已确认的决策（来自用户）
1. 台词来源：**带入现有 plotText 全文**（镜头分解拼在 plotText 前面）。
2. 编辑后**覆盖**视频生成的 `[SHOT BREAKDOWN - for additional sequence hints]` 段。

## 关键事实（调研结论）
- shots **没有独立台词字段**，台词只存在于 `plotText` 散文里（服务端 prompt 要求"完整引用台词"，见 `storyboard.functions.ts:164`）。
- 视频提示词有**两个** builder（都在 `src/routes/workspace.$workspaceId.tsx`）：
  - `buildVideoGenPayloadForShots`（按分镜图生成，:4658）：含 `Shot breakdown: ${shotDescriptions}` + `[Storyboard sequence: plotText]`
  - `buildVideoGenPayloadForStoryboard`（按故事板生成，:4841）：含 `[SHOT BREAKDOWN - for additional sequence hints]\n${shotDescriptions}` + `[NARRATIVE REFERENCE - plot context, secondary]\n${plotText}`
- 两者由 `executeVideoGen(groupId, method, …)`（:5037）按 `method: "shots" | "storyboard"` 分派。
- 持久化是 `workspace_data` JSON 整体存（`projects.functions.ts:333`），**新增可选字段不需要数据库迁移**。
- `plotText` 还用于故事板**图像**生成（`seedream.functions.ts:2003` `[STORY PLOT]`），不能动它的含义。
- 编辑状态：`editingGroupId` / `groupPlotDraft` / `commitGroupPlot`（:1285/:1286/:4260），目前写回 `g.plotText`。
- 左侧模块 UI：`workspace.$workspaceId.tsx:9447-9498`，标题"剧情 · Plot"，`<pre>{g.plotText}</pre>`，textarea `min-h-[80px]`，容器 `max-h-[280px]`。

## 实施方案

### 1. 数据模型：新增可选字段
`src/data/workspaceGenerators.ts` 的 `StoryboardGroup`（:224）新增：
```ts
/** 2026/07:分镜描述(镜头分解 + 台词/剧情),覆盖视频生成 [SHOT BREAKDOWN]。
 *  undefined = 未编辑,展示/生成时用自动算的默认值(镜头分解 + plotText)。 */
shotBreakdownText?: string;
```
JSON 持久化，无需迁移；服务端生成 group 时不设此字段（undefined 即可）。

### 2. 新增 helper：算「镜头分解」与「分镜描述默认值」
在 `workspace.$workspaceId.tsx`（放在 `composePlotText` 附近，:3986 一带）加：
```ts
// 镜头分解:与视频提示词 [SHOT BREAKDOWN] 同格式。Shot N [起-止s] [景别] 动作 (camera: X) -> ...
function buildShotBreakdown(g: StoryboardGroup): string {
  return g.shots
    .map((s, i) => {
      const cam = s.camera ? ` (camera: ${s.camera})` : "";
      const time = s.startSec != null && s.endSec != null
        ? ` [${s.startSec.toFixed(0)}-${s.endSec.toFixed(0)}s]` : "";
      return `Shot ${i + 1}${time} [${s.shotTypeLabel}] ${s.action}${cam}`;
    })
    .join(" -> ");
}
// 分镜描述默认值 = 镜头分解 + plotText(含台词);用户编辑后用 shotBreakdownText 覆盖。
function buildShotBreakdownDisplay(g: StoryboardGroup): string {
  const breakdown = buildShotBreakdown(g);
  const plot = (g.plotText ?? "").trim();
  return plot ? `${breakdown}\n\n${plot}` : breakdown;
}
// 统一取"生效的分镜描述":已编辑用编辑值,否则默认值。
function effectiveShotBreakdown(g: StoryboardGroup): string {
  const v = g.shotBreakdownText?.trim();
  return v ?? buildShotBreakdownDisplay(g);
}
```

### 3. 视频提示词：用分镜描述覆盖 [SHOT BREAKDOWN]，并去掉重复的 plotText 段
为避免 plotText 在提示词里出现两次（既在分镜描述里、又在单独的 plot 段里），把原本单独的 plotText 段去掉，统一并入分镜描述。

- **`buildVideoGenPayloadForStoryboard`（:4944 parts 数组）**：
  - 删掉 `{ text: \`[NARRATIVE REFERENCE - plot context, secondary]\` }` 和 `{ text: group.plotText || "(无剧情摘要)" }` 两项（:4952-4953）。
  - 把 :4954-4958 的 `[SHOT BREAKDOWN - for additional sequence hints]\n${shotDescriptions}` 改为用 `effectiveShotBreakdown(group)`：
    ```ts
    { text: `[SHOT BREAKDOWN - for additional sequence hints]\n${effectiveShotBreakdown(group)}` }
    ```
  - 删掉本函数内 :4929-4938 不再使用的 `shotDescriptions` 局部变量。
- **`buildVideoGenPayloadForShots`（:4764 parts 数组）**：
  - 把 :4765 `{ text: \`[Storyboard sequence: ${group.plotText || ""}]\` }` 删掉（plotText 已并入分镜描述）。
  - 把 :4766 `{ text: \`Shot breakdown: ${shotDescriptions}\` }` 改为：
    ```ts
    { text: `Shot breakdown: ${effectiveShotBreakdown(group)}` }
    ```
  - 删掉本函数内 :4754-4759 不再使用的 `shotDescriptions` 局部变量。
  - `shotImagesList.length`（:4768 的 "flows through all N shots"）保持不变——它描述的是实际送出的分镜图数量。

> 说明：这样无论用户是否编辑过分镜描述，视频模型都能拿到「镜头分解 + 台词/剧情」的完整信息；用户编辑后则完全用用户的版本。语义上 plotText 从单独的 `[NARRATIVE REFERENCE]` 段移入 `[SHOT BREAKDOWN]` 段，内容不丢、只是不再重复。

### 4. 左侧模块 UI 改造（:9447-9498）
- 标题 `剧情 · Plot` → `分镜描述`（:9452）。
- 编辑按钮 title `编辑剧情` → `编辑分镜描述`（:9475）；「完成」按钮 title `保存修改` 保留。
- 只读展示 `<pre>{g.plotText}</pre>` → `<pre>{effectiveShotBreakdown(g)}</pre>`（:9496）。
- textarea：
  - value 由 `groupPlotDraft[g.id] ?? g.plotText` → `groupBreakdownDraft[g.id] ?? effectiveShotBreakdown(g)`（:9484）。
  - 编辑框做大：`min-h-[80px]` → `min-h-[180px]`（:9488），保留 `resize-y`。
- 容器高度：`max-h-[280px]` → `max-h-[420px]`（:9448），给放大的编辑框留空间。
- 进入编辑时种草稿：`setGroupPlotDraft((prev) => ({ ...prev, [g.id]: g.plotText }))` → 用 `effectiveShotBreakdown(g)` 种到新的 draft state（:9472）。

### 5. 编辑状态：从 plotText 草稿改为分镜描述草稿
把现有 `groupPlotDraft` 复用/改名为分镜描述草稿，落盘写 `shotBreakdownText`：
- `:1286` `const [groupPlotDraft, setGroupPlotDraft] = useState<Record<string, string>>({});` 改名为 `groupBreakdownDraft` / `setGroupBreakdownDraft`（语义更准）。
- `commitGroupPlot`（:4260）改名为 `commitGroupBreakdown`，落盘改成写 `shotBreakdownText`：
  ```ts
  g.id === groupId && effectiveShotBreakdown(g) !== draft
    ? { ...g, shotBreakdownText: draft }
    : g
  ```
  （用 `effectiveShotBreakdown(g) !== draft` 做 bail-out，等价于"草稿和当前生效值相同就不写"。）
- `:3900` runEnterStoryboard 重置处的 `setGroupPlotDraft({})` → `setGroupBreakdownDraft({})`。
- `:9457` `commitGroupPlot(g.id)` → `commitGroupBreakdown(g.id)`。
- `:9469` `commitGroupPlot(editingGroupId)` → `commitGroupBreakdown(editingGroupId)`。
- `editingGroupId` / `setEditingGroupId` 保留不变（仍只允许一个 group 同时编辑）。

> 注：`plotText` 由此不再在 UI 直接可编辑（它仍由 AI 生成、仍用于故事板图像生成）。用户改为编辑「分镜描述」——其中已包含 plotText 内容，可正常增删台词/剧情。

### 6. 不改动
- `seedream.functions.ts` 的 `[SHOT BREAKDOWN]`（故事板**图像**生成，:2012）——与视频无关，不动。
- `composePlotText` 及其 useEffect（:6467）——不动。
- 「查看提示词」预览 modal——自动跟随 parts 变化，无需额外改。

## 影响面
- 改动文件：`src/data/workspaceGenerators.ts`（+1 字段）、`src/routes/workspace.$workspaceId.tsx`（helper + 2 个 builder + 左侧 UI + 编辑状态）。
- 无数据库迁移（JSON 持久化）。
- 向后兼容：旧数据无 `shotBreakdownText`，`effectiveShotBreakdown` 走默认值，行为对老数据等价于「镜头分解 + plotText」。
- 视频提示词语义变化：plotText 从独立段并入 `[SHOT BREAKDOWN]` 段（内容不丢、不重复）。

## 验证
- `bun run lint` 通过。
- 手动：进入分镜阶段，确认左侧标题变「分镜描述」、内容为「镜头分解 + plotText」、编辑框变大；编辑后点完成，再生成视频，确认提示词预览里 `[SHOT BREAKDOWN]` 段用的是编辑后的分镜描述、且 plotText 不再重复出现。
