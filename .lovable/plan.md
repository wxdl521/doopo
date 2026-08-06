# 修复：test.doopoo.ai 打开报「页面加载失败」

## 已确认的事实

- Lovable 预览环境 `/home` 正常渲染（本地 dev 返回 200，页面内容完整）。
- 线上自定义域 `https://test.doopoo.ai/home` 返回的 HTML 引用 `/assets/index-BcTTH-WQ.js`，与截图控制台报错的文件一致。
- 直接下载该线上 JS 检查：**不包含项目的数据库地址字符串**，只包含 `Missing Supabase environment` 报错文案。

结论：不是代码 bug，也不是数据库故障。是那次 Cloudflare Workers 构建时**没有注入 `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY`**，客户端数据库客户端初始化直接抛错，被根错误边界接管成整页「页面加载失败」。沙箱里的 `.env` 有这两个变量，但执行构建的机器/CI 没有。

## 修复方案

1. **构建环境补齐变量（根因，必做）**：在执行 `bun run build && bunx wrangler deploy` 的机器/CI 上提供
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
   - （可选）`VITE_SUPABASE_PROJECT_ID`

   本机放 `.env.local`；CI 用 Repository Secrets 注入。重新构建后 grep 产物 JS 应能命中数据库地址，再部署。

2. **构建期护栏**：新增 `scripts/check-build-env.ts`，在 `build` 脚本前校验上述变量，缺失即 `exit 1`，让问题在构建阶段暴露，而不是上线后白屏。

3. **降级提示（可选）**：`src/integrations/supabase/client.ts` 是自动生成文件不改；在 `src/routes/__root.tsx` 的 `ErrorComponent` 中识别该报错文案，提示「服务配置缺失，请联系管理员」，替代无信息的通用错误页。

## 需要确认

只做 1+2 已能彻底解决打不开的问题；第 3 项要不要一并做？