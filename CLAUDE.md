# CLAUDE.md — Doopoo AI Creative Studio

> AI 驱动的短剧/创意内容全流程生产平台。从灵感 → 剧本 → 角色/场景/道具 → 分镜 → 视频生成。

---

## 命令

| 命令 | 说明 |
|---|---|
| `bun run dev` | 启动 Vite 开发服务器（HMR） |
| `bun run build` | 生产构建 |
| `bun run build:dev` | 开发模式构建 |
| `bun run preview` | 预览构建产物 |
| `bun run test` | 运行 Vitest 测试 |
| `bun run lint` | ESLint 检查 |
| `bun run format` | Prettier 格式化 |
| `bun run db:push` | 推送 Supabase 数据库迁移 |
| `bunx wrangler deploy` | 部署到 Cloudflare Workers |

**包管理只能用 Bun**（`bun install`），不要用 npm/pnpm，否则 lock 文件冲突。

---

## 技术栈

| 层 | 技术 |
|---|---|
| 全栈框架 | **TanStack Start**（React 19 SSR/SSG + Server Functions） |
| 路由 | **TanStack Router**（文件系统路由，类型安全） |
| 数据获取 | **TanStack React Query** |
| 样式 | **Tailwind CSS v4** + shadcn/ui（Radix UI）+ CSS 变量主题 |
| 构建 | **Vite 7** + `@lovable.dev/vite-tanstack-config` + `@cloudflare/vite-plugin` |
| 后端/部署 | **Cloudflare Workers**（Wrangler） |
| 数据库 | **Supabase PostgreSQL**（RLS） |
| 认证 | **Supabase Auth**（邮箱 + Bearer Token） |
| 校验 | Zod + React Hook Form |
| i18n | 自研 Context API（`en.ts` / `zh.ts`，1000+ 键值） |
| 测试 | Vitest + jsdom + Testing Library |
| 图表 | Recharts |
| 图标 | Lucide React |

---

## 项目结构

```
src/
├── server.ts                  # CF Worker SSR 入口（错误包装器）
├── start.ts                   # TanStack Start 实例（中间件注册）
├── router.tsx                 # Router + QueryClient 创建
├── routeTree.gen.ts           # 自动生成的路由树（勿手动编辑！）
├── styles.css                 # 全局样式 + Tailwind + CSS 变量主题
│
├── routes/                    # 文件系统路由（~45 个，自动生成 routeTree）
│   ├── __root.tsx             # 根布局（QueryClient + Theme + i18n + Layout）
│   ├── index.tsx              # Landing Page
│   ├── home.tsx               # 登录后主页
│   ├── workspace.$workspaceId.tsx  # 核心工作区
│   ├── account/*.tsx          # 账户管理（订阅/安全/通知/积分）
│   ├── admin/*.tsx            # 管理后台（计费/模型/租户）
│   ├── team/*.tsx             # 团队协作（成员/用量/审批/日志）
│   ├── api/                   # 服务端 API 端点
│   └── ...
├── components/
│   ├── ui/                    # shadcn/ui 组件（已 eject，可修改）
│   ├── workspace/             # 工作区组件（ZopiaChatPanel / CharacterStage / StoryboardTimeline）
│   ├── community/             # 社区组件
│   └── scripts/               # 剧本组件（ScriptComposer）
├── pages/                     # 页面级组件（Home / Projects / Scripts / Characters 等）
├── lib/                       # 核心业务逻辑层（Server Functions + 工具函数）
│   ├── seedream.functions.ts  # 主力图像生成 + 模型路由分发中心
│   ├── *Image.functions.ts    # 各供应商图像生成（12 个）
│   ├── videoGenerate.functions.ts
│   ├── storyboard.functions.ts
│   ├── scriptPipeline.functions.ts
│   ├── scriptAgent.functions.ts
│   ├── projects.functions.ts / scripts.functions.ts / community.functions.ts
│   └── ...
├── hooks/                     # useAuth / use-mobile
├── context/                   # ThemeContext / LanguageContext
├── i18n/                      # en.ts / zh.ts / LanguageContext.tsx
├── integrations/supabase/     # client.ts / client.server.ts / auth-middleware.ts
├── data/                      # 静态数据 / mock（workspaceGenerators / assetsMock / showcase）
├── layouts/                   # MainLayout
├── assets/                    # 静态资源（角色素材 c1-c4）
└── test/setup.ts              # 测试全局设置
```

