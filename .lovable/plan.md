## 目标
将项目中所有 `Zopia / zopia` 相关命名（包括文件名、组件名、i18n key 前缀 `zp_`、用户可见文案）统一替换为 `Doopoo / doopoo / dp_`。

## 涉及文件（4 个）
- `src/components/workspace/ZopiaChatPanel.tsx` → 重命名为 `DoopooChatPanel.tsx`
- `src/i18n/zh.ts`（169 处 `zp_` 键 + 文案中的 "Zopia"）
- `src/i18n/en.ts`（169 处 `zp_` 键 + 文案中的 "Zopia"）
- `src/routes/workspace.$workspaceId.tsx`（import 与 JSX 使用 `ZopiaChatPanel`）

## 替换规则（批量执行）
对上述 4 个文件依序执行：
1. `ZopiaChatPanel` → `DoopooChatPanel`（组件名/导入名）
2. `Zopia` → `Doopoo`（用户可见文案、注释）
3. `zopia` → `doopoo`（小写引用）
4. `zp_` → `dp_`（i18n key 前缀，正则边界 `\bzp_`）

随后：
- `git mv src/components/workspace/ZopiaChatPanel.tsx src/components/workspace/DoopooChatPanel.tsx`
- `src/routes/workspace.$workspaceId.tsx` 中 `import ZopiaChatPanel from '../components/workspace/ZopiaChatPanel'` 已通过规则 1 改为 `import DoopooChatPanel from '../components/workspace/DoopooChatPanel'`。

## 验收
- `grep -rn 'Zopia\|zopia\|zp_' src` 无任何输出。
- 构建通过，`/workspace/:id` 页面右侧聊天面板正常渲染、文案不变（仅"Zopia"字样改为"Doopoo"），i18n 不出现 missing key。

## 不动
- 不改 `.lovable/plan.md` 之外的历史规划文档内容；如有 Zopia 引用属于历史记录可保留。
- 不改业务逻辑、不改样式、不改 API。
