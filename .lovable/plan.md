# 修复：网站打开报「页面加载失败」

## 问题定位（已复现）

本地开发服务器访问 `/home` 同样白屏报错，浏览器控制台给出确切原因：

```
[vite] Internal Server Error
[import-protection] Import denied in client environment
  Denied by specifier pattern: @tanstack/react-start/server
  Importer: src/lib/community.functions.ts:238
TypeError: Failed to load dynamically imported module: /src/routes/home.tsx
```

`src/lib/community.functions.ts` 被首页等多个客户端组件直接 import（`Home.tsx`、`CommunityCard.tsx`、`community.index.tsx`、`account.posts.tsx`、`ShareDialog.tsx`）。但该文件里包含只能跑在服务端的代码：

- 第 238 行 `await import("@tanstack/react-start/server")`（`resolveViewerKey` 内取请求头）
- 第 5 行 `import { getOptionalAuthCtx } from "./authContext"`，而 `authContext.ts` 顶部静态 import 了 `@tanstack/react-start/server`

导入保护把整个模块从客户端图里拒掉 → 路由分包加载 500 → 根错误边界渲染「页面加载失败」。控制台里另一条 `Missing Supabase environment variable(s)` 是同一次崩溃链的下游噪音，不是根因。

## 修复方案

1. 新增 `src/lib/authContext.server.ts`，把 `authContext.ts` 的内容整体搬过去（`.server` 后缀被导入保护按文件名放行）；原 `authContext.ts` 删除，更新全部引用方（`creditsGuard.ts`、各 `*Image.functions.ts`、`tokenflash.functions.ts` 等纯服务端文件）。
2. 新增 `src/lib/communityViewerKey.ts`（客户端安全的纯函数模块），存放 `fnv1aHex` 与 `buildAnonymousViewerKey`。
3. 新增 `src/lib/community.server.ts`，存放 `resolveViewerKey`（引用 `authContext.server` 与请求头读取）。
4. `community.functions.ts`：删除服务端 import 与 `resolveViewerKey`/哈希实现，改为在各 `.handler()` 内部 `await import("./community.server")`；对外仍从 `communityViewerKey.ts` re-export `buildAnonymousViewerKey` 以免破坏调用方。
5. 更新 `src/lib/__tests__/communityViewerKey.test.ts` 的 import 路径与 mock 目标（改为 `../authContext.server`、`../community.server`、`../communityViewerKey`）。

## 验证

- `bunx vitest run src/lib/__tests__/communityViewerKey.test.ts`
- Playwright 打开 `/home` 与 `/community`，确认无 import-protection 报错、页面正常渲染。
