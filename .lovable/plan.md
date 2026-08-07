# 修复：转绘对话「答非所问」——用户指令被既定流程抢跑

## 现象

用户回复「继续生成资产图片」（生图渠道失败后想重试生图），系统却直接开始「生成转绘方案 第 1/5 窗」，完全没做生图。

## 已确认的根因

`RestyleStudio.tsx` 的对话路由中，确认类分支排在所有具体意图分支之前：

- `isConfirmIntent()` 的模式里有一条裸的 `/继续/`，「继续生成资产图片」直接被判成「确认，进入下一步」。
- 此前已有 1 张场景图生成成功（`generatedAssetFiles.length > 0`），「先补生图」的分支不成立，于是落到 `runPlanGeneration()` —— 出方案。
- 生图请求分支（`isAssetImageRequest`）排在这些确认分支之后，永远轮不到。

同类隐患（同一处优先级设计导致）：

1. 项目正在跑任务时，`sendChatMessageInner` 开头 `if (isProjectRunning(...)) return;` 静默丢弃用户这条消息——用户看不到任何回应，观感就是「系统不理我」。
2. 「继续」+ 明确对象的说法（如「继续重新分析原片」「继续出片」）同样有被确认分支抢走的风险，目前只是被否定词规则偶然挡住。

## 修复方案

### 1. 收紧确认意图（`restyleIntent.ts`）

- 裸 `/继续/`、`/下一步/` 只在没有点名具体动作对象时才算确认。
- 新增排除：文本命中「资产图 / 生图 / 图片」「分析 / 提取 / 原片」「视频 / 出片 / 片段」等具体对象时，`isConfirmIntent` 返回 false，交给对应分支。
- 新增 `isAssetImageIntent(message)`：统一判定「生成 / 补齐 / 重试 资产图片、生图、某角色/场景/道具的图」。

### 2. 调整对话路由优先级（`RestyleStudio.tsx`）

新顺序（具体意图优先，泛化确认兜底）：

```text
文件指令 → 视频出片意图 → 片段/整集返工 → 重分析 → 重做方案
        → 资产生图意图（新，含「继续生成资产图片」）
        → 方案微调（U01/提示词…）
        → 泛化确认（推进下一步）
        → 兜底解释
```

生图分支复用现有 `generateAssetImages()`，仍支持按资产名 / 按类型（角色 / 场景 / 道具）过滤，未点名则整表补齐。

### 3. 忙时不再吞消息

`isProjectRunning` 时不再直接 `return`，而是把用户消息照常上屏，并回一条明确说明：当前正在执行的步骤 +「可点击『停止』后重发，或等本步完成」。已有的返工排队机制保持不变。

### 4. 回归测试

在 `src/components/restyle/__tests__/restyleIntent.test.ts` 补：

- 「继续生成资产图片」「继续补齐资产图」→ 生图意图 true、确认意图 false；
- 「继续下一步」「确认」「可以了」→ 仍为确认；
- 「继续重新分析原片」→ 重分析；「继续生成视频」→ 出片。

## 涉及文件

- `src/components/restyle/restyleIntent.ts`
- `src/components/restyle/RestyleStudio.tsx`
- `src/components/restyle/__tests__/restyleIntent.test.ts`