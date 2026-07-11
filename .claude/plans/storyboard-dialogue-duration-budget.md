# 优化：AI 切分分镜时保证每组台词能在视频时长内说完

## 问题复现

- AI 切分一集剧情 -> 若干 `StoryboardGroup`，每组 = 一段 ≤10s 的视频。
- 每个 group 的 `plotText` 是详细散文扩写，**完整引用了该段所有台词**（带引号）。
- 视频生成时，prompt 里塞进 `effectiveShotBreakdown(group)`（= 镜头分解 + plotText 含台词），视频时长 = `groupVideoDurationSec(group)`（组内 shot 时长之和，夹在 [5,10]s）。`project.audio === "on"` 时视频模型要把这些台词**说出来**。
- **Bug**：切分 prompt 只按「剧情节奏 ~10s」切组，**完全没约束台词密度**。于是台词密集的对话段被塞进 10s（甚至更短）的视频 -> 视频模型要么**漏台词**，要么**语序/发音乱**抢词。

## 根因

[src/lib/storyboard.functions.ts](src/lib/storyboard.functions.ts) 的 `generateStoryboardFromPlot` 切分 prompt（systemPrompt / userPrompt）只约束：

- 整组 ≤10s、组内 1~3 个 shot、每个 shot 2~5s
- 剧情覆盖完整性

**缺失**：没有任何「台词可说完性」约束。组时长由剧情节奏决定，与该组台词字数无关。台词多了，shot 时长之和不足以说完 -> 视频时长不够 -> 漏/乱。

## 修复策略（用户已确认：4 字/秒预算 + 两层兜底）

核心思路：**台词驱动组时长**。每组的 spoken 台词字数 × 0.25s 必须 ≤ 该组视频时长（≤10s）；超 10s 的台词段必须拆成多组。

中文语速：4 字/秒（正常稍快、含句间停顿、能清楚说完）。即每字 ≈ 0.25 秒。10s 组 ≈ 40 字台词上限。

---

## 改动 1（核心）：切分 prompt 加「台词可说完性」约束

**文件**：[src/lib/storyboard.functions.ts](src/lib/storyboard.functions.ts)

### 1a. systemPrompt 加一条最高优先级规则

在现有【第 0 条 -- 剧情覆盖完整性】之后，新增【第 0.5 条 -- 台词可说完性（与覆盖完整性同级，压倒其余）】：

```
═══════════════════════════════════════════════════════════
【第 0.5 条 -- 台词可说完性(最高优先级,与第 0 条同级)】
═══════════════════════════════════════════════════════════
每个分镜组 = 一段 ≤10s 的视频,视频里要把该组台词**说出来**(配音)。
中文 spoken 台词约 4 字/秒(正常稍快、含句间停顿、能清楚说完),即每字 ≈ 0.25 秒。

硬性预算(必须满足):
  每个分镜组的「spoken 台词总字数」× 0.25 秒  ≤  组内所有 shot 时长之和(= 该组视频时长)  ≤  10 秒

统计口径:
- 只统计**说出口的字**:引号「」『』""'' 内的内容
- **不统计**:角色名标签(如 "陆深:")、动作描写、心理、旁白叙述、标点(，。！？…)
- 标点和句间停顿的余量已包含在 4 字/秒里,不要再额外加

由此推出拆组规则:
- **台词驱动组时长**:先算该段台词说完需要几秒(N字×0.25),再据此分配 shot 时长,
  使组内 shot 时长之和 ≥ 台词所需时长(且 ≤10s)。不要先定 10s 再硬塞台词。
- **若一段剧情的台词在 10s 内说不完 -> 必须切成多个分镜组**,每组台词各自能在 ≤10s 内说完。
  台词密集的对话段要拆得更细(组数由台词密度决定,不再只按 ~10s 切)。
- **不要在一句台词中间切组**:单句台词必须完整落在同一组,不能把一句话劈成两半分到两个组。
- 反向:一句短台词不要单独成组,跟相邻动作/反应合到同一组(组时长仍受台词预算约束)。
- 空镜组(无台词)不受台词预算约束,按原 ~10s 节奏切即可(台词字数=0,预算=0)。
```

### 1b. systemPrompt 的【其他】/ 自检段同步更新

- 【分镜组与 shot 数】那条补一句：「组时长由**台词说完所需时长**驱动(台词多的组 shot 时长之和要够说完台词,≤10s);台词超 10s 的段必须拆多组。」
- 【其他】第 4 条时间规则补一句：「**组内 shot 时长之和 ≥ 该组 spoken 台词字数 × 0.25s**(够说完台词),且 ≤10s。」
- 把「组数 ≈ 整集时长 / 10」改成「组数由剧情节奏**与台词密度共同**决定;台词密集处多拆组。」