---

## 核心架构模式

### 1. Server Functions（服务端函数）

所有 AI 调用和数据库操作封装为 `createServerFn`，**只在服务端执行，API Key 不暴露到客户端**：

```ts
// src/lib/seedream.functions.ts（典型模式）
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const generateImage = createServerFn({ method: "POST" })
  .validator(z.object({ prompt: z.string(), size: z.string().optional() }))
  .handler(async ({ data }) => {
    // 这里只在服务端运行，可以安全使用 process.env.ARK_API_KEY
    const response = await fetch(arkUrl, { /* ... */ });
    return { url: response.data.url };
  });
```

**规则：**
- Server Function 文件不需要 `.server.ts` 后缀（TanStack Start 自动检测 `createServerFn`）
- **禁止** `import "server-only"`——ESLint 会报错
- 所有 `.env` 读取必须通过 `process.env.*`（服务端），客户端用 `import.meta.env.VITE_*`

### 2. 路由系统

TanStack Router **文件系统路由**，文件名即路由：

```
src/routes/
├── __root.tsx                    → 根布局（包裹所有页面）
├── index.tsx                     → /
├── home.tsx                      → /home
├── workspace.$workspaceId.tsx    → /workspace/:workspaceId
├── projects.$projectId.tsx       → /projects/:projectId
├── account.index.tsx             → /account
├── account.security.tsx          → /account/security
```

- `$param` = 动态路由参数
- `_` 前缀 = 路径不渲染（如 `assets_.$tab.$id.tsx` → `/assets/:tab/:id`）
- `routeTree.gen.ts` 由 Vite 插件自动生成，**不可手动编辑**

### 3. 中间件系统

在 `src/start.ts` 中注册：

```ts
export const startInstance = createStart(() => ({
  requestMiddleware: [errorMiddleware],          // 全局错误捕获
  functionMiddleware: [attachSupabaseAuth],      // 自动注入 Supabase 认证
}));
```

- **errorMiddleware**：捕获所有异常，区分 Response 对象（透传）vs 未知错误（500 页面）
- **requireSupabaseAuth**：Bearer Token 鉴权，在需要保护的 Server Function 中使用

### 4. Supabase 双客户端

| 客户端 | 文件 | 用途 |
|---|---|---|
| 浏览器端 | `integrations/supabase/client.ts` | 用户认证、RLS 查询 |
| 服务端 | `integrations/supabase/client.server.ts` | Service Role 密钥（绕过 RLS） |

客户端用 Proxy 懒初始化：
```ts
import { supabase } from "@/integrations/supabase/client";
```

### 5. AI 模型路由机制

```
用户选择模型 → 模型 ID 带供应商前缀 → normalizeImageModelForRouting() 分发
```

**主力**：火山方舟 ARK（Seedream 5.0），无前缀或 `doubao-seedream-*`

**路由规则**（`seedream.functions.ts`）：
- 空 / `doubao-seedream-*` → ARK Seedream
- `pixflow/*` → Pixflow 中转
- `tokenflash/*` → Tokenflash
- `azure/*` → Azure OpenAI
- `onetoken/*` / `otu/*` / `aigcfamily/*` → 对应供应商
- `qwen-*` / `wan-*` → DashScope
- 裸 `openai/gpt-image-2` → **自动归一化为 `pixflow/gpt-image-2`**（避免错误路由到 ARK）

### 6. 国际化

```tsx
import { useLanguage } from "@/i18n/LanguageContext";
const { t } = useLanguage();
// <h1>{t("home.title")}</h1>
```

语言包在 `src/i18n/zh.ts` 和 `src/i18n/en.ts`，新增文本需在两个文件中同步添加。

