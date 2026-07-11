# 修复：分镜版编辑左侧剧情后，故事板/分镜图仍按原剧情生成

## 根因

分镜版左侧"分镜描述"可编辑框，内容来自 `effectiveShotBreakdown(g)`，用户编辑后点"完成"
存到 `g.shotBreakdownText`（`commitGroupBreakdown`，[workspace.$workspaceId.tsx:4290](src/routes/workspace.$workspaceId.tsx#L4290)）。

但故事板图 / 分镜图的生成与重生调用，传给服务端的 `plotText` 字段用的是
**`group.plotText`**（AI 切分时写死的原始剧情），完全没读用户编辑后的 `shotBreakdownText`：

| 动作 | 调用点 | 当前传值 |
|------|--------|---------|
| 生成分镜图 | `generateShotImageForGroup` [:4384](src/routes/workspace.$workspaceId.tsx#L4384) | `group.plotText` |
| 分镜图重生 | `handleRegenShot` [:4537](src/routes/workspace.$workspaceId.tsx#L4537) | `group.plotText` |
| 生成故事板 | `generateMangaStoryboardForGroup` [:5403](src/routes/workspace.$workspaceId.tsx#L5403) | `group.plotText \|\| "(无剧情摘要)"` |
| 故事板重生 | `handleRegenStoryboard` [:5629](src/routes/workspace.$workspaceId.tsx#L5629) | `group.plotText \|\| "(无剧情摘要)"` |

对照：**视频生成**这条链路早就改对了，用的是 `effectiveShotBreakdown(group)`
（[:4790](src/routes/workspace.$workspaceId.tsx#L4790) / [:4965](src/routes/workspace.$workspaceId.tsx#L4965)）。
故事板/分镜图这两条链路漏改，所以改完左侧剧情，出图仍按 AI 原始剧情。

服务端 `buildPitchDeckPrompt` 把 `plotText` 放进 `[STORY PLOT]` 段
（[seedream.functions.ts:2004](src/lib/seedream.functions.ts#L2004)），分镜图 prompt 放进
`[剧情上下文]`（[:1128](src/lib/seedream.functions.ts#L1128) / [:1499](src/lib/seedream.functions.ts#L1499)），
剧情就是这么传给模型的 → 根因在客户端传值层，无需改服务端。

## 修复方案

新增一个 helper `effectivePlotText(g)`，与 `effectiveShotBreakdown` 同语义但**带长度兜底**，
**未编辑时保持原行为**（零副作用），只在用户编辑过时才用编辑后的内容：

```ts
// 紧跟 effectiveShotBreakdown 之后（约 4021 行后）
/**
 * 生成故事板/分镜图时传给 server 的"剧情"文本：
 * 用户编辑过左侧"分镜描述"（g.shotBreakdownText 非空）-> 用编辑后的内容；
 * 否则 -> 用 AI 原始剧情 g.plotText（保持原行为）。
 * slice(0,2000) 守 server 端 ShotInput/PitchDeckInput 的 plotText max(2000)。
 * 与视频生成用 effectiveShotBreakdown 的行为一致，但避免对未编辑 group 产生冗余。
 */
function effectivePlotText(g: StoryboardGroup): string {
  const edited = g.shotBreakdownText?.trim();
  if (edited) return edited.slice(0, 2000);
  return (g.plotText ?? "").slice(0, 2000);
}
```

### 改动点（4 处，均在 [workspace.$workspaceId.tsx](src/routes/workspace.$workspaceId.tsx)）

1. `generateShotImageForGroup`（[:4384](src/routes/workspace.$workspaceId.tsx#L4384)）
   `plotText: group.plotText,` → `plotText: effectivePlotText(group),`

2. `handleRegenShot`（[:4537](src/routes/workspace.$workspaceId.tsx#L4537)）
   `plotText: group.plotText,` → `plotText: effectivePlotText(group),`

3. `generateMangaStoryboardForGroup`（[:5403](src/routes/workspace.$workspaceId.tsx#L5403)）
   `plotText: group.plotText || "(无剧情摘要)",` → `plotText: effectivePlotText(group) || "(无剧情摘要)",`

4. `handleRegenStoryboard`（[:5629](src/routes/workspace.$workspaceId.tsx#L5629)）
   `plotText: group.plotText || "(无剧情摘要)",` → `plotText: effectivePlotText(group) || "(无剧情摘要)",`

### 不改的部分

- **`groupLabel`**：服务端 `buildPitchDeckPrompt` 根本没读它（只在 schema 定义 [:1851](src/lib/seedream.functions.ts#L1851)），保持 `group.plotText?.slice(0, 60)` 即可。
- **服务端**：不动。schema / prompt builder 都不用改。
- **i18n / 数据库 / 类型**：不动。`shotBreakdownText` 字段早已存在。
- **视频生成**：已正确用 `effectiveShotBreakdown`，不动。

## 范围说明

用户原话只提到"故事板"，但**分镜图（分镜卡片图）有完全相同的 bug**——改了左侧剧情，分镜图也仍按原剧情生成。
建议 4 处一起修，与视频生成链路行为统一。若只想先修故事板，则只改第 3、4 点即可。

## 验证

- 编辑某组左侧"分镜描述"（改几个字/加一句台词）→ 点"完成" → 点"生成故事板"，
  打开"查看提示词"模式（previewOnly），确认 `[STORY PLOT]` 段是编辑后的文本，而非原始 plotText。
- 同样验证"生成故事板/重新生成故事板"按钮（generateMangaStoryboardForGroup）与
  "一键生成全部/分镜图重生"（generateShotImageForGroup / handleRegenShot）。
- 未编辑任何组的 group，出图行为应与修复前一致（plotText 仍是 group.plotText）。
