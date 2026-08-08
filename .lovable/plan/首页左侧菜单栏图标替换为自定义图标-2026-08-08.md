# 首页左侧菜单栏图标替换为自定义图标

把左侧导航（Sidebar）的 9 个 Lucide 图标换成你上传的这套 SVG，并保证在深色/浅色主题、悬停与选中态下都显示正常。

## 图标对应关系

| 菜单项 | 现有图标 | 新图标 |
| --- | --- | --- |
| 首页 | Home | 032_首页.svg |
| 剧本 | FileText | 032_剧本.svg |
| 台词稿/转写 | AudioLines | 032_台词稿.svg |
| 项目 | FolderOpen | 032_项目.svg |
| 素材库 | Library | 032_素材库-20.svg |
| 资产库(Bases) | Bookmark | 032_资产.svg |
| 转绘 | Palette | 032_转绘.svg |
| Zoclaw | WandSparkles | 032_Dooclaw.svg |
| 模型 | Sparkles | 032_模型.svg |

（032_项目-2.svg 与 032_项目.svg 内容相同，只用其中一个。）

## 做法

1. 在 `src/components/icons/` 下新增 9 个 React SVG 组件（源码内联，不作为二进制资源）。
2. 每个组件中：原本 `fill="#ffffff"` 的路径改为 `fill="currentColor"`，这样图标跟随导航的文字颜色（默认灰、悬停变亮、选中变主题色），浅色主题下也不会“白底白图”；`#F9471E` 的橙色点缀保留，作为品牌高亮。
3. 组件统一接收 `size` 属性（默认 20），输出 `viewBox="0 0 1024 1024"`，接口与 Lucide 一致，`Sidebar.tsx` 中只需替换 `icon:` 字段，不改结构和样式。
4. 只改 `src/components/Sidebar.tsx`（桌面端左侧栏）。底部「支持/联系」两个图标保持 Lucide 不变。

## 备注

移动端底部导航 `MobileNav.tsx` 目前仍是 Lucide 图标。如需一并替换，可在确认桌面端效果后再同步。
