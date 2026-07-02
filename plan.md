# 道具（Props）类别 — 工作区角色流程扩展计划

## 背景

用户要求在 workspace 的"角色流程"中增加"道具"分类，与角色、场景并列。进入角色流程（episodes → character tab）时，AI 自动从当集剧本中提取道具。道具的定义是：**在本集中会根据剧情进行移动的物体**。

道具卡片需要：

1. 与角色/场景卡片风格一致的网格展示
2. 支持 AI 生成道具图
3. 三视图按钮（不同角度展示道具）
4. 编辑按钮（修改意见）
5. 点击卡片放大查看（lightbox）

---

## 需要修改的文件

### 1. `src/data/workspaceGenerators.ts` — 新增 GenProp 类型

新增类型定义：

```typescript
export type GenProp = {
  episodeIndex: number;
  id: string;
  name: string;
  description: string; // 道具的外观描述
  movementDescription: string; // 在本集中的移动/变化方式
  keyMoments: string[]; // 关键剧情节点
  palette: string[];
  swatch: string;
};
```

- `movementDescription` 是道具的核心字段，描述"本集中根据剧情移动的物体"
- `palette` 用于卡片颜色标识
- 与 GenScene 类似的 per-episode 结构（`episodeIndex`）

### 2. `src/lib/aiGenerate.functions.ts` — 新增 'prop-extract' 阶段

在 `StageEnum` 中添加 `'prop-extract'`，在 `stageSpec()` 中新增 case：

```typescript
case 'prop-extract':
  return {
    toolName: 'emit_props',
    system: '你是一名中文短剧道具提取师。...道具定义：在本集中会根据剧情进行移动的物体...',
    schema: {
      type: 'object',
      properties: {
        props: {
          type: 'array',
          maxItems: 20,
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              description: { type: 'string', description: '道具外观描述' },
              movementDescription: { type: 'string', description: '本集中如何移动/变化' },
              keyMoments: { type: 'array', items: { type: 'string' } },
              palette: { type: 'array', items: { type: 'string' } },
            },
            required: ['name', 'description', 'movementDescription'],
            additionalProperties: false,
          },
        },
      },
      required: ['props'],
      additionalProperties: false,
    },
  }
```

### 3. `src/routes/workspace.$workspaceId.tsx` — 主要修改点

#### 3a. WorkspaceData 类型 + emptyData（约第 39-67 行）

- `WorkspaceData` 添加 `props: GenProp[]`
- `emptyData` 添加 `props: []`

同时导入 `GenProp` 类型。

#### 3b. 新增 state（与场景平行的 state 组）

```typescript
const [propImages, setPropImages] = useState<Record<string, string[]>>({});
const [selectedPropImages, setSelectedPropImages] = useState<Record<string, string | null>>({});
const [busyProp, setBusyProp] = useState<string | null>(null);
const [propPreview, setPropPreview] = useState<GenProp | null>(null);
const [propModOpen, setPropModOpen] = useState<GenProp | null>(null);
const [propModInput, setPropModInput] = useState("");
const [propModBusy, setPropModBusy] = useState(false);
const [propModError, setPropModError] = useState<string | null>(null);
```

完全对称于 scene 的 state 模式。

#### 3c. charViewTab 增加 'props' 选项

```typescript
const [charViewTab, setCharViewTab] = useState<"characters" | "scenes" | "props">("characters");
```

#### 3d. Extract 流程 — 在 `produce()` 中增加道具提取

在 `isExtractFromEpisode` 分支（约第 4362 行），增加第三个 AI 调用：

```typescript
const [charResult, sceneResult, propResult] = await Promise.all([
  tryAi("character-extract", extractPrompt, snapshot, extractEpIndex),
  tryAi("scene", extractPrompt, snapshot, extractEpIndex),
  tryAi("prop-extract", extractPrompt, snapshot, extractEpIndex),
]);
```

然后将 propResult 合并到 aiPatch：

```typescript
const propsWithEp = propResult?.props?.map((p) => ({ ...p, episodeIndex: extractEpIndex }));
aiPatch = {
  ...(charResult ? { characters: charResult.characters } : {}),
  ...(sceneResult ? { scenes: scenesWithEp } : {}),
  ...(propResult ? { props: propsWithEp } : {}),
};
```

#### 3e. setData 的 'character' case 中处理 props（约第 4394 行）

```typescript
case 'character': {
  if (isExtractFromEpisode && aiPatch) {
    let characters = d.characters
    let scenes = d.scenes
    let props = d.props
    if (aiPatch.characters) characters = mergeExtractedCharacters(...)
    if (aiPatch.scenes) scenes = [...d.scenes.filter(...), ...aiPatch.scenes]
    if (aiPatch.props) {
      props = [
        ...d.props.filter((p) => p.episodeIndex !== extractEpIndex),
        ...aiPatch.props.map((p) => ({ ...p, episodeIndex: extractEpIndex })),
      ]
    }
    return { ...d, characters, scenes, props }
  }
  return { ...d, characters: aiPatch?.characters ?? generateCharacters() }
}
```

注意：props 和 scenes 一样是 per-episode 替换语义（不是跨集合并）。

#### 3f. charViewTab UI — 在角色标签页增加"道具"按钮

在 `charViewTab === 'characters'` 和 `'scenes'` 切换按钮旁，增加第三个：

```tsx
<button onClick={() => setCharViewTab("props")}>道具 {hasProps && `(${epProps.length})`}</button>
```

#### 3g. 道具卡片网格渲染（对称于场景卡片）

在 `charViewTab === 'scenes' ? ... :` 之后增加 `charViewTab === 'props' ?` 分支。

