# 去掉右栏顶部项目文件 icon

## 现状

`src/components/restyle/RestyleStudio.tsx` 右侧顶部栏（line 5500）左侧只放了一个 `FolderOpen` 图标（line 5502），没有文字。该图标在 Tab 切换后并不能准确表达当前面板含义，且用户已选中的正是该 icon。

## 变更

1. **删除 line 5502 的 `<FolderOpen size={16} className="text-accent" />`**。
2. 如果 `FolderOpen` 在该组件中不再被使用，同步移除其 `import`。
3. 保留左侧占位 `div` 的结构不变，使右侧按钮组仍对齐，避免布局塌陷。

## 涉及文件

- `src/components/restyle/RestyleStudio.tsx`

## 验证

- 打开 `/restyle`，右栏顶部栏左侧不再有 `FolderOpen` 图标。
- 顶部栏仍保持左右两端对齐，上传按钮和画布按钮正常显示。
