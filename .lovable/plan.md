# 修复「加载项目失败：Backend configuration is missing」+ 域名 DNS 漂移

两个独立问题，都已确认。

## 一、DNS 检查结果（test.doopoo.ai）

状态：**drifted（已漂移）**，持续约 11 小时，是当前主域名。

| 记录 | 期望值 | 实际观测值 | 状态 |
| --- | --- | --- | --- |
| A `test.doopoo.ai` | 185.158.133.1 | 188.114.97.0 / 188.114.96.0 | 不匹配 |
| TXT `_lovable.test.doopoo.ai` | lovable_verify=b7760f21… | 一致 | 正常 |

观测到的两个 IP 属于 Cloudflare 边缘节点，说明该记录在 Cloudflare 处开启了**橙色云代理（Proxied）**，因此对外解析出的不是源站 IP，Lovable 无法确认指向本项目。

修复二选一（在 Cloudflare DNS 面板操作）：
- 方案 A（推荐，最简单）：把 `test.doopoo.ai` 的 A 记录切换为 **DNS only（灰色云）**，值保持 `185.158.133.1`。
- 方案 B：保留代理，则需在 Lovable 项目设置 → 域名中移除后重新连接，并在「高级」里勾选「域名使用 Cloudflare 或类似代理」，改用 CNAME 校验方式。

TXT 验证记录正常，不需要改动。同时建议把 `www` / 根域一并按同样方式配置（如果需要）。

## 二、Backend configuration is missing

报错来自 `src/lib/projects.functions.ts` 的 `listMyProjects`：当服务端 `process.env.SUPABASE_URL` 或 `SUPABASE_PUBLISHABLE_KEY` 为空时直接返回该文案。已确认 `wrangler.jsonc` 中没有任何 `vars`，即自建 Cloudflare Workers 部署上这两个变量确实没有注入 —— 这是线上出现该报错的直接原因（之前 test.doopoo.ai 的同类环境变量缺失问题同源）。

修复内容：

1. 在部署环境补齐服务端变量：`SUPABASE_URL`、`SUPABASE_PUBLISHABLE_KEY`、`SUPABASE_SERVICE_ROLE_KEY`（后者用于服务端管理类调用）。通过 `wrangler secret put` 注入，不写入仓库。
2. 新增构建/启动期护栏：在 `src/server.ts` 入口做一次性检查，缺失时输出明确的一行日志（只打印缺失的变量名，不打印值），便于定位。
3. 前端提示可读化：`listMyProjects` 等返回 `Backend configuration is missing` 的位置，改为返回稳定错误码（如 `BACKEND_CONFIG_MISSING`），前端映射为中英双语文案「后端配置缺失，请联系管理员检查部署环境变量」，并在 i18n 的 `zh.ts` / `en.ts` 同步补键。
4. 排查同类分支：检索所有读取 `process.env.SUPABASE_*` 并静默降级的 server function，统一走同一错误码与提示，避免出现「空列表 + 模糊文案」。

## 技术细节

- 涉及文件：`src/lib/projects.functions.ts`、`src/server.ts`、`src/i18n/zh.ts`、`src/i18n/en.ts`，以及 `rg` 检索出的其他 `SUPABASE_URL` 降级分支。
- 不改动 `src/integrations/supabase/*` 自动生成文件。
- DNS 部分无代码改动，需要你在 Cloudflare 侧操作。
