## 目标

把"新建项目 → 角色"里 4 张分散的字段卡（外形/性格/动机/首场）改造成一块统一的**角色档案信息面板**，并补充 1-2 个轻量标签与关系网摘要；同时把侧栏并排显示的断点从 `lg`（≥1024px）降到 `md`（≥768px），让用户在 888px 预览里也能看到主图+档案左右并排。略缩图切换器位置保持现状（在主图正下方），但确认在新断点下不会被压缩。

## 当前问题

1. 4 张独立卡片像视觉碎片，无法一眼读完角色档案。
2. `lg:hidden / lg:flex` 断点把 888px 预览推到了 2×2 底部 fallback，主图两侧空着。
3. 角色没有关系信息，看不出 4 个角色彼此如何咬合。
4. 没有 MBTI / 关键道具一类的速读标签。

## 新布局结构

```text
┌─────────────────────────────────────────────────────────────┐
│ ▍林夏  [女主] [高冷学霸] [17 岁] [INFP] [钢笔]   2/4 上下滑动 │
├──────────────┬──────────────────────┬──────────────────────┤
│              │                      │ 角色档案              │
│              │                      │ ─────────────────     │
│  主图 372×498 │                     │ 外形  ……              │
│              │                      │ 性格  ……              │
│              │                      │ 动机  ……              │
│              │                      │ 首场  ……              │
│              │                      │ ─────────────────     │
│              │                      │ 关系网                │
│              │                      │ ↔ 江野  暗恋 / 互相试探│
│              │                      │ ↔ 小萌  闺蜜推手       │
│              │                      │ ↔ 周学姐 上下级压制    │
├──────────────┴──────────────────────┴──────────────────────┤
│ [主视图] [多视图]    点击缩略图 / 方向键切换    配色 ●●●●     │
└─────────────────────────────────────────────────────────────┘
```

要点：
- **左/中/右三栏取消**，改成「主图 + 右侧单一档案面板」两栏布局。888px 视口右侧约 380px 可放下档案。
- **档案面板内部**用一个圆角容器、`divide-y` 分隔行，每行 `label · 值` 对齐，去掉 4 张独立卡片的边框堆叠。
- **关系网摘要**渲染在档案面板下半部分，自动从同一 cast 推导（例：`lead↔lead → 暗恋 / 互相试探`，`lead↔supporting → 闺蜜推手`，`lead↔villain → 上下级压制`，`villain↔supporting → 警告`）。在 mock generator 里加一张关系矩阵，避免每次重新算。
- **轻量标签**：在 header 右侧 chip 群里新增 2 个 chip
  - MBTI：根据 `personality` 关键词映射（克制/敏感 → INFP；直球/迟钝 → ESFP；热情/嘴快 → ENFP；强势/控制 → ENTJ）。
  - 关键道具：从 `debutShot` / `look` 里抽一个关键名词（mock 直接在 generator 里手填一个 `keyProp` 字段最稳）。
- **断点**：把侧栏的 `hidden lg:flex` 改为 `hidden md:flex`，底部 fallback 改为 `md:hidden`。在 768–1023px 仍能并排。
- **长文本处理**：档案面板设置 `max-h-[498px] overflow-y-auto`，与主图等高对齐，超长滚动；header chip 全部 `shrink-0 truncate max-w-…`，确保不撑破 372×498 主图区域。
- **略缩图切换器**：保持 `CharacterStage` 内现状（已在主图正下方，clamp 字号），在新布局下验证 372px 宽度不被新断点挤压。

## 技术细节

1. **`src/data/workspaceGenerators.ts`**
   - 给 `GenCharacter` 增补两个可选字段：`mbti?: string`、`keyProp?: string`。
   - 4 个角色补 MBTI 与 keyProp。
   - 新增 `generateCharacterRelations()` 或在 `generateCharacters()` 返回值里挂 `relations: { targetId, label, summary }[]`，写一张 4×4 关系表（只保留每角色 2–3 条最相关边）。

2. **`src/routes/workspace.$workspaceId.tsx` → `CharacterView`**
   - Header chip 行追加 MBTI / keyProp chip（与 role/age chip 一致样式，颜色偏中性）。
   - 删除三栏 flex 布局，改为两栏 grid：
     - `grid-cols-[372px_1fr] gap-5 md:grid` 在 ≥md 启用。
     - 主图列保留 `CharacterStage`（含略缩图切换器）。
     - 档案列渲染新组件 `CharacterDossier`（同文件内 function）。
   - 把现有 4-field mobile fallback 改为 `md:hidden`，并在 fallback 里也渲染 `CharacterDossier`（只读同一组件，单列），避免代码分叉。

3. **新组件 `CharacterDossier`（在同文件内）**
   - props: `character: GenCharacter`, `cast: GenCharacter[]`
   - 上半段：`<dl class="divide-y divide-border/60">`，每个 row `<dt class="text-xs text-text-muted w-16 shrink-0">` + `<dd class="text-sm text-text-secondary leading-relaxed">`。
   - 中段标题 `关系网` + 列表，每条 `↔ 角色名（chip 颜色取 ROLE_TONE） · 关系标签 · 一行摘要`。
   - 容器：`rounded-2xl border bg-bg-elevated/40 px-5 py-4 h-[498px] overflow-y-auto`。

4. **样式细节**
   - 档案行高度自适应，关键值如「动机」「首场」可以多行，行间 `py-2.5`。
   - 关系名通过 `<button>` 触发滚动到该角色 section（用 `document.getElementById` + `scrollIntoView({behavior:'smooth'})`），section 已有 `key={c.id}`，加一个 `id={c.id}` 即可。
   - 在 a11y 上：dossier 用 `<dl>`，关系网用 `<ul role="list">`；按钮带 `aria-label="跳转到角色 江野"`。

5. **断点回归**
   - 验证 888px 视口：372 主图 + 5px gap + 511px dossier，足够；header chip 行用 `flex-wrap` 防溢出。
   - 验证 ≥1024px 仍美观（dossier 列变宽到 ~700px，关系网两栏化用 `sm:columns-2` 在面板内做轻量两栏）。
   - 验证 <768px：单列堆叠，dossier 在主图下方，自然滚动。

## 不在范围内

- 角色编辑、AI 重生成按钮（沿用现状）。
- CharacterStage 内部略缩图切换器的样式（已在上轮迭代完成，不再调整）。
- 关系网的可视化连线图（本轮只做文字摘要）。

## 风险

- MBTI / 关系网是 mock 推导，用户若期待真实 AI 输出需在后续接 `aiGenerate`。本次只保证布局占位真实可读。
- 把断点从 lg 降到 md 后，旧的 lg 视图需要重新核对密度，文档中已写明在 1024px 以上启用 dossier 内部两栏。