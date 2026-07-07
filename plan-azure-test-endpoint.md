# 接入新 Azure 测试实例（Azure AI Foundry 新格式）

## 背景与关键差异

用户提供了新的 Azure 图像生成 endpoint：

- URL：`https://0528-aoai-sc-87d.services.ai.azure.com/openai/v1/images/generations`
- API Key：已收到（将写入 `.env.local`，不进代码、不进 git）

**关键差异**：这个 endpoint 是 **Azure AI Foundry 新格式**（域名 `*.services.ai.azure.com` + 路径 `/openai/v1/...`），与现有两个 Azure 实例的 **deployment-based 路径**不同：

| | 现有 azure / azure2 | 新 azure3 |
|---|---|---|
| 域名 | `cognitiveservices.azure.com` / `openai.azure.com` | `services.ai.azure.com` |
| T2I 路径 | `/openai/deployments/{dep}/images/generations?api-version=X` | `/openai/v1/images/generations` |
| I2I 路径 | `/openai/deployments/{dep}/images/edits?api-version=X` | `/openai/v1/images/edits` |
| api-version | 必需（query） | 不需要 |
| model 字段 | 不需要（路径含 deployment） | 需要（body/form 里带 `model`） |
| 认证头 | `api-key: <key>` | `api-key: <key>`（一致） |

所以**不能完全照搬现有逻辑**，需在 `callAzureImage` 里为 `azure3` 新增一个路径分支。响应格式仍是 OpenAI 兼容的 `{data:[{b64_json|url}]}`，现有解析逻辑可复用。

## 设计

- 前缀：`azure3/`，model key = `azure3/gpt-image-2`
- UI 命名：**Azure（测试）**（用户指定）
- env：`AZURE3_API_KEY` + `AZURE3_BASE_URL`（沿用 azure2 的双 env 模式）
- model 字段值：取 `stripAzurePrefix` 后的 `gpt-image-2`（**假设**：AI Foundry 部署名 = gpt-image-2；若实际不同，改 model key 为 `azure3/<实际部署名>` 即可，label 不变）

## 修改清单（7 个文件）

### 1. `src/lib/azureImage.functions.ts`（核心）
- 加 `AZURE3_PREFIX = "azure3/"`
- `isAzureModel`、`stripAzurePrefix`（正则 `azure|azure2|azure3`）纳入 azure3
- 加 `isAzure3Model`
- `getAzureConfig` 加 azure3 分支 → `AZURE3_API_KEY` / `AZURE3_BASE_URL`
- `callAzureImage` 增加路径分支：azure3 时
  - T2I：`POST {base}/openai/v1/images/generations`，JSON body 加 `model` 字段，**不带** `api-version`
  - I2I：`POST {base}/openai/v1/images/edits`，multipart form 加 `model` 字段
  - 认证头、重试、meta、响应解析全部复用现有逻辑
- 更新顶部注释，说明 azure3 走 AI Foundry v1 路径

### 2. `src/lib/seedream.functions.ts`（路由分发，6 处）
- 6 个分发点（行 ~311/927/1278/1623/2121/2850）的 `azure2/` 检查旁加 `azure3/`，使其委派到 `callAzureImage`

### 3. `src/lib/imageModels.ts`（模型目录）
- 在 azure2 条目后新增分组与选项：
  - `key: "azure3/gpt-image-2"`, `label: "Azure（测试）"`, `sub: "[Azure AI Foundry] gpt-image-2 · T2I/I2I"`

### 4. `src/components/NewProjectDialog.tsx`（新建项目选模型）
- 在 azure2 选项后加 `azure3/gpt-image-2` 同结构条目
- **不**加入 `IMAGE_RECOMMENDED_PREFIXES`（测试实例不进推荐位）

### 5. `src/pages/Models.tsx`（模型展示页）
- 在 azure2 卡片后加 azure3 展示卡片

### 6. `src/lib/visualStyles.ts`（模型白名单校验）
- `VALID_T2I_MODELS`、`VALID_I2I_MODELS` 集合加 `azure3/gpt-image-2`
- `KNOWN_MODEL_PREFIXES` 加 `azure3/`

### 7. `.env.local`（本地环境变量，安全）
- 已确认 `.gitignore` 第 17 行 `*.local` 覆盖 `.env.local`，不会被 git 跟踪
- 追加：
  ```
  # ---- Azure AI Foundry 测试(gpt-image-2)----
  AZURE3_API_KEY=<用户提供的 key>
  AZURE3_BASE_URL=https://0528-aoai-sc-87d.services.ai.azure.com
  ```

## 不做的事
- 不改 `routeTree.gen.ts`（自动生成）
- 不加测试（现有 azure 亦无单测，保持一致；如需可后续补）
- 不把 azure3 加入推荐名单

## 生产部署提醒（实现后告知用户）
- `.env.local` 仅本地 dev；生产 Cloudflare Workers 需配置 secret：
  `bunx wrangler secret put AZURE3_API_KEY` 和 `AZURE3_BASE_URL`

## 验证方式
- `bun run lint` 通过
- 本地 dev 选「Azure（测试）」生成一张图，确认 200 + 返回图片
