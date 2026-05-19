# 剧本生成流程升级方案

## 1. 新流程（5 步 + 对话式确认）

```
① 灵感(Setup)  →  ② 故事梗概/一句话剧情  →  ③ 分镜脚本(第1集)  →  ④ 角色卡  →  ⑤ 完成
```

每步在同一聊天面板内推进，AI 以**逐字流式**输出当前阶段内容，结束后给出"📋 同步确认信息清单"，用户回复"确认"或修改建议后才进入下一步。

## 2. 各步骤输出内容

**② 故事梗概**（首屏即给出深化框架，纯文本）
- 剧本基本信息（主标题 / 题材 / 爽点 / 受众 / 集数 / 基调）
- 故事大纲（一句话卖点 / 三句简介 起承转合 / 完整剧情大纲分段）
- 章节结构表（按集数范围、标题范例、核心事件、爽点反转、悬念，4 列）
- 人设档案（主角/反派/女配/男配：外貌/性格/金手指或可恨之处/经典台词）
- 末尾追问：第 1 集分镜数量？默认 15-20

**③ 分镜脚本**：第 1 集完整分镜（按用户确认数量），每个分镜含场标 + 动作 + 对白；同时输出"后续 2-10 集概要"；末尾追问"是否继续生成第 2 集 / 调整建议"。

**④ 角色卡**：复用 ② 的人设档案 → 升级为可视化角色卡（沿用现有 `PipelineCharacter` 字段 + 新增 mbti/关键道具/经典台词/关系）。

**⑤ 完成**：保存 `SavedScript`，提供按 Markdown 导出选项；UI 展示用纯文本。

## 3. 前端改造（`src/components/scripts/ScriptComposer.tsx`）

把 6 步分散面板 → **对话式工作台**：
- 左/上：步骤进度条（① 灵感 → ⑤ 完成）
- 主区：消息流（AI 流式气泡 + 用户确认气泡），AI 气況内按段渐进追加文本
- 底部：当前步骤的输入/确认条
  - ① 主题 + 剧情概要 + 类型/题材/风格/集数
  - ② "确认 / 重新生成 / 修改建议"
  - ③ 输入分镜数量 → "确认 / 重写第 N 镜 / 删除"
  - ④ "确认角色卡 / 重新生成"
  - ⑤ 保存 + 导出

**渲染规则**：聊天区按 `whitespace-pre-wrap` 纯文本展示（含 emoji/`#`/`*` 字符），不走 Markdown 渲染；只有"导出"按钮调用现有 `exportScript.ts` 输出 Markdown 文件。

## 4. 后端改造（新文件 + 替换现有 4 个 step fn）

### 4.1 新建流式服务器函数 `src/lib/scriptAgent.functions.ts`

采用 TanStack `createServerFn` + `async function*` 流式输出（参考 knowledge `tanstack-server-functions` 的 AI 流式段），直接 fetch Lovable AI Gateway `chat/completions` 并 `stream: true`，逐 token `yield { delta }`，结尾 `yield { done, structured }`。

导出：
- `streamSynopsis(input)` → 故事梗概（输出长文本 + 解析后的结构 JSON）
- `streamEpisodeScenes({ ep, sceneCount, context })` → 第 N 集分镜
- `streamCharacters({ context })` → 角色卡
- `streamRewriteScene({ scene, instruction, context })`（保留改写能力）

每个函数：
1. system prompt 指定**先用纯文本按指定章节标题逐段输出**，最后追加一行 `<<<JSON>>>` 后给出严格 JSON（便于客户端解析为可保存的结构化数据）。
2. 服务器一边把上游 SSE 切分一边 `yield { delta }`；解析到 `<<<JSON>>>` 后切到 `structuredBuf`；流结束 `JSON.parse(structuredBuf)` 并 `yield { done: true, data }`。
3. 出错走现有 `rate_limit` / `no_credits` 错误码。

### 4.2 默认模型
默认 `lovable:google/gemini-3-flash-preview`（最快），保留 OpenRouter 切换。

### 4.3 客户端消费
```ts
const stream = await streamSynopsis({ data: input });
for await (const chunk of stream) {
  if (chunk.delta) appendToBubble(chunk.delta);
  else if (chunk.done) setSynopsisData(chunk.data);
}
```

### 4.4 老函数处理
保留 `genLogline / genOutline / genScenes / genCharacters / rewriteScene`（旧 Scripts 详情页可能引用），但新 Composer 不再使用；若发现旧引用一并替换或保留只读。

## 5. 数据模型扩展（`src/lib/scriptStorage.ts`）

`SavedScript` 新增：
- `basicInfo`：{ subtitleType, hookCore, audience, expectedEpisodes, mood }
- `chapterTable`：Array<{ range, titles[], coreEvent, hook, suspense }>
- `episodes`：Array<{ epIndex, scenes: PipelineScene[], summary: string }>
- `nextEpisodesOutline`：Array<{ epIndex, summary }>

## 6. 任务拆分

1. 写 `scriptAgent.functions.ts`（streaming + 系统提示词 + JSON 解析）。
2. 重写 `ScriptComposer.tsx` 为对话式 5 步面板（流式追加 + 确认条）。
3. 扩展 `SavedScript` 与 `exportScript.ts`（按新结构导出 Markdown）。
4. 更新 `src/pages/Scripts.tsx`（标题/副标题文案对齐"剧本智能体"）。
5. 兼容：旧 `scripts.$scriptId.tsx` 详情页按可选字段渲染新区块。

## 7. 验证

- 手测：输入"天雷圣子"灵感 → 完成 5 步 → 重载后详情页展示完整结构。
- 流式：第一次响应 < 1.5s 出首字；中断网络给出错误并保留已输入内容。
- 导出：Markdown 内含基本信息表 + 章节结构表 + 第 1 集分镜 + 后续概要。

---
确认无误后，我将按此方案进入实现。如对**流式 UI 形态**（对话气泡 vs 单一文本卡片）或**首屏是否一次性给完整框架**有偏好，请告知。
