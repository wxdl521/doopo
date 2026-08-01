## 问题定位（已核实代码）

**问题 1：智能体只回“已理解…”，不推进（`src/components/restyle/RestyleStudio.tsx`）**

`sendChatMessage` 的意图分支非常严苛：

- 进入"生成方案"的条件是 `message === "确认"`（必须一字不差），或 `shouldContinueToPlan`（正则 `继续.*下一步|下一步|进入.*方案|生成.*方案`，且**必须已经有生成好的资产图片**）。
- 只要没命中，就落到第 2287 行的兜底分支，回一句"已理解：…"，什么都不做 —— 正是用户看到的现象。
- 拆解出角色/场景后，用户常说的"确认资产""可以了""开始转绘""继续"等都无法命中。
- 另外，`确认生成视频` 分支在最前面，若资产图还没生成，只会回"没有可用的转绘资产图"，用户无从判断下一步。

**问题 2：资产生图报 `[tokenflash gpt-image-2] 405 Upstream request failed`**

- 转绘默认图像模型取的是 `realImageModelOptions[0]`，当前列表首项即 `tokenflash/gpt-image-2`。
- `src/lib/tokenflash.functions.ts` 在带参考图时走 `POST /v1/images/edits`；上游返回 405（Method Not Allowed），说明该中转当前不支持 edits 端点。无参考图的 `/v1/images/generations` 不受影响。
- 现有代码只在 5xx/超时重试，405 直接失败，整批资产图全挂。

## 修复方案

### A. 对话意图路由（前端）

1. 提取 `isConfirmIntent(message)`：匹配 `确认`（含"确认资产/确认无误/都可以/没问题/OK"）、`继续`、`下一步`、`开始/生成 方案` 等口语说法；不再要求全等。
2. 生成方案分支改为：`isConfirmIntent && extractedAssets.length > 0`，去掉"必须已有资产图"的硬门槛；若此时还没有任何资产图，先自动进入资产生图（等价于"全部由 AI 生成"），完成后再提示确认进入方案。
3. `确认生成视频` 分支：当缺少资产图时，明确回复缺哪一类（角色/场景/道具）以及一句可直接复制的下一步指令，而不是笼统拒绝。
4. 兜底分支（2287 行）改为按 `stage` 给出**可点击/可复制的下一步动作**，并在 assets 阶段直接把"生成资产图"作为默认动作，避免死循环式回复。

### B. Tokenflash 405 兜底（服务端）

`src/lib/tokenflash.functions.ts`：

1. 当 `/v1/images/edits` 返回 405/404/501 时，自动降级为 `/v1/images/generations`，把参考图信息合并进 prompt（保留原有 I2I 语义描述），并在日志里记录 `fallback=generations`。
2. 降级仍失败时，返回可读中文错误："该中转不支持图生图（edits），请改用 Seedream 或 Azure gpt-image-2"。

### C. 转绘默认图像模型

`RestyleStudio.tsx` 的 `selectedImageModel` 默认改为显式的 Seedream（`doubao-seedream-5-0-260128`，若不在列表中再回退到列表首项），不再依赖列表顺序，避免默认落到不支持 I2I 的中转。

## 技术细节

- 仅改动 `src/components/restyle/RestyleStudio.tsx`（意图路由 + 默认模型）与 `src/lib/tokenflash.functions.ts`（端点降级）。
- 不改数据库、不改 RLS、不改积分逻辑。
- 意图判断抽成纯函数，便于补一条 Vitest 用例覆盖"确认资产""继续下一步""可以了"三种说法。

## 验证

1. 用 Playwright 打开 `/restyle`，构造已有 `extractedAssets` 的项目，依次输入"确认资产""继续下一步"，确认进入方案阶段而非"已理解…"。
2. 观察 dev-server 日志确认 tokenflash 405 时出现 `fallback=generations` 且返回图片，或返回明确的中文提示。
