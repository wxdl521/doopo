# 移动端底部导航图标与左侧菜单栏统一

## 目标

移动端底部导航（`MobileNav`）当前用的是 Lucide 通用图标，且导航项与桌面端左侧栏不一致。改为复用桌面端的自定义 SVG 图标，并对齐导航项与顺序。

## 修改内容

`src/components/MobileNav.tsx`：

1. 移除 Lucide 图标引用（Home / FileText / FolderOpen / Library / Bookmark / Palette / ShieldCheck 等），改为引入 `src/components/icons/` 下的自定义组件：NavHome、NavScript、NavTranscribe、NavProject、NavBases、NavAssets、NavRestyle、NavZoclaw、NavModels。
2. 导航项与桌面端 `Sidebar.tsx` 保持同一份顺序与图标映射：
   首页 / 剧本 / 台词稿 / 项目 / 素材库(NavBases) / 资产(NavAssets) / 转绘 / ZoClaw / 模型。
   末尾保留移动端专有的「我」（账户）入口，继续用 Lucide `User`。
3. 图标尺寸从 18 提升到 22，配合底部栏高度与文字保持视觉平衡；每项仍保持横向可滚动、最小宽度不变。

## 备注

- 自定义图标内白色路径已是 `currentColor`，会跟随选中态高亮；橙色点缀保留，与桌面端一致。
- 不改动桌面端 Sidebar、路由与任何业务逻辑。
