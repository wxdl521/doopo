# 供应商管理（模型定价上方新增模块）

在后台 `/admin` 新增「供应商管理」，位于「模型定价」之上。管理员可登记供应商（名称、接口地址、密钥）、在其下挂载模型（模型名称、类型、能力），并对模型做上架/下架、启用/停用。上架后的模型实时出现在用户端所有模型选择入口，再到「模型定价」为其配价。

## 业务流程

```text
添加供应商(URL + Key) → 添加该供应商的模型 → 上架/启用
        ↓
   模型定价页为该模型配置积分
        ↓
   用户端模型下拉框实时可见（未定价的模型标注"暂未计费"）
```

## 数据结构（新增两张表，SQL 交由老板执行）

- `public.ai_providers`：`id`、`code`（路由前缀，如 `otu`）、`name`、`kind`（openai_compatible / builtin）、`base_url`、`api_key_cipher`（AES-GCM 密文）、`api_key_hint`（尾 4 位，用于界面展示）、`env_key_name`（内置供应商沿用现有 Secret 名）、`enabled`、`sort_order`、时间戳。
- `public.ai_provider_models`：`id`、`provider_id`、`model_id`（供应商侧真实模型名）、`label`、`kind`（image/video/text）、`capabilities`（jsonb：t2i / i2i / 参考图数 / 支持的分辨率）、`listed`（上架）、`enabled`（启用）、`is_default`、`sort_order`、`note`。
- RLS：两表仅 `is_credit_admin()` 可读写；用户端不直连表，只经服务端函数读取"已上架 + 启用"的脱敏目录（不含 URL / 密钥）。
- 唯一约束：`ai_providers.code`；`(provider_id, model_id)`。

## 密钥加密

- 生成一枚服务端密钥 `PROVIDER_KEY_ENC_SECRET`（随机 64 位，仅服务端可读）。
- `src/lib/providerSecret.server.ts`：WebCrypto AES-256-GCM，`encrypt/decrypt`，密文格式 `v1:<iv_b64>:<ct_b64>`。
- 密钥只在服务端解密使用；任何返回给前端的结构只带 `api_key_hint`（`****1234`），不回传明文。
- 内置供应商（ARK / DashScope / 即梦等）登记时不填 Key，只填 `env_key_name`，运行时仍读现有 Secrets。

## 服务端函数（`src/lib/aiProviders.functions.ts`）

管理端（`requireSupabaseAuth` + `is_credit_admin` 校验）：
- `listProviders` / `upsertProvider` / `deleteProvider`
- `listProviderModels` / `upsertProviderModel` / `deleteProviderModel`
- `toggleModelListing`（上架/下架）、`toggleModelEnabled`
- `testProviderConnection`：用登记的 URL+Key 发一次最小请求校验连通性，返回状态码与耗时（不落明文日志）

用户端（登录可读）：
- `listListedModels({ kind })`：返回上架且启用的模型目录（`key`=`<provider.code>/<model_id>`、`label`、`sub`、`capabilities`、定价范围），60s 模块级缓存，写操作后失效（复用 `modelPricingCache` 同款模式）。

## 调用链路接入

- 新增 `src/lib/dynamicProvider.functions.ts`：通用 OpenAI 兼容适配器（`/v1/images/generations`、`/v1/images/edits`、`/v1/chat/completions`），支持 T2I / I2I / 多参考图，沿用现有 `requestId` 日志与 `generation_error_logs` 失败落库。
- `src/lib/seedream.functions.ts`：在既有前缀分发链末尾加"动态供应商兜底"——前缀未命中任何内置分支时，查供应商目录，命中则走通用适配器；内置供应商前缀行为完全不变。
- 视频侧同理在 `videoGenerate.functions.ts` 的 `getVideoBackend()` 末尾加动态兜底分支。

## 前端

- `src/routes/admin.providers.tsx`：供应商卡片列表 + 每张卡片内的模型子表（模型名 / 类型 / 能力 / 上架 / 启用 / 排序 / 定价状态）；新增与编辑用 shadcn Dialog（与现有弹窗风格一致，不用原生 prompt）；密钥输入框 `type=password`，编辑时显示 `****1234`、留空表示不修改。
- `src/routes/admin.tsx` 侧栏在「模型定价」之前插入「供应商管理」。
- `src/routes/admin.models.tsx`：模型下拉改为从已上架目录选择（仍允许手填），并对"已上架但未定价"的模型给出提醒条。
- 用户端入口统一改为读接口目录：`NewProjectDialog.tsx`（生图/视频模型）、`RestyleSetupPanel`、工作区模型切换处。新增 `src/hooks/useListedModels.ts`（React Query，`staleTime` 60s）作为唯一数据源；接口异常时回落现有静态列表，保证不空白。
- i18n：`zh.ts` / `en.ts` 同步补齐 `admin_providers_*` 文案。

## 交付顺序

1. SQL 迁移脚本（`supabase/manual/` 内产出，交由老板执行）+ 加密密钥
2. 服务端函数与加密工具 + 单元测试（加解密往返、目录过滤、前缀路由兜底）
3. 后台供应商管理页 + 侧栏 + 定价页联动
4. 用户端目录 hook 接入四处入口 + 静态回落
5. `bun run lint` / `bunx vitest run` 校验
