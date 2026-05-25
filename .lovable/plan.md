## 目标

把"剧本生成"改成两阶段：先产出**可编辑的故事梗概（提示词）**，让用户手动改 / 通过 AI 对话改；用户满意点"确认并生成剧本"后，再把这份最终梗概作为权威 prompt 交给后端 agent 生成正式剧本（分镜/多剧集）。

## 交互设计（ScriptComposer）

阶段流程（替换现有 `setup → synopsis → episode → episodes → done`）：

```text
① 灵感(setup) → ② 梗概草稿(draft) → ③ 梗概精修(refine) → ④ 分镜(episode) → ⑤ 多剧集(episodes) → ⑥ 完成(done)
```

### 阶段 ② 梗概草稿
- 用户填完灵感点"生成梗概"，复用现有 `streamSynopsis` 流式产出，结果落到一个**可编辑面板**而不是只读气泡。
- 流式结束后，UI 切换为左右双栏 / 上下双区：
  - **左：梗概编辑器**（`<textarea>` + Markdown 预览切换按钮，monospace 字体，行号可选）。内容初始 = AI 输出，用户可任意改写。
  - **右：精修对话面板**（聊天气泡 + 输入框）。

### 阶段 ③ 梗概精修
三种修改方式同屏可用：

1. **手动直接编辑**：textarea 实时受控；底部显示"已修改 / 字数 / 上次保存于…"。
2. **AI 对话修改**：用户在右侧输入"把主角改成女性 / 加一个第 5 集反转 / 缩短到 6 集"等指令，调用新 serverFn `refineSynopsis`，把当前编辑器内容 + 用户指令 + 历史对话喂给模型，**流式输出整份新梗概**，完成后弹出"采纳新版本 / 保留当前 / 对比 diff"三个操作。
3. **重新生成**：保留按钮，整段废弃重来（清空编辑器，跑 `streamSynopsis`）。

辅助能力：
- **版本历史**：每次"采纳 AI 改写"或手动停顿 10s 自动 snapshot；侧边小抽屉显示版本列表，支持一键回滚和两版 diff（用 `diff` 库渲染行内 +/-）。
- **快捷指令 chips**："更紧凑"、"加大反转"、"主角更年轻"、"减少集数"——点击即填入对话框。
- **撤销/重做**：Ctrl+Z / Ctrl+Y 走编辑器本地栈。
- **保存草稿**：随时调 `upsertScriptAndCloud`，把当前梗概写到 `scripts.payload.synopsisDraft`，下次进入恢复。

确认按钮：**"✅ 确认梗概，开始生成剧本"**——禁用条件：编辑器为空 / 字数 < 200。点击后梗概锁定，进入 ④。

### 阶段 ④/⑤/⑥
保持现有"第 1 集分镜 → 自动连跑多集 → 保存"流程，但 `synopsisText` 改用**用户最终确认的版本**而不是首版 AI 输出。锁定后若想再改梗概，必须显式点"返回精修"，会提示"已生成 N 集，继续修改会废弃已生成集吗？"。

## 后端处理逻辑

### 新增 serverFn：`refineSynopsis`（`src/lib/scriptAgent.functions.ts`）

```text
input: {
  lang, model,
  currentSynopsis: string,            // 编辑器当前内容（用户改过的版本）
  instruction: string,                // 本次用户指令
  history: Array<{role, content}>,    // 最近 6~8 轮精修对话，用于上下文连续
}
output: AsyncGenerator<StreamChunk>   // 同现有 streamChat，流式 yield delta + done
```

实现：
- 复用现有 `streamChat` 流式管道。
- 新 system prompt（中英双版）核心约束：
  - 必须输出"完整的新版梗概全文"，不可只输出 diff/补丁；
  - 必须严格保留 `SYS_SYNOPSIS_ZH` 中的 6 大段标题骨架；
  - 只针对用户指令做最小必要改动，其他段落保留原文；
  - 不写解释、不写"以下是修改后…"前言。
- user message 组合：`【当前梗概】\n<currentSynopsis>\n\n【用户修改要求】\n<instruction>\n\n【对话历史】\n<history 折叠>`。
- 失败/限流复用现有 `rate_limit / no_credits / 网关错误` 错误码。

### `scriptStorage` 字段扩展

`SavedScript` 增加可选字段：
- `synopsisDraft?: string` — 未确认前的草稿
- `synopsisLocked?: boolean` — 是否已确认进入分镜阶段
- `synopsisVersions?: Array<{ id, text, source: 'ai-init'|'ai-refine'|'manual', createdAt }>` — 版本历史（上限 20 条，超出按时间裁剪）
- `refineHistory?: Array<{ role: 'user'|'agent', text, createdAt }>` — 精修对话记录

只改本地与 `payload` JSON，**不需要数据库迁移**（`scripts.payload` 已是 jsonb）。

### 流式契约

`refineSynopsis` 输出契约与现有 `streamSynopsis` 完全一致（`{delta} / {done,text} / {error}`），前端复用现成的 `consume()` 打字机渲染逻辑。

## 文件改动清单

- `src/lib/scriptAgent.functions.ts` — 新增 `refineSynopsis` serverFn + 中英 system prompt。
- `src/components/scripts/ScriptComposer.tsx` — 新增 draft/refine 阶段；新增 `<SynopsisEditor>` 子组件（textarea + 预览切换 + 版本抽屉 + diff）；新增右侧 `<RefinePanel>` 聊天面板与快捷 chips；改阶段机；锁定逻辑。
- `src/lib/scriptStorage.ts` — `SavedScript` 类型新增上述可选字段；`upsert` 时透传。
- `src/i18n/zh.ts` + `src/i18n/en.ts` — 新阶段标签、按钮文案、提示语。
- 依赖：`bun add diff @types/diff` 用于版本 diff 渲染。

## 不动的内容

- 不改数据库 schema、RLS、`scripts` 表结构。
- 不改 `scriptPipeline.functions.ts`（结构化 logline/outline/scenes 链路）和 `streamEpisodeScenes`。
- 不改首页 Hero 入口与预填逻辑。
- 不改鉴权与现有错误处理范式。