### 1c. userPrompt 的「输出前强制自检」加台词预算检查

在现有逐段覆盖自检后，加一段每组台词预算自检：

```
===== 输出前强制自检(续):台词可说完性 =====
对每个分镜组,数一下 plotText 里引号内说出口的台词字数 N,算 N×0.25 秒:
  组[0]: 台词 N=__ 字,需 __s,组时长 __s(shot 之和) -> 够说完吗? ✓/✗
  组[1]: 台词 N=__ 字,需 __s,组时长 __s -> ✓/✗
  ...(每组都要查)
  组[N-1]: ...
任何一组 ✗(台词说不完)-> 必须拆成更多组,直到每组台词都能在 ≤10s 内说完。
单句台词不能被拆到两个组。
```

### 1d. userPrompt 的 JSON Schema 示例 + 注意事项补一句

- 注意事项加：「- **台词可说完性**:每组引号内 spoken 台词字数 × 0.25s ≤ 组内 shot 时长之和(≤10s);超了就拆组。台词多的对话段拆细,不要硬塞进一组。」

---

## 改动 2（兜底层 1）：新增共享 util `estimateDialogueSpeechSec`

**新文件**：`src/lib/dialogueDuration.ts`（纯函数，server + client 共用，无副作用）

```ts
/** 中文 spoken 台词语速(字/秒):正常稍快、含句间停顿、能清楚说完。 */
export const SPEECH_RATE_CPS = 4;

/**
 * 从剧情文本里提取说出口的台词:拼接所有引号对内的内容。
 * 支持中文引号 「」『』""'' 与 ASCII " '。引号外的角色名标签/动作/心理/旁白不计。
 */
export function extractDialogue(text: string): string;

/**
 * 统计「说出口的字数」:CJK 表意字 + 拉丁字母/数字。
 * 排除标点、空白、speaker 标签。这是真正要被念出来的字符量。
 */
export function countSpeakableChars(text: string): number;

/**
 * 估算把 plotText 里的台词用正常稍快语速说完需要多少秒(向上取整,最小 0)。
 * sec = ceil(countSpeakableChars(extractDialogue(plotText)) / SPEECH_RATE_CPS)
 */
export function estimateDialogueSpeechSec(text: string, rateCps?: number): number;
```

实现要点：
- `extractDialogue`：用状态机扫引号对（「」『』""''配对开闭；ASCII `"` 按出现次数成对开闭，`'` 同理），拼出所有引号内片段。
- `countSpeakableChars`：Unicode 范围 `[一-鿿㐀-䶿]`（CJK）+ `[A-Za-z0-9]`，其余不计。
- 加 Vitest 单测覆盖：无台词、纯空镜、多句对话、带角色名标签、中英混排、嵌套引号。

---

## 改动 3（兜底层 1）：`groupVideoDurationSec` 按台词字数兜底拉长

