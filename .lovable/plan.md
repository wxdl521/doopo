# 转绘工作台右侧面板标题调整

将转绘工作台右侧面板「项目文件」区域的图标与标题改为「视频转绘工作台」，使其与当前模块功能一致。

## 变更内容

1. **文案替换**
   - 将 i18n 键 `restyle_project_files` 从「项目文件」改为「视频转绘工作台」。
   - 同步更新 `src/i18n/en.ts` 中对应英文文案（如 `Video Restyle Workbench`）。

2. **图标替换**
   - 将 `src/components/restyle/RestyleStudio.tsx` 右侧面板标题处的 `FolderOpen` 图标替换为更贴合视频转绘含义的 Lucide 图标（如 `Clapperboard` 或 `Film`）。

## 涉及文件

- `src/i18n/zh.ts`
- `src/i18n/en.ts`
- `src/components/restyle/RestyleStudio.tsx`（约第 5502 行图标）

## 验证

- 构建后打开 `/restyle`，右侧面板顶部标题显示为「视频转绘工作台」，图标同步更新。
- 检查英文环境下文案显示为对应英文，无截断或布局错位。
