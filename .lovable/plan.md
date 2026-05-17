## 现状问题

- `/scripts` 一次性把 `system + user prompt` 丢给模型，返回单段纯文本，没有结构。
- 提示词过于简单（仅一句"你是一位专业剧本写作师"），缺少短剧节奏/场次格式/对白规范约束 → 输出质量差且不稳定。
- 优化按钮只是把整段重写一遍，无法针对某场、某段做局部调整。
- 详情页 `/scripts/:id` 只读 `mockScripts`，新生成的剧本无法在详情页查看。
- workspace 已有 `generateStageAi`（结构化 logline / acts / scenes / characters），但 `/scripts` 没复用，两套流程割裂。
- 没有节奏/冲突等质量信号；没有角色卡；没有分场重写。

## 目标

把 `/scripts` 改成 **结构化分步创作工作台**：灵感 → 三幕大纲 → 分场（含动作 / beats / 对白） → 角色卡，每一步都可预览、编辑、单步重生。生成结果直接进详情页并可一键带入 workspace。

## 流程设计

```text
[Step 1 灵感]            [Step 2 大纲]          [Step 3 分场]          [Step 4 角色 & 质量]
  类型/题材/风格    →     logline               →   N 场                 →  3-5 个角色卡
  主题 + 概要             三幕 × 3-5 beats          slug/动作/beats/对白    节奏分 / 冲突分
  模型选择                [重生] [编辑]              [单场重写] [插入]       [保存到剧本库]
                                                                                ↓
                                                                       /scripts/:id 详情页
                                                                       [带入工作台]
```

进度条 + Stepper 顶部展示当前阶段；上一步、下一步、保存草稿。

## 技术方案

### 服务端：保留 OpenRouter，新增结构化函数

新增 `src/lib/scriptPipeline.functions.ts`，导出 4 个 `createServerFn`，全部基于现有 `OPENROUTER_API_KEY` + tool calling（OpenRouter 兼容 OpenAI function-calling）：

- `genLogline({ type, genre, tone, theme, plot, lang, model })` → `{ logline, premise, themes[] }`
- `genOutline({ logline, type, genre, tone, lang, model })` → `{ acts: [{title, beats[]}] × 3 }`
- `genScenes({ logline, acts, type, lang, episodeCount, model })` → `{ scenes: [{ index, slug, location, timeOfDay, action, beats[], dialogue[{role,line,parenthetical?}] }] }`
- `genCharacters({ logline, scenes, lang, model })` → `{ characters: [{ name, role, roleLabel, age, look, personality, motivation, palette[] }] }`
- 另加 `rewriteScene({ scene, instruction, lang, model })` → 单场重写
- 另加 `scoreScript({ scenes })` → `{ pacingScore, conflictScore, dialogueDensity, suggestions[] }`（同样走 tool call）

实现要点：
- 复用 `generateScript` 的多模型 fallback / 超时 / 429-402 错误码处理。
- 每步用严格 JSON schema + `tool_choice` 强制结构化输出；模型若返回空则 fallback。
- system prompt 按语言（zh/en）切换；中文短剧 system 强化「场标 INT./EXT. 中文 - 时间」「对白 ≤30 字」「每场至少一个冲突 beat」等规范。
- prompt 内嵌前序结果（logline → acts → scenes）做 chain-of-thought 引导，避免"重新构思"。

### 客户端：重构 `src/pages/Scripts.tsx`

拆分为：
- `ScriptComposer.tsx`（左侧表单 + Stepper）
- `steps/LoglineStep.tsx`
- `steps/OutlineStep.tsx`（acts/beats 可编辑列表）
- `steps/ScenesStep.tsx`（折叠卡片：场标 + 动作 + 对白；每张卡有「重写本场」「插入新场」「删除」）
- `steps/CharactersStep.tsx`（角色卡 + 调色板）
- `ScriptQualityBadge.tsx`（节奏/冲突/对白密度 chips）

状态机：`'logline' | 'outline' | 'scenes' | 'characters' | 'done'`，每步生成后可编辑；草稿持久化到 `localStorage('doopoo_script_drafts')`，完成后写入 `doopoo_scripts`，结构对齐 `ScriptItem`（scenes / dialogue / versions）。

### 详情页打通

- `src/routes/scripts.$scriptId.tsx` 的 loader 改为：先查 `localStorage('doopoo_scripts')`（structured），再回退 `mockScripts`。
- 详情页头部新增「带入工作台」按钮 → `navigate('/workspace/new', { state: { fromScript: id } })`，workspace 接收后预填 acts/scenes/characters。
- 顶部新增「质量评分」面板（pacing / conflict / dialogue density + 改进建议）。

### 列表页

`scripts` 库改为卡片网格（封面取首场 action 摘要 + 角色调色板渐变），保留复制/导出/删除/优化；点击卡片进入详情页。

### i18n 新增 key

`script_step_logline / outline / scenes / characters / quality_pacing / quality_conflict / scene_rewrite / scene_insert / use_in_workspace / quality_suggestions` 等（zh + en）。

### 质量增强细节

1. 中文短剧专用 system prompt 模板（在 `scriptPipeline.functions.ts` 内常量化）：
   - 场次格式硬约束
   - 强制每场 ≥1 冲突 beat
   - 对白节奏：单句 ≤30 字，避免说教
   - 角色名稳定（生成 scenes 时复用 characters 列表）
2. 模型温度按步骤分档：logline 0.9，outline 0.8，scenes 0.75，rewrite 0.7。
3. 单场重写支持指令（更紧张 / 更幽默 / 增加冲突 / 压缩字数）。
4. 评分仅做本地启发式 + 一次 LLM 复核，避免每改一处都调用。

## 文件改动概览

新增：
- `src/lib/scriptPipeline.functions.ts`
- `src/components/scripts/ScriptComposer.tsx`
- `src/components/scripts/steps/{Logline,Outline,Scenes,Characters}Step.tsx`
- `src/components/scripts/ScriptQualityBadge.tsx`
- `src/lib/scriptStorage.ts`（structured 草稿 + 已保存剧本 IO）

修改：
- `src/pages/Scripts.tsx`（替换为 Composer + 卡片列表）
- `src/routes/scripts.$scriptId.tsx`（loader 优先读 localStorage，新增质量面板与"带入工作台"）
- `src/i18n/zh.ts` + `src/i18n/en.ts`（新增 key）

不动：
- `src/lib/openrouter.functions.ts`（保留向后兼容）
- `src/lib/exportScript.ts`（继续导出，新结构序列化为 fountain-like 文本）

## 不在本次范围

- 不接 Supabase，仍走 localStorage（保持当前架构）。
- 不切换到 Lovable AI（用户明确保留 OpenRouter 多模型）。
- 不做协同/版本 diff，仅保留 versions 数组占位。