**文件**：[src/routes/workspace.$workspaceId.tsx](src/routes/workspace.$workspaceId.tsx) 的 `groupVideoDurationSec`（[:4732](src/routes/workspace.$workspaceId.tsx#L4732)）

现状：`dur = clamp(round(shotSum or groupSpan), 5, 10)`。

改造：算完 `dur` 后，用**实际发给视频模型的台词文本**（`effectiveShotBreakdown(group)`，已含用户编辑）估台词所需时长，向上兜底：

```ts
function groupVideoDurationSec(group: StoryboardGroup): number {
  // ... 原 shotSum/span 逻辑不变 ...
  let dur = Math.min(10, Math.max(5, Math.round(span)));

  // 2026/07 兜底:视频时长至少要够说完台词(≤10s)。LLM 切分时可能 shot 时长偏短
  // 但塞了较多台词,这里按台词字数兜底拉长(只向上、不超 10s 上限,不缩短)。
  // 实际发给视频模型的台词在 effectiveShotBreakdown(group) 里(含用户编辑),按它估。
  const dialogueSec = estimateDialogueSpeechSec(effectiveShotBreakdown(group));
  if (dialogueSec > 0) {
    const need = Math.min(10, dialogueSec + 0.5); // +0.5s 收尾余量,封顶 10
    if (need > dur) dur = need;
  }
  return dur;
}
```

**性质**：只在 `[5,10]` 内向上拉长，绝不缩短、绝不超 10。台词 ≤10s 的组一定能分到够说的时长；台词 >10s 的组封顶 10s（无法兜底，由改动 4 的警告提示用户拆组）。

注意：`effectiveShotBreakdown` 在 [:4033](src/routes/workspace.$workspaceId.tsx#L4033) 已定义（早于 `groupVideoDurationSec`），可直接调用。

---

## 改动 4（兜底层 2）：超 10s 的组打警告标记 + UI 徽标

### 4a. `normalizeGroup` 算 `dialogueOverloadSec`（server 端，切分时即标记）

**文件**：[src/lib/storyboard.functions.ts](src/lib/storyboard.functions.ts) 的 `normalizeGroup`（[:610](src/lib/storyboard.functions.ts#L610)）

```ts
const estDialogueSec = estimateDialogueSpeechSec(plotText);
const dialogueOverloadSec = Math.max(0, estDialogueSec - 10); // 超 10s 硬上限的部分,无法靠拉长兜底
// 返回对象里加:
//   estDialogueSec,
//   dialogueOverloadSec,
```

返回类型 + `StoryboardGroup` 类型（[src/data/workspaceGenerators.ts:224](src/data/workspaceGenerators.ts#L224)）加两个可选字段：

```ts
/** 2026/07:该组 spoken 台词估算说完秒数(4字/秒)。用于台词可说完性兜底/警告。 */
estDialogueSec?: number;
/** 2026/07:台词超出单视频 10s 硬上限的秒数(>0 表示该组台词一个视频说不完,需拆组/精简)。 */
dialogueOverloadSec?: number;
```

> `normalizeGroup` 返回的对象会在 workspace route 的 streaming append / 整体解析两条路径里落到 `StoryboardGroup`（[:3938](src/routes/workspace.$workspaceId.tsx#L3938) 附近的 `enriched`）。字段是可选的，老数据/无台词组不带也安全。

### 4b. UI 警告徽标

**文件**：[src/routes/workspace.$workspaceId.tsx](src/routes/workspace.$workspaceId.tsx) 分镜组 header chip 行（[:9453-9457](src/routes/workspace.$workspaceId.tsx#L9453) 时间区间 chip 后面）

当 `g.dialogueOverloadSec > 0` 时，插一个琥珀色警告 chip：

```tsx
{g.dialogueOverloadSec && g.dialogueOverloadSec > 0 && (
  <span className="px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/40 text-amber-600 dark:text-amber-400" title={t("workspace.storyboard.dialogueOverloadHint")}>
    ⚠ {t("workspace.storyboard.dialogueOverload", { sec: Math.ceil(g.dialogueOverloadSec) })}
  </span>
)}
```

文案（zh.ts / en.ts 同步加）：
- `workspace.storyboard.dialogueOverload`：zh `台词超长约 {{sec}}s，建议拆组或精简` / en `Dialogue ~{{sec}}s over, split or trim`
- `workspace.storyboard.dialogueOverloadHint`：zh `该组台词在单个视频(≤10s)内说不完，生成的视频可能漏台词或语序混乱。请拆成更多分镜组，或精简台词。` / en 同义

---

## 改动 5：i18n 同步

**文件**：[src/i18n/zh.ts](src/i18n/zh.ts) + [src/i18n/en.ts](src/i18n/en.ts)

加上述两个键（`workspace.storyboard.dialogueOverload` / `dialogueOverloadHint`），两文件同步。

---

## 改动 6：单测

**文件**：`src/lib/__tests__/dialogueDuration.test.ts`（Vitest）

覆盖 `extractDialogue` / `countSpeakableChars` / `estimateDialogueSpeechSec`：
- 空字符串 / 纯空镜（无引号）-> 0
- 单句 `陆深:「我没事。」` -> 只算「我没事」4 字 -> 1s
- 多句带角色名标签 + 动作描写 -> 只算引号内
- 中英混排 `Tom: "OK, 我来"` -> 算 `OK我来`(含字母) 
- 嵌套/未闭合引号不崩溃

---

## 影响面与风险

- **改 prompt**：切分会按台词密度多拆组，台词密集集的组数会变多（更多视频、更多积分）。这是预期行为，正是修复目标。空镜/动作戏不受影响。
- **`groupVideoDurationSec` 兜底拉长**：仅在 [5,10] 内向上拉，不缩短不超 10；最坏情况某些组视频从 5s 变 10s（积分按 duration 比例扣，成本略增但台词能说完，可接受）。
- **新字段 `estDialogueSec` / `dialogueOverloadSec`**：可选字段，老数据不带，零破坏。
- **UI 徽标**：纯展示，无逻辑分支依赖。
- 不动视频生成后端、不动 DB、不动路由结构。

## 不做的事

- 不改视频后端（ARK/DashScope 等）调用逻辑。
- 不改 `groupVideoDurationSec` 之外的时长计算。
- 不做程序化「自动拆超载组」（plotText 拆分需 LLM 语义理解，字符串切分不可靠；交给切分 prompt + UI 警告提示用户）。
- 不改 shot 数量上限/下限规则。
