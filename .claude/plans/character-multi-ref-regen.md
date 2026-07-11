# 角色重生支持多图参考 + 强制参考"要改的那张图"

## 背景

两个角色重生场景目前都是**单图 I2I**：

- **场景1**（点角色卡片"修改" -> 右下角 agent 对话）：`setPendingRef` -> `onModifyReference` -> `submitModPanelRef` -> `doRegen(c, lookId, "modify", instruction)`（不传参考图，`doRegen` 内部取 `selectedCharImages ?? 最新`）
- **场景2**（点开角色预览 modal -> 右下角"修改形象"输入）：`submitModPanel` -> `doRegen(c, lookId, "modify", instruction, charModUploadedRef)`（上传图作为 `referenceOverride` **替代**主视图）

底层 `regenerateCharacterLook` 的 schema 是 `referenceImageUrl: z.string().url()`（单数）。但 Seedream 底层已支持多图（分镜 `regenerateStoryboardShot` 已用 `referenceImages: string[]` 数组，各供应商都支持）。

## 目标（用户已确认）

1. 两个场景底层都支持**多图参考**
2. **必须参考"要修改/重生的那张图"**（用户称"人物主视图"），它作为图1，**不被上传图替代**
   - 场景1 的"要改的那张" = `setPendingRef` 传的 `coverUrl`（`selectedCharImages[imageKey] || charImages[imageKey]?.at(-1)`）
   - 场景2 的"要改的那张" = modal 里用户选中的 `currentUrl`（`generations[currentIdx]`，`currentIdx = Math.min(selectedGenIdx, ...)`）
3. 额外参考图来源 = **上传本地图**（仅场景2 提供上传入口；场景1 仅自动带主视图）
4. 场景2 上传图从"替代主视图"改为"追加在主视图之后"，且支持**多张**

## 核心设计

- server fn 保留 `referenceImageUrl`（主视图，图1，必填），新增 `extraReferenceImageUrls`（额外图，可选数组，max 4）。
- `doRegen` 第 5 参数语义从 `referenceOverride`（覆盖）改为 `mainViewUrl`（主视图）；新增第 6 参数 `extraReferenceUrls: string[]`。
- 主视图由调用方明确传入；`doRegen` 内部仅在第 5 参数缺省时回退 `pinned ?? fallback`（兼容 `processCharacter` / `runPresetRegen` 旧调用）。
- 多图融合只作用于 `modify` 模式；`three-view` / `multi-asset` 保持单图（`runPresetRegen` 不传 extraRefs）。

## 改动清单

### 1. server fn schema

**`src/lib/characterRegen.functions.ts`**（Input，~L19）+ **`src/lib/seedream.functions.ts`**（`RegenerateInput`，~L474）：

```ts
referenceImageUrl: z.string().url(),                              // 主视图(图1),必填,保持
extraReferenceImageUrls: z.array(z.string().url()).max(4).optional(), // 新增:额外参考图
```

### 2. `regenerateCharacterLook` 实现（`seedream.functions.ts` ~L828）

- `buildCharacterPrompts` 透传 `extraReferenceImageUrls`；**modify 模式** prompt 增加说明：
  - `图1 = 角色主视图(要修改的基础图),脸/身材/构图/风格以此为准`
  - `图2..N = 额外参考(风格/细节/配饰参考),仅当修改意见涉及时参考,不得改图1 的身份特征`
  - 保留"只改用户意见提到的部分,未提及保持图1"的现有约束
- 各供应商调用从 `referenceImages: [data.referenceImageUrl]` 改为：
  ```ts
  referenceImages: [data.referenceImageUrl, ...(data.extraReferenceImageUrls ?? [])]
  ```
- `previewOnly` 分支的 `promptExtra` 增加 `extraReferenceImageUrls` 字段（提示词预览可见）
- 入口校验：总图数 = 1 + extra ≤ 5（Seedream 上限 10，这里更保守）

### 3. `doRegen`（`workspace.$workspaceId.tsx` ~L2857）

签名改为：
```ts
async function doRegen(
  c: GenCharacter,
  lookId: string | null,
  mode: "modify" | "three-view" | "multi-asset",
  instruction: string,
  /** 主视图(图1,要改的那张)。缺省则回退 selectedCharImages ?? 最新(兼容旧调用) */
  mainViewUrl?: string,
  /** 额外参考图,追加在主视图后。默认 [] */
  extraReferenceUrls: string[] = [],
  replaceExisting = false,
)
```

内部：
- `mainView = mainViewUrl ?? (pinned && generations.includes(pinned) ? pinned : fallback)`
- `extraRefs = extraReferenceUrls.filter(u => u && u !== mainView)`（去重、去空）
- `callRegenCharacter({ ..., referenceImageUrl: mainView, extraReferenceImageUrls: extraRefs })`
- `regenBusyKeys` / history push / `replaceExisting` 逻辑不变

**调用点适配**（4 处）：
| 位置 | 现状 | 改为 |
|---|---|---|
| L2451 `processCharacter` | `doRegen(c, lookDbId, "modify", instruction, referenceImageUrl)` | 不变（第5参数=主视图，语义一致） |
| L3409 `runPresetRegen` | `doRegen(c, lookId, mode, instruction)` | 不变（不传主视图，内部 fallback，three-view/multi-asset 单图） |
| L3131 `submitModPanel`（场景2） | `doRegen(c, lookId, "modify", instruction, charModUploadedRef ?? undefined)` | `doRegen(c, lookId, "modify", instruction, currentUrl, charModUploadedRefs)` |
| L3238 `submitModPanelRef`（场景1） | `doRegen(c, lookId, "modify", instruction)` | `doRegen(c, lookId, "modify", instruction, mainViewUrl)` |

