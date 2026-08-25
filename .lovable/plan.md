# 修复「加载项目失败：Backend configuration is missing」+ 域名 DNS 漂移

两个独立问题，都已确认。

## 一、DNS 检查结果（test.doopoo.ai）—— 13:23 复查后仍未生效

状态：**drifted（仍漂移）**，已持续约 13 小时。刚刚直接向 1.1.1.1 / 8.8.8.8 查询，公网解析结果是：

```text
test.doopoo.ai  A  188.114.96.2
test.doopoo.ai  A  188.114.97.2   (TTL 300)
```

| 记录 | 期望值 | 公网实际值 | 状态 |
| --- | --- | --- | --- |
| A `test.doopoo.ai` | 185.158.133.1 | 188.114.96.2 / 188.114.97.2 | 仍不匹配 |
| TXT `_lovable.test.doopoo.ai` | lovable_verify=b7760f21… | 一致 | 正常 |

`188.114.96.x / 188.114.97.x` 是 Cloudflare 边缘 IP，说明该 A 记录的**橙色云代理仍处于开启状态**——只要开着代理，公网永远看不到 185.158.133.1，Lovable 就会一直判定 DNS 未正确配置。你这次的修改可能只改了记录值、没有关掉代理开关，或改的是另一条记录。

请在 Cloudflare → doopoo.ai → DNS → 记录列表中，找到 Name 为 `test` 的那条 A 记录，确认三件事：

1. Type = `A`，Name = `test`，Content = `185.158.133.1`
2. Proxy status 一栏点成 **DNS only（灰色云）**，不是 Proxied（橙色云）
3. 删除同名的其它冲突记录（另一条 A、AAAA 或 CNAME `test`），同名多条会导致解析回到代理

保存后 TTL 为 300 秒，约 5 分钟后我再复查一次。

替代方案（若你必须保留 Cloudflare 代理）：在 Lovable 项目设置 → 域名中移除 `test.doopoo.ai` 后重新连接，并在「高级」里勾选「域名使用 Cloudflare 或类似代理」，改用 CNAME 校验方式。

TXT 验证记录正常，不需要改动。


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
