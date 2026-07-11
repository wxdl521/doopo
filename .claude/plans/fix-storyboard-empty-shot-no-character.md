# 修复：纯场景镜头（空镜）生成分镜图时凭空出现主角

## 问题复现

- 剧情（plotText）：`晨光穿透浓密的树冠，在铺满落叶与青苔的湿地上投下斑驳光影。`（纯风景，无人物）
- 场景：选了 1 张森林场景图
- 角色：**未传任何人物图**（characterIds 为空 -> characterImageUrls 为空）
- 结果：生成的分镜图里却有一个主角站在森林里 → 故事板未遵循剧情

## 根因

生成路径 `generateStoryboardShotImage` → `buildShotInstruction`（[src/lib/seedream.functions.ts:1115](src/lib/seedream.functions.ts#L1115)）在 `characterImageUrls.length === 0` 时，**指令自相矛盾**：

第 1 条确实写了「本镜头没有角色,纯场景」，但紧接着的指令仍在诱导模型画人：

1. **第 3 条景别描述全部人物导向**（[:1143-1152](src/lib/seedream.functions.ts#L1143-L1152)）：
   - MS →「人物从膝盖以上,展示肢体语言和主要动作」
   - CU →「人物胸部以上,重点是表情、眼神、情绪」
   - ECU →「画面聚焦在某个细节(眼睛、嘴唇、手、道具)」
   - OTS →「从某人肩膀后面拍另一人」
   - 连 WS 都是「人物在画面中占比较小」
2. **第 5 条**（[:1154](src/lib/seedream.functions.ts#L1154)）：`角色动作 / 表情 / 视线方向严格按本镜头的 action 执行` —— 无角色时仍在谈角色动作/表情/视线。
3. **`buildShotNegative()`**（[:1163](src/lib/seedream.functions.ts#L1163)）只禁 `extra people / bystander / crowd`，模型不把「主角」当成 extra people，所以拦不住。

模型收到矛盾指令（一边「纯场景」一边「人物如何如何」）→ 倾向于补一个「主角」进来。

## 修复方案（仅改 `src/lib/seedream.functions.ts` 一个文件）

### 改动 1：`buildShotInstruction` 无角色分支去人物诱导

当 `data.characterImageUrls.length === 0` 时：

- **第 1 条**强化：明确「本镜头是空镜/纯场景镜头，画面中**不得出现任何人物、人影、人体轮廓、手脚、面部**，只呈现环境、光影、植被、道具」。
- **第 3 条景别描述**改用环境导向文案（不提「人物」），5 个景别各给环境版：
  - WS →「远景:展现整体空间、地理关系与环境氛围,环境占据画面主体」
  - MS →「中景:呈现环境的中景空间关系与关键道具/植被/建筑结构」
  - CU →「近景:聚焦环境中的某个局部(树干、落叶、光斑),环境细节为主」
  - ECU →「特写:聚焦环境微观细节(叶脉、苔藓纹理、水滴),质感与光影为主」
  - OTS →「过肩镜头需要人物,本镜头无人物,按近景环境处理」
- **第 5 条**无角色时改为：「严格按剧情上下文呈现环境氛围、光线与可见道具，**不得添加任何人物**」。

实现方式：把现有「景别描述三元表达式」抽成按 `hasCharacters` 二选一的两套文案；第 5 条同理加 `hasCharacters` 分支。

### 改动 2：`buildShotNegative` 参数化

签名改为 `buildShotNegative(hasCharacters: boolean)`。

- `hasCharacters === true`：保持现有负面词不变。
- `hasCharacters === false`：在现有负面词基础上追加人物禁词：
  `person, human, people, figure, character, silhouette, human body, face, hand, protagonist, character in scene, man, woman, boy, girl`

（现有 `extra people / bystander / crowd` 保留，二者叠加。）

### 改动 3：两处调用点传参

- [生成路径 :1197](src/lib/seedream.functions.ts#L1197)：`buildShotNegative(data.characterImageUrls.length > 0)`
- [重生路径 :1546](src/lib/seedream.functions.ts#L1546)：`buildShotNegative(data.characterImageUrls.length > 0)`

重生路径 `buildRegenShotInstruction` 已较好处理无角色（第 3 条「本镜头没有角色参考,只改场景/构图」），但 negative 共用，参数化后无角色重生也会加上人物禁词，一并受益。

## 不在本次范围（可选延伸，待确认）

`generateStoryboardFromPlot` 的 systemPrompt（[storyboard.functions.ts:128-214](src/lib/storyboard.functions.ts#L128-L214)）强制 plotText 扩写「人物状态/动作/台词/承接」5 要素，对纯风景剧情会诱导 AI 给空镜编造人物和 action。本次用户是手动给定纯风景剧情、且 characterIds 已为空，故非本次直接根因。是否要顺带加一条「原剧本某段无人物时 → characterIds 必须为 []、plotText 不编造人物」的空镜规则，等你定。

## 验证

1. `bun run lint` 通过
2. 手动：纯风景剧情 + 1 张场景图 + 0 角色图 → 生成分镜图无人物
3. 回归：带角色图的镜头生成正常（角色脸锁定不回归）
