## 概览

上传的 `doopoo` 是一个 **Vite + React 18 + react-router-dom v6 + Tailwind v3** 的 SPA，包含 9 个页面、10 个组件、主题/多语言 Context、自定义设计 token 和动效。

当前 Lovable 项目模板是 **TanStack Start + React 19 + Tailwind v4**，技术栈不同，无法直接覆盖文件运行。需要做一次"移植 + 适配"，把源码搬进当前模板并按 TanStack 约定改写路由、入口和样式系统。**业务 UI / 文案 / 设计风格 100% 保持不变**。

## 源项目结构

- 路由（react-router-dom，通过 `MainLayout` 套壳）：
  `/home`、`/projects`、`/bases`、`/scripts`、`/characters`、`/zoclaw`、`/models`、`/pricing`、`/showcase`，根路径 redirect 到 `/home`，404 也回到 `/home`
- 组件：`Header / Footer / Sidebar / Logo / HeroPromptInput / PromoBanner / QuickActionChips / ProjectCard / ShowcaseCard / ShowcaseGrid`
- Context：`ThemeContext`（深浅色）、`LanguageContext`（中英文，含 `i18n/zh.ts`、`i18n/en.ts`）
- 数据：`src/data/showcase.ts`
- 样式：`src/index.css` + `tailwind.config.js`（自定义颜色 token、字体、阴影、渐变、动画 keyframes）
- 字体：通过 `index.html` 引入 Google Fonts（Inter、Space Grotesk）

## 迁移计划

### 1. 路由迁移（react-router-dom → TanStack Router 文件式路由）

- 在 `src/routes/__root.tsx` 内挂载 `LanguageProvider` + `ThemeProvider`，并把 `MainLayout`（Header + Sidebar + `<Outlet />` + Footer）作为根布局
- `src/routes/index.tsx`：用 `beforeLoad` 重定向到 `/home`
- 为 9 个页面分别创建路由文件：
  `home.tsx / projects.tsx / bases.tsx / scripts.tsx / characters.tsx / zoclaw.tsx / models.tsx / pricing.tsx / showcase.tsx`
- 每个路由通过 `head()` 设置独立的 `title` / `description`（用于 SEO）
- 根路由的 `notFoundComponent` 重定向到 `/home`，匹配源项目的 `*` 行为
- 删除 `src/App.tsx` 和 `src/main.tsx`（TanStack Start 不需要）

### 2. 组件 / 页面代码改写

把源 `src/components/**` 与 `src/pages/**` 全部复制进当前项目对应目录，并做最小改动：

- `import { Link, NavLink, useNavigate, useLocation } from 'react-router-dom'`
  → `import { Link, useNavigate, useLocation } from '@tanstack/react-router'`
- `<NavLink to="/x" className={({isActive})=>...}>` → `<Link to="/x" activeProps={{ className: '...' }}>`
- `useNavigate()` 调用 `navigate('/x')` → `navigate({ to: '/x' })`
- `to="/x"` 路径保持不变（不加尾斜杠）
- 业务逻辑、JSX、文案、className 全部保留

### 3. 样式系统迁移（Tailwind v3 → v4）

- 把 `src/index.css` 内容（CSS 变量、自定义 utility）合并进现有 `src/styles.css`
- 把 `tailwind.config.js` 的 `theme.extend` 用 Tailwind v4 的 `@theme` 语法重写到 `styles.css`：
  - 颜色：`--color-accent / --color-accent-mint / --color-accent-lime / --color-bg-* / --color-border-* / --color-text-*`
  - 字体：`--font-sans / --font-display`
  - 阴影：`--shadow-glow / --shadow-glow-lg / --shadow-card / ...`
  - 渐变背景：以 `@utility` 暴露 `bg-doopoo-gradient / bg-accent-gradient / bg-glow-orb`
  - 动画与 keyframes：`--animate-fade-in / --animate-slide-up / --animate-float / --animate-pulse-glow / --animate-shimmer` + `@keyframes`
- 保留模板自带的 shadcn 兼容 token（`--background / --foreground / --primary` 等）以免破坏 UI 组件

### 4. 静态资源与字体

- 将 `public/` 下的 `favicon.svg` 等静态文件复制到当前项目 `public/`
- Google Fonts（Inter + Space Grotesk）通过 `__root.tsx` 的 `head().links` 注入 `<link>` 标签，等价替代源项目 `index.html` 里的 `<link rel="stylesheet">`

### 5. 依赖

只需新增 `lucide-react`（源项目用了图标）。React 18 → 19、Tailwind 3 → 4 由当前模板提供，移植代码与两者均兼容，无需降级。
**不安装** `react-router-dom`，强制使用 TanStack Router。

### 6. 验证

- 让 dev server 跑通，访问 `/`、`/home`、`/projects`、`/showcase` 等核心路由
- 切换主题、切换语言确认 Context 正常
- 关键页面（Home / Characters / Scripts）目测排版无错位

## 不在本次范围内

- 不接入 Lovable Cloud / 数据库 / 后端
- 不引入新功能、不修改任何业务文案
- 不做 SEO 之外的额外改造

完成后你可以继续在 Lovable 里基于这套迁移后的代码迭代功能。