卡片设计：

- 与场景卡片相同的视觉风格（`aspect-video` 图区）
- 点击 → 打开 lightbox（`setPropPreview(p)`）
- 图区：点击生成道具图 / 显示已生成的图
- 文字区：道具名 + description + movementDescription
- 两个按钮（`e.stopPropagation()`）：
  - **三视图** → `runPropPresetRegen(p)` 生成不同角度的道具图
  - **编辑** → `openPropModPanel(p)` 打开修改输入
- 选中/已推荐按钮（对称于场景）

#### 3h. 道具图片生成函数

```typescript
async function genPropImage(p: GenProp) {
  // 与 genSceneImage 对称：调 callImage，prompt 包含道具描述
  // 背景纯白/纯色，无人物，聚焦道具
}
```

#### 3i. 道具三视图/修改函数

```typescript
async function doPropRegen(p: GenProp, mode: "modify" | "three-view", instruction: string) {
  // 对称于 doSceneRegen
}

async function runPropPresetRegen(p: GenProp) {
  // 三视图预设
}

function openPropModPanel(p: GenProp) {
  /* 对称于 openSceneModPanel */
}
function closePropModPanel() {
  /* ... */
}
async function submitPropModPanel() {
  /* ... */
}
```

#### 3j. 道具 Lightbox 预览

```tsx
{
  propPreview && (
    <div className="fixed inset-0 z-50 ..." onClick={() => setPropPreview(null)}>
      {/* 大图 + 道具详情（description, movementDescription, keyMoments） */}
    </div>
  );
}
```

#### 3k. 保存/加载 — 在 handleSaveWorkspace 和 load useEffect 中增加 props

**handleSaveWorkspace（约第 3730 行）：**

```typescript
const workspaceData = {
  ...
  props: data.props,
  propImages,
  selectedPropImages,
}
```

**load useEffect（约第 1051 行）：**

```typescript
if (Array.isArray(wd.props) && wd.props.length) {
  const props: GenProp[] = (wd.props as any[]).map((p) => ({
    ...p,
    episodeIndex: typeof p.episodeIndex === "number" ? p.episodeIndex : 1,
  }));
  setData((d) => ({ ...d, props }));
}
if (wd.propImages) setPropImages(wd.propImages as Record<string, string[]>);
if (wd.selectedPropImages)
  setSelectedPropImages(wd.selectedPropImages as Record<string, string | null>);
```

### 4. `src/components/workspace/WorkspaceTopbar.tsx` — 不需要修改

`WorkspaceTab` 类型不需要加新 tab，因为"道具"是在角色 tab 内部作为子视图展示的（和"角色/场景"切换一样），不在顶栏工作流中。

### 5. `src/i18n/zh.ts` 和 `src/i18n/en.ts` — 新增 i18n keys

zh:

```typescript
ws_tab_props: '道具',
zp_intro_props: '本集的道具将在此展示。道具是指在本集中会根据剧情进行移动的物体。',
zp_preset_props: '提取本集道具',
zp_quick_props: '提取本集道具',
zp_user_quick_props: '提取本集道具',
```

en:

```typescript
ws_tab_props: 'Props',
zp_intro_props: 'Props from this episode will be displayed here. Props are objects that move according to the plot.',
zp_preset_props: 'Extract props from this episode',
zp_quick_props: 'Extract props',
zp_user_quick_props: 'Extract props from this episode',
```

### 6. `src/lib/assetsStorage.ts` — 可选的 saveOneProp 函数

如果道具也需要保存到资产库，可以新增：

```typescript
export async function saveOneProp(p: GenProp, userId: string, coverUrl?: string | null) {
  // upsert to props table (需要先创建 props 表，或暂存在 workspace_data 中)
}
```

现阶段道具可以只存在 workspace_data JSON blob 中，不需要独立表。

---

## 实现步骤（按顺序）

1. **数据类型** — 在 `workspaceGenerators.ts` 添加 `GenProp` 类型
2. **AI 提取** — 在 `aiGenerate.functions.ts` 添加 `'prop-extract'` stage
3. **WorkspaceData** — 在 `workspace.$workspaceId.tsx` 添加 props 到 WorkspaceData/emptyData
4. **State** — 添加 propImages/selectedPropImages/busyProp/propPreview/propModOpen 等 state
5. **Extract 流程** — 在 `produce()` 中增加 prop-extract 调用 + setData 合并
6. **charViewTab** — 改为 `'characters' | 'scenes' | 'props'`，增加第三个 tab 按钮
7. **道具卡片渲染** — 编写 `charViewTab === 'props'` 的网格卡片
8. **图片生成** — `genPropImage` 函数
9. **三视图/编辑** — `doPropRegen`, `runPropPresetRegen`, `openPropModPanel` 等
10. **Lightbox** — 道具点击放大的 modal
11. **保存/加载** — handleSaveWorkspace + load useEffect 增加 props 持久化
12. **i18n** — 中英文新增 key

---

## 验证方法

1. 进入 workspace → 切换到某一集 → 在 ZopiaChatPanel 中点击"提取本集角色和场景"
2. 检查角色 tab 是否出现"道具"按钮，点击后是否显示提取到的道具卡片
3. 点击道具卡片 → 验证 lightbox 弹出显示详情
4. 卡片上点击"三视图" → 验证 AI 生成道具不同角度的图片
5. 卡片上点击"编辑" → 验证修改输入框，提交后 AI 重新生成
6. 保存 workspace → 刷新页面 → 验证道具数据持久化
7. 切换到不同集 → 验证道具按集过滤
