# 侧边栏台词稿图标替换 + 图标再放大一级

## 1. 替换台词稿图标

重写 `src/components/icons/NavTranscribe.tsx`，使用新上传的「141_专栏_台词稿.svg」路径数据：

- 保持现有组件接口（`size` 属性、`viewBox="0 0 1024 1024"`、透传 SVG props），Sidebar 无需改动。
- 白色路径（`fill="#ffffff"`）改为 `fill="currentColor"`，跟随导航文字色与选中态高亮。
- 品牌橙色 `#F15A24` 保留（与其它图标的 `#F9471E` 点缀风格一致）。
- 去掉 svg 上的 `t`/`p-id`/`class`/`width`/`height` 等冗余属性。

## 2. 图标再放大一级

- `src/components/Sidebar.tsx`：顶部 9 个导航图标 `size={24}` → `size={28}`（底部支持/联系图标保持 18）。
- `src/styles.css`：`.nav-item` 高度 `72px` → `80px`，宽度保持 `56px`，保证图标与文字垂直间距协调。

## 备注

侧边栏容器宽度 `88px` 不变；移动端底部导航不受影响。
