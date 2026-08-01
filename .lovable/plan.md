## 范围

只修复第二个问题：用户在图片生成错误后提出指正，重新生成仍产出同样的图。第一个问题（提示词被误操作修改）按你的意见不做改动。

## 已确认的根因

1. `restylePrompt.ts:73-75`：`resolveAssetImagePrompt()` 一旦发现 `promptOverride`，直接返回覆盖内容并 **完全丢弃本轮的用户指正**。第一个问题正是由手工覆盖引起，于是后续所有指正都被这条分支吞掉，重生成必然产出同一张图。
2. `restylePrompt.ts:53`：即使没有覆盖，指正也只是作为 `【本次补充要求】` 追加在提示词最末尾，排在错误的 `目标设定` 之后，优先级不足以纠正已经跑偏的画面。
3. `RestyleStudio.tsx:3162-3164`：画布重生成通过 `attachment.name.includes(asset.targetName)` 按名称定位资产，改名或同名时会选错资产，指正落到别的资产上。
4. `RestyleStudio.tsx:2710-2715`：纠错类语句（“场景图片生成不对，请重新生成”）依赖 `/修改|调整|请将|变得|改成|换成/` 匹配，“不对”“重新生成”不在其中，消息可能根本没进入生图分支，只回一句“已理解…”。

## 修复方案

### 1. 本轮指正永不被覆盖提示词吞掉
`src/components/restyle/restylePrompt.ts`：
- `resolveAssetImagePrompt` 在存在 `promptOverride` 时，仍把本轮有效指正拼到覆盖提示词之前，并标注为最高优先级；无指正时行为不变。
- `buildAssetImagePrompt` 把 `【本次修正要求·优先级最高】` 移到提示词最前面，明确声明与后面的目标设定冲突时以本条为准。

### 2. 识别纠错意图
`src/components/restyle/restyleIntent.ts` 新增 `isRegenerateIntent()`，覆盖“不对/不正确/错了/重新生成/重画/再生成一张/换一张”等表述；`RestyleStudio.tsx` 的 `isAssetImageRequest` 判定接入该函数，保证纠错消息进入生图分支。

### 3. 精确定位被指正的资产
`RestyleStudio.tsx`：
- 画布重生成优先用 `attachment.sourceAssetId` 定位资产，名称匹配仅作旧数据兼容降级。
- 对话内纠错时，若消息含“场景/角色/道具”或某个资产名，只重生成对应资产，不整表重跑。

### 4. 提示词面板给出被覆盖的明确提示
`RestyleProcessPanel.tsx` 在已有的「已手工覆盖」标签旁补一行说明：当前提示词为手工覆盖，本轮对话指正会叠加在其之前，可点“重置”回到自动拼装。避免再次出现“改了没反应”的困惑。

### 5. 回归测试
扩充 `src/components/restyle/__tests__/restylePrompt.test.ts` 并新增 intent 用例：
- 存在 `promptOverride` 时，本轮指正仍出现在最终提示词中且位于覆盖内容之前。
- 无指正时覆盖内容保持原样返回。
- 指正段落排在目标设定之前。
- “场景图片生成不对，请重新生成”被识别为重生成意图，“确认/继续”不被识别。