### 7. 主题系统

CSS 变量主题（`styles.css`），支持亮色/暗色：

```css
:root { --background: 0 0% 100%; /* ... */ }
.dark { --background: 0 0% 3.9%; /* ... */ }
```

使用 Tailwind 类名：`bg-background`、`text-foreground`、`text-muted-foreground` 等。

---

## 重要约束与坑

### 开发环境
1. **只能用 Bun**，不要混用 npm/pnpm
2. 首次 `bun install` 较慢（CF Worker polyfill 体积大）
3. 本地 dev 需在 `.env.local` 中配置 API Key（`.env` 中的 Key 已移至 Secrets）

### AI 模型调用
4. **Azure gpt-image-2**：认证头用 `api-key:` 而非 `Authorization: Bearer`，且不支持 `output_format` / `output_compression` 参数（否则 400）
5. **Seedream 5.0 最小像素数**：3,686,400（`2048x2048` ✅，`1104x1472` ❌，`2560x1280` ❌）
6. **Seedream 超时**：已设为 180s，但多参考图融合 + 高分辨率仍可能超时
7. **裸 `openai/gpt-image-2`** → 自动归一化为 `pixflow/gpt-image-2`，不要手动改
8. 各供应商请求格式不同，修改前务必参考 `docs/` 目录对应文档

### 样式
9. **Tailwind CSS v4**，不是 v3——类名语法有差异
10. shadcn/ui 组件在 `src/components/ui/`，已 eject 可修改
11. 主题基于 CSS 变量，`bg-background` / `text-foreground` 等会自动适配暗色模式

### 部署
12. Cloudflare Workers **10MB 代码包限制**，注意构建产物体积
13. 需启用 `nodejs_compat` 兼容性标志
14. 部分 Node.js 原生模块在 CF Workers 中不可用

### 数据库
15. RLS 策略变更通过 Supabase Migration（`supabase/migrations/`）
16. 服务端用 Service Role 可绕过 RLS，**谨慎操作**

### Vite 配置
17. `vite.config.ts` 使用 `@lovable.dev/vite-tanstack-config` 封装，**不要手动添加** tanstackStart、viteReact、tailwindcss、tsConfigPaths、cloudflare 等插件——会导致重复插件错误

---

## 新增功能 Checklist

开发新功能时的标准流程：

- [ ] Server Function：使用 `createServerFn`，Zod 校验输入，`.handler()` 中访问 `process.env.*`
- [ ] 路由：在 `src/routes/` 创建文件路由，或修改现有路由
- [ ] 页面/组件：放在 `src/pages/` 或 `src/components/`，用 `@/` 路径别名引用
- [ ] i18n：在 `zh.ts` 和 `en.ts` 中同步添加新翻译键
- [ ] 认证：需要登录的 Server Function 使用 `requireSupabaseAuth` 中间件
- [ ] 数据库：新增表/策略通过 Supabase Migration 管理
- [ ] 样式：使用 Tailwind v4 类名 + CSS 变量（`bg-background` 等）
- [ ] 测试：在 `src/**/__tests__/` 或 `src/**/*.test.ts` 添加 Vitest 测试
- [ ] Lint：提交前 `bun run lint && bun run format`

---

## 部署流程（GitHub → Cloudflare Workers）

```
本地开发 → git commit → git push origin main → GitHub Actions? → Cloudflare Workers 更新
```

生产部署命令：`bunx wrangler deploy`

**Git 仓库信息：**
- 远程地址：`https://github.com/cellan/doopoo-code-hub.git`
- 默认分支：`main`

---

## 文档索引

| 文件 | 内容 |
|---|---|
| `docs/all.md` | 全量文档 |
| `docs/api.md` | API 文档 |
| `docs/image2.md` | GPT-Image2 对接说明 |
| `docs/qwen.md` | DashScope/通义千问对接说明 |
| `docs/seedream.md` | Seedream 对接说明 |
| `docs/timeline-flow.md` | 时间轴流程 |
| `docs/交接文档.md` | 项目交接文档 |
