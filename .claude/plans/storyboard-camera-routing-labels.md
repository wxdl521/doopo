# 故事板镜头动线标注 + 视频生成动线遵循

## 问题诊断

用户诉求:分镜版阶段生成故事板时,(1) 镜头动线要标明对应哪个分镜;(2) 固定机位要标明"镜头几"在哪个位置拍摄;(3) 把分镜描述里的 camera 信息加到每个分镜;根本痛点是"生成的视频对故事板人物动线和镜头动线的遵循能力不够"。

根因(已定位):

1. **故事板俯视图(`seedream.functions.ts:buildPitchDeckPrompt`)** 主动**禁止**标注镜头编号到动线上(第 2040 行 `Do NOT draw separate camera markers or labels (no ▲, no CAM1/CAM2)`),固定机位(`固定机位/无运镜`)**不画任何标记**;每帧 caption 只有「镜头N · Ns · 景别 · 动作」(第 2028 行),**不含 camera**。→ 对应诉求 (1)(2)(3) 全部缺失。
2. **视频生成(`workspace.$workspaceId.tsx:buildShotBreakdown`)** 输出 `Shot N [时间] [景别] 动作 (camera: X)`,**缺 `cameraMovement`(镜头动线)和 `characterBlocking`(人物动线)**;视频 prompt 也无明确"遵循运镜/走位"指令。→ 对应痛点"视频遵循动线不够"。
3. **分镜生成(`storyboard.functions.ts`)** AI 已输出 camera/cameraMovement/characterBlocking ✓,`StoryboardShot` 类型(`data/workspaceGenerators.ts:177`)也有这两个字段 ✓,故事板生成调用(`workspace:5452-5454`)已透传 ✓。**不需改**。

`buildShotBreakdown` 改动会同时影响:视频 prompt(4845/5020)、左侧"分镜描述"展示(9557/9570/9585)。两处都希望看到完整动线信息,符合预期。

---

## 改动 A:故事板图(`src/lib/seedream.functions.ts`)

### A1. 每帧 caption 加 camera(机位)信息

`buildPitchDeckPrompt` 第 2028-2029 行(caption 规则)。把 caption 格式从:
```
镜头N · Ns · 景别 · 动作
```
改成:
```
镜头N · Ns · 景别 · 动作 · 机位:camera
```
(camera 为空则省略 `· 机位:...` 段;有角色/空镜两条 caption 行都改,e.g. 改成 `镜头1 · 4s · 中景 · 陆深推门入场坐下 · 机位:平视50mm讲台左侧`。)

同时在 `[SHOT BREAKDOWN]` 的 `shotLines`(1973-1986)已经是 `Frame N: [景别] action | camera: ... | camMovement: ... | blocking: ...`,**保持不变**(AI 读这段来画俯视图,信息已全)。

### A2. 俯视图:每条镜头动线标注对应"镜头N"

第 2040 行(镜头运动路线规则)。把"Do NOT draw separate camera markers or labels"反转成:**每条 dashed 镜头动线沿线/起点用小字标注它对应的"镜头N"**,让分镜和动线一一对应。多条动线同属一个镜头时(如环绕+拉远)标同一个"镜头N"。

### A3. 俯视图:固定机位画机位标记 + "镜头N"

第 2040 行末尾原本"固定机位/无运镜 → 不画动线"。改成:**固定机位的镜头,在拍摄位置画一个三角形机位标记 ▲(尖端朝向拍摄方向),旁边标"镜头N"**,不再留空。这样固定机位镜头在俯视图上也有位置标注,与运动镜头统一编号体系。

### A4. Legend 补充固定机位说明

第 2045-2046 行(legend)。有角色时从 2 行改 3 行:
```
dashed arrow + 镜头N = 镜头运动路线 (camera path)
▲ 镜头N = 固定机位 (fixed camera position,尖端朝向)
solid arrow = 人物动线 (character path)
```
(空镜无人物动线时为 2 行: dashed + ▲)

### A5. RULE 6 同步更新

第 2071-2072 行(`Diagram logic` 描述),补一句"每条镜头动线/固定机位都标注对应镜头N,与上方分镜格编号一致"。

### A6. negative prompt 调整

第 2096-2097 行。删掉 `separate camera markers or CAM1/CAM2 labels on the diagram`(与新要求冲突)。**保留**禁止 emoji(📷)、带圈符号(①②③)的项(用户之前要求纯文字标注)。补一项 `camera paths / fixed camera markers without 镜头N label`(要求每条动线/机位必须带镜头编号)。

---

## 改动 B:视频生成(`src/routes/workspace.$workspaceId.tsx`)

### B1. `buildShotBreakdown` 补 cameraMovement / characterBlocking

第 4014-4025 行。从:
```ts
return `Shot ${i + 1}${time} [${s.shotTypeLabel}] ${s.action}${cam}`;
```
改成(运镜/走位为空则省略对应段):
```ts
const mov = s.cameraMovement ? ` | 运镜: ${s.cameraMovement}` : "";
const blk = s.characterBlocking ? ` | 走位: ${s.characterBlocking}` : "";
return `Shot ${i + 1}${time} [${s.shotTypeLabel}] ${s.action}${cam}${mov}${blk}`;
```
输出示例:`Shot 1 [0-4s] [中景] 陆深推门入场坐下 (camera: 平视50mm讲台左侧 | 运镜: 从全景缓慢推到角色面部特写 | 走位: 陆深从门口走向座位)`

### B2. `buildVideoGenPayloadForShots` prompt 加动线遵循指令

第 4844-4860 行 parts 数组。在 `Cinematic motion...` 后追加一条非 tech 指令:
```ts
{ text: `Follow each shot's 运镜 (camera movement) and 走位 (character blocking) exactly as described in the Shot breakdown: the camera moves as specified (push/pull/pan/track/orbit/fixed), and characters move along their described paths. Fixed-camera shots keep the camera still.` },
```

### B3. `buildVideoGenPayloadForStoryboard` prompt 加动线遵循指令

第 5011-5041 行 parts 数组。在 `[CONSTRAINTS]` 块里追加一条 tech 指令:
```ts
{ text: `- Follow the storyboard's top-down camera diagram: each shot's camera movement (dashed path) and character blocking (solid path) must be reflected in the video - camera moves along its labeled path, fixed-camera shots (▲) stay still, characters follow their blocking paths`, tech: true },
```
(此模式以故事板图为主参考,所以指令明确引用俯视图的动线标注。)

---

## 不改

- `storyboard.functions.ts`:AI 已输出 camera/cameraMovement/characterBlocking,normalizeShot 已保留。不动。
- 老的 `StoryboardPanel` 链路(`genPanelImage` 3789 行 `Shot ${p.shot}: ${p.camera}`):是 legacy panel 概念,与"分镜组+shot"链路无关,不动。

## 验证

- `bun run lint` + `bun run build`(确认类型/构建通过)
- 手动:用"查看提示词"模式生成一组故事板,确认 prompt 里 caption 含机位、俯视图要求标镜头N + 固定机位 ▲;再生成视频,确认 prompt 的 Shot breakdown 含运镜/走位段。

## 影响面

- 老数据(无 cameraMovement/characterBlocking 的 shot):buildShotBreakdown 省略空段,caption 省略机位,显示不受影响。
- 用户已编辑的 `shotBreakdownText`:仍走编辑值(`effectiveShotBreakdown` 优先编辑值),不受 buildShotBreakdown 改动影响。