### 4. `submitModPanel`（场景2，~L3084）

- 计算 `currentUrl`（要改的那张）：
  ```ts
  const generations = charImagesRef.current[imageKey] ?? [];
  const currentIdx = Math.min(selectedGenIdx, Math.max(0, generations.length - 1));
  const currentUrl = generations[currentIdx];
  ```
  （与 modal 渲染 L10468 的 `currentIdx` 算法一致）
- 有图分支：`doRegen(c, lookId, "modify", instruction, currentUrl, charModUploadedRefs)`
- 空角色分支（T2I 首次生成）不变
- `currentUrl` 不存在时 toast 报错返回（与原 `coverUrl` 校验对齐）

### 5. `submitModPanelRef`（场景1，~L3231）

- 签名加 `mainViewUrl?: string`
- `const coverUrl = mainViewUrl ?? charImages[imageKey]?.at(-1);`（主视图优先用调用方传的"要改的那张"）
- `doRegen(c, lookId, "modify", instruction, coverUrl)` —— 仅主视图，无额外图
- 后续 `callDescribeCharImg` / 描述追加 / 保存逻辑不变

### 6. `onModifyReference` 链路（workspace ~L10443 + ZopiaChatPanel）

- workspace `onModifyReference` 回调 character 分支：
  `submitModPanelRef(c, lookId ?? null, instruction, mainViewUrl)` —— 把 `mainViewUrl` 传下去
- ZopiaChatPanel `onModifyReference` prop 类型（~L323）增加 `mainViewUrl?: string`
- ZopiaChatPanel `send` 的 `pendingRef` 分支（~L753）：
  `onModifyReference?.(pr.refType, pr.refId, trimmed, pr.lookId, pr.imageUrl)`
  —— `pendingRef.imageUrl` 即"要改的那张"，作为主视图传出
- scene / prop 分支不传 `mainViewUrl`，保持原单图行为

### 7. 场景2 上传 UI + state（~L962, ~L10779-10807）

- state：`charModUploadedRef: string | null` -> `charModUploadedRefs: string[]`
- `openModPanel`（~L2836）/ `closeModPanel` 增加重置 `setCharModUploadedRefs([])`
- 新增 `pickLocalImagesAsDataUrl(onResults: (urls: string[]) => void)`（复数版）：`input.multiple = true`，循环 `FileReader` 读每张为 dataUrl，统一回调。原 `pickLocalImageAsDataUrl` 保留（其它地方可能用）
- 上传按钮 `onClick`：`pickLocalImagesAsDataUrl((urls) => setCharModUploadedRefs(prev => [...prev, ...urls].slice(0, 4)))`（守 4 张上限）
- 缩略图区：`charModUploadedRefs.map(...)` 渲染多个缩略图，每个带 X 删除按钮（`setCharModUploadedRefs(prev => prev.filter((_, i) => i !== idx))`）。参考 ZopiaChatPanel attachments 展示样式（~L2202）
- 底部"参考图"文案：`主视图:第 X / Y 张 + 额外参考 N 张`

### 8. i18n（`src/i18n/zh.ts` / `en.ts`）

按需新增键（上传按钮 title、多图说明、上限提示等）。两文件同步。

## 不改动

- scene / prop 重生（`submitSceneModPanelRef` / `doPropRegen`）保持单图
- `three-view` / `multi-asset` 模式保持单图
- `processCharacter` 的 `siblingAnchor` 锁脸逻辑不变
- 场景1 不在对话里加额外上传入口（用户确认"仅自动带主视图"）

## 风险与注意

- **行为变更**：场景2 上传图从"替代主视图"变为"追加"——这是用户明确要求的。需在 PR 说明里点出。
- **超时**：多参考图融合 + 高分辨率可能触发 Seedream 超时（CLAUDE.md 已记 180s）。额外图上限 4 张（总 5），在 Seedream 10 张限制内，风险可控。
- **payload 体积**：`charModUploadedRefs` 存 base64 dataUrl，多张会增大请求体。CF Worker 有请求体限制，4 张内可接受；超出由 `pickLocalImagesAsDataUrl` 的 `maxSizeMb` 单张校验兜底。
- **`doRegen` 第 5 参数语义变化**：从"覆盖 referenceUrl"改为"指定主视图"。L2451 传的 `referenceImageUrl` 本就是主视图语义，无行为变化；L3131 是有意的行为变更。

## 验证

- 场景1：点角色"修改" -> 对话输入意见 -> 确认 `doRegen` 收到 `mainViewUrl = pendingRef.imageUrl`，server fn `referenceImageUrl` = 该图，`extraReferenceImageUrls` = []
- 场景2：点开角色 -> 在历史缩略图选中第 N 张 -> 上传 2 张本地图 -> 输入意见发送 -> 确认 `referenceImageUrl` = 第 N 张（要改的），`extraReferenceImageUrls` = [上传1, 上传2]
- 场景2 不上传：`extraReferenceImageUrls` = []，仅主视图（与场景1 等价）
- `three-view` / `multi-asset` 按钮：仍单图，行为不变
- `bun run lint && bun run format`
