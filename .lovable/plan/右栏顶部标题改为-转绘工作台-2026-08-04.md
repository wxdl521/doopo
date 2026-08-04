# 右栏顶部标题改为「转绘工作台」

## 现状

`src/components/restyle/RestyleStudio.tsx` 右侧顶部栏（line 5499-5523）左侧目前只有一个 `FolderOpen` 图标，没有文字，且已计划删除该 icon。i18n 中已有现成键值 `restyle_workbench: "转绘工作台"`。

## 变更

1. **删除 line 5502 的 `<FolderOpen size={16} className="text-accent" />`**。
2. **在同位置放入 `{t.restyle_workbench}` 标题文字**：
   - 字体：`text-sm font-semibold text-text-primary`
   - 单行截断，避免标题过长挤占右侧按钮
3. **保持布局合理**：左侧 flex 容器仍 `items-center gap-2`，右侧按钮组不变，顶部栏整体 `justify-between` 不变；视觉上左文右按钮，间距自然。
4. 若 `FolderOpen` 在该组件中不再被使用，同步移除其 `import`。

## 涉及文件

- `src/components/restyle/RestyleStudio.tsx`
- 可选：`src/i18n/zh.ts`、`src/i18n/en.ts`（无需新增键，直接使用已有 `restyle_workbench`）

## 验证

- 打开 `/restyle`，右栏顶部栏左侧显示「转绘工作台」，文字大小与右侧按钮视觉平衡。
- 上传、画布按钮保持正常位置。
- 长标题时不会换行或挤压按钮。
