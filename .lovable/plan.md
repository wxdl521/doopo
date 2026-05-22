## 目标
首页 Hero 输入区新增「剧本生成」入口，未登录引导登录，登录后跳转剧本页并自动带入选项。

## 改动

### 1. `src/components/HeroPromptInput.tsx`
- 引入 `useAuth`、`useNavigate`、`FilmIcon`（lucide）。
- 工具栏新增「剧本生成」按钮（与现有 `btn-ghost` 风格一致），点击展开一个浮层小面板（绝对定位，点击外部关闭）。
- 面板内三组 chip 选择：
  - 类型 Type：Micro / Short / Feature / Ad（默认 Short）
  - 题材 Genre：Sci-Fi / Romance / Thriller / Comedy / Drama / Horror / Fantasy / Historical（默认 Drama）
  - 风格 Tone：Serious / Comedy / Suspense / Romance / Horror（默认 Serious）
  - 取值与 `src/pages/Scripts.tsx` 中 `TYPES/GENRES/TONES` 保持一致。
- 面板底部「开始创作剧本」按钮：
  - 把当前 textarea 内容作为 `plot`（剧情），`theme` 留空让用户在剧本页继续补充；连同 type/genre/tone 一起写入 `sessionStorage.setItem('script_prefill', JSON.stringify({...}))`。
  - 未登录 → `navigate({ to: '/login' })`（登录页登录成功后会自然回到内部跳转流程；为简单起见仅引导登录，不强行回跳）。
  - 已登录 → `navigate({ to: '/scripts' })`。

### 2. `src/components/scripts/ScriptComposer.tsx`
- 新增 `useEffect`（mount 一次）：读取 `sessionStorage.getItem('script_prefill')`，若存在则按白名单校验后调用 `setType / setGenre / setTone`，并把 `plot` 写入 `setPlot`（仅在当前 plot/theme 为空时填入，避免覆盖用户输入）。读取后 `sessionStorage.removeItem('script_prefill')`，仅一次性带入。

### 3. i18n（`src/i18n/zh.ts`、`src/i18n/en.ts`）
- 新增按钮与面板文案：`hero_script_entry`（剧本生成 / Generate Script）、`hero_script_panel_title`、三组分类标签、`hero_script_start`（开始创作剧本 / Start Writing）。

## 不动的内容
- 不修改 `scriptStorage`、社区分享、`AuthGate`、数据库。
- 不改动 `QuickActionChips`。
- 不改 Hero 主"创建"按钮原有 AI 回复逻辑。

## 数据契约
`sessionStorage['script_prefill']`：
```json
{ "type":"Short","genre":"Drama","tone":"Serious","theme":"","plot":"用户在 Hero 中输入的文本" }
```
仅 ScriptComposer 消费一次后清除。