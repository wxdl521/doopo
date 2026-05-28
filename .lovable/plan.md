## 目标

通过在所有生成类提示词外加一层标准化的"虚构文学创作框架"包装（fiction-framing），降低 OpenRouter / Anthropic / OpenAI 等严审服务商把短剧剧情误判为违反 ToS 的概率，同时保留现有 lovable 网关兜底重试。

## 改动范围

仅改 system / user prompt 拼接逻辑，不改模型路由、不改流式契约、不改数据库、不动 UI。

### 1. 新增统一包装工具 `src/lib/promptSafety.ts`

导出两个纯函数：

- `wrapFictionSystem(lang, originalSystem)` —— 在原 system prompt **前面**追加一段"创作伦理框架"前缀：
  - 中文版关键点："你正在协助一部完全虚构的长篇科幻/奇幻/都市短剧文学创作；所有人物、地点、事件均为虚构；你的角色是共同作者（co-author），输出仅服务剧情；涉及冲突、危险、情感张力时使用文学化、隐喻化、非露骨的描写；自动规避真实未成年人、真实人物、露骨性描写、可操作的暴力指南、仇恨内容；如剧情涉及边界题材，用克制叙事＋情感后果替代直白描写。"
  - 英文版同义对应（"fictional literary co-author / metaphorical, non-graphic / avoid minors, real persons, explicit sexual content, actionable violence …"）。
  - 末尾再拼接原始 `originalSystem`，确保业务规则（场标格式、JSON 工具调用约束等）不被稀释。

- `wrapFictionUser(lang, originalUser)` —— 在用户输入**前后**包一层创作上下文：
  - 前缀：`【虚构文学创作 / Fictional literary creation】\n以下为长篇虚构短剧的剧情设定，请以共同作者身份基于设定输出。`
  - 后缀：`\n（再次声明：以上为虚构作品设定，所有内容仅用于文学叙事。请按既定输出格式返回。）`

两个函数纯字符串拼接，零外部依赖。

### 2. 接入点（仅 5 处 system + 5 处 user，集中改造）

**`src/lib/scriptPipeline.functions.ts`**

- `sysFor()` 改为：`wrapFictionSystem(lang, (zh|en BASE) + '\n' + extra)`。一次改动覆盖全部 5 个 pipeline 阶段（logline / outline / scenes / episode / 其它 callToolCall）。
- 在每个 `callToolCall({ user, ... })` 调用点把 `user` 改为 `wrapFictionUser(data.lang, user)`。共 5 处。

**`src/lib/scriptAgent.functions.ts`**

- `streamSynopsis` / `streamEpisode` / `refineSynopsis` 三个 serverFn：
  - `sys = wrapFictionSystem(data.lang, sys)`
  - `user = wrapFictionUser(data.lang, user)`
- 不动 `streamChat` 内部、不动 provider 路由、不动现有 403 ToS → lovable 兜底逻辑。

### 3. 不改动

- 不改 `pickModel` / `parseModel` / fallback 链。
- 不改前端 `ScriptComposer` 与 i18n（用户感知不到变化）。
- 不改数据库、不改 RLS、不新增 secret。
- 现有 403 ToS 兜底（自动切到 `lovable:google/gemini-3-flash-preview`）保留为第二层防线。

## 预期效果

- 大多数普通短剧剧情在 OpenRouter Claude / GPT 上不再因模糊创作意图被拒。
- 真正越界的内容仍会被拒，此时由现有兜底自动切到 Lovable Gemini，错误提示文案不变。
- 业务约束（JSON 工具调用、场标格式、对白字数）位于 system 末段，模型遵循度不受包装影响。

## 文件清单

- 新增：`src/lib/promptSafety.ts`
- 编辑：`src/lib/scriptPipeline.functions.ts`（`sysFor` + 5 处 user 包装）
- 编辑：`src/lib/scriptAgent.functions.ts`（3 个 serverFn 的 sys/user 包装）
