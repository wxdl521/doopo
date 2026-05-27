# Doopoo 前端接口全量文档

> 本项目所有服务端逻辑通过 **TanStack `createServerFn`** 暴露（typed RPC，前端 `useServerFn(fn)` 调用），全部走 `POST /_serverFn/<name>`（`method: 'GET'` 的会走 GET）。  
> 鉴权：标注 🔒 的接口启用 `requireSupabaseAuth` 中间件，前端通过 `attachSupabaseAuth` 自动附带 `Authorization: Bearer <access_token>`，RLS 在 Supabase 侧按 `auth.uid()` 校验。  
> 数据源：Supabase（表 `projects / scripts / characters / scenes / community_posts / post_likes / post_views`），OpenRouter，DashScope（通义千问 / Wan 系列），Lovable AI Gateway。

---

## 一、项目（Projects）— `src/lib/projects.functions.ts`

| 名称 | 鉴权 | 入参（zod） | 出参 | 说明 |
|---|---|---|---|---|
| `upsertProject` | 🔒 | `{ id, name?, aspect?, storyboardModel?, sceneModel?, videoModel?, audio?('auto'\|'on'\|'off'), workflow?, style?, customCover? }` | `{ ok:true } \| { ok:false, error }` | upsert 到 `projects`（`onConflict:'id'`），由"新建项目弹窗"与工作区配置保存调用 |
| `getProject` | 🔒 | `{ id }` | `{ project: ProjectConfigRow \| null, error }` | 加载工作区配置 |

---

## 二、剧本本地存储（Scripts CRUD）— `src/lib/scripts.functions.ts`

| 名称 | 鉴权 | 入参 | 出参 | 说明 |
|---|---|---|---|---|
| `listScriptsRemote` (GET) | 🔒 | — | `Script[]` | 列出当前用户全部剧本 |
| `getScriptRemote` | 🔒 | `{ id }` | `Script \| null` | 加载单个剧本 |
| `upsertScriptRemote` | 🔒 | `{ script: { id,title,type?,genre?,tone?,payload,... } }` | `{ ok:true }` | 创建/更新剧本，`payload` 为 jsonb |
| `deleteScriptRemote` | 🔒 | `{ id }` | `{ ok:true }` | 删除剧本 |

---

## 三、剧本管线（结构化生成）— `src/lib/scriptPipeline.functions.ts`

底层走 OpenRouter `chat/completions` + tool-calling，按 `model` 字段优先回退到默认模型列表。

| 名称 | 入参核心字段 | 出参 | 用途 |
|---|---|---|---|
| `genLogline` | `{ lang('zh'\|'en'), type, genre, tone, theme, plot, model? }` | `{ logline, premise, themes[] }` | 一句话剧情 + 主题 |
| `genOutline` | `{ lang, type, genre, tone, logline, premise?, model? }` | `{ acts: [{title, beats[3-5]}] *3 }` | 三幕结构大纲 |
| `genScenes` | `{ lang, type, genre, tone, logline, acts[], sceneCount(3-12,默认5), knownCharacters?, model? }` | `{ scenes: PipelineScene[] }` | 分场（含 slug / location / timeOfDay / action / beats / dialogue） |
| `genCharacters` | `{ lang, logline, scenes?, model? }` | `{ characters: [{name, role, roleLabel, age?, look, personality, motivation, palette[3-4]}] }` | 角色卡 3-6 个 |
| `rewriteScene` | `{ lang, scene, instruction(<=500), model? }` | `{ scene: PipelineScene }` | 按指令重写单场 |

---

## 四、剧本智能体（流式 Markdown）— `src/lib/scriptAgent.functions.ts`

handler 为 **async generator**，前端以异步迭代消费 `{ delta?, done?, text?, error? }`。

| 名称 | 入参 | yield | 说明 |
|---|---|---|---|
| `streamSynopsis` | `{ lang, type, genre, tone, theme, plot, expectedEpisodes(1-200,默认100), totalMinutes(5-600,默认90), model? }` | 增量文本 | 输出 6 段式短剧故事梗概（Markdown） |
| `streamEpisodeScenes` | `{ lang, epIndex(1-200), sceneCount(3-40,默认16), synopsisText, model? }` | 增量文本 | 输出第 N 集分镜散文 + 钩子 |
| `refineSynopsis` | `{ lang, currentSynopsis, instruction, history?:[{role,content}]*<=12, model? }` | 增量文本 | 基于指令重写整份梗概 |

---

## 五、工作区舞台 AI — `src/lib/aiGenerate.functions.ts`

| 名称 | 入参 | 出参 | 说明 |
|---|---|---|---|
| `generateStageAi` | `{ stage:'canvas'\|'script'\|'character'\|'storyboard'\|'timeline', userPrompt(1-4000), context?:{ logline?, acts?, scenes?, characters? } }` | 各 stage 的结构化结果（logline/acts/scenes/characters/timeline 等） | 工作区按阶段联动生成；底层 OpenRouter tool-calling |

---

## 六、图像生成 — `src/lib/openrouterImage.functions.ts`

多渠道回退链：**请求模型 → DashScope 同族降级（max → plus → base）→ Lovable AI Gateway（Gemini 3.1 Flash Image）→ OpenRouter（Gemini）**。

| 名称 | 入参 | 出参 | 说明 |
|---|---|---|---|
| `generateImage` | `{ prompt, model?, size? }` | `{ url, model, error? }`（`url` 为 https 或 `data:image/png;base64,...`） | 角色/场景/封面图生成 |
| `probeImageModels` | — | `{ healthy[], blocked[], cached }` | 探测 OpenRouter 图像模型可用性（带 10min 缓存） |

支持模型见 `src/lib/imageModels.ts`：Gemini 3.1 Flash Image、`qwen-image-{max,plus,2.0,2.0-pro}`、`wan2.6-t2i`、`wan2.5-t2i-preview`、`wan2.2-t2i-{flash,plus}`、`wanx2.{0,1}-t2i-{turbo,plus}` 等。

---

## 七、纯文本生成（通用兜底）— `src/lib/openrouter.functions.ts`

| 名称 | 入参 | 出参 | 说明 |
|---|---|---|---|
| `generateScript` | `{ messages:[{role,content}], model?, max_tokens?(默认2000), temperature?(默认0.85) }` | `{ content, error }` | 直通 OpenRouter `chat/completions`，回退链：requested → `google/gemini-2.5-flash` → `deepseek-chat-v3.1` → `llama-3.3-70b-instruct` |

---

## 八、社区（Community）— `src/lib/community.functions.ts`

| 名称 | 鉴权 | 入参 | 出参 | 说明 |
|---|---|---|---|---|
| `publishPost` | 🔒 | `{ kind:'script'\|'character'\|'scene'\|'prop'\|'comic', sourceId?, title, summary?, coverGradient?, payload, visibility:'public'\|'unlisted'\|'private' }` | `CommunityPost` | 发布作品 |
| `updatePostVisibility` | 🔒 | `{ id(uuid), visibility }` | `{ ok:true }` | 调整可见性 |
| `deletePost` | 🔒 | `{ id }` | `{ ok:true }` | 删除自己的作品 |
| `listCommunityPosts` (GET) | — | `{ sort:'recent'\|'hot'\|'likes'(默认recent), limit(1-60,默认24), kind? }` | `CommunityPost[]`（不含 payload） | 公共列表；`hot` 按 `(likes*3+views)/(hours+2)^1.2` 在应用层重排 |
| `getPost` | — | `{ id }` | `CommunityPost \| null` | 公共/未列出可读 |
| `toggleLike` | 🔒 | `{ postId }` | `{ liked, likesCount }` | 点赞/取消 |
| `isLiked` | 🔒 | `{ postId }` | `{ liked }` | 当前用户是否已赞 |
| `recordView` | — | `{ postId, viewerKey(4-128) }` | `{ ok:true }` | 记录浏览（按天去重，走 admin client 绕过 RLS） |
| `listMyPosts` (GET) | 🔒 | — | `CommunityPost[]` | 我的发布 |

---

## 九、底层第三方 HTTP（服务端发起，不直接面向前端）

| 服务 | 端点 | 用途 | 凭据 |
|---|---|---|---|
| OpenRouter | `POST https://openrouter.ai/api/v1/chat/completions` | 文本 / 工具调用 / 图像兜底 | `OPENROUTER_API_KEY` |
| DashScope 异步图像 | `POST https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis`（`X-DashScope-Async: enable`） | qwen-image-* / wan* 提交任务 | `Qwen` 或 `DASHSCOPE_API_KEY` |
| DashScope 任务查询 | `GET https://dashscope.aliyuncs.com/api/v1/tasks/{task_id}` | 轮询任务结果 | 同上 |
| DashScope 多模态同步 | `POST .../aigc/multimodal-generation/generation` | 部分 wan 同步模型 | 同上 |
| Lovable AI Gateway | `POST https://ai.gateway.lovable.dev/v1/chat/completions` | Gemini 图像兜底 | `LOVABLE_API_KEY` |
| Supabase | PostgREST / Auth | 业务数据读写 | publishable + 用户 JWT；服务端任务用 `service_role` |

---

## 十、环境变量

| 变量 | 用途 |
|---|---|
| `OPENROUTER_API_KEY` | OpenRouter 文本/图像 |
| `Qwen` / `DASHSCOPE_API_KEY` | 阿里 DashScope（通义千问、Wan） |
| `LOVABLE_API_KEY` | Lovable AI Gateway（图像兜底） |
| `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | Supabase 服务端 |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` | 浏览器 Supabase 客户端（自动注入） |

---

## 十一、调用示例（前端）

```ts
import { useServerFn } from '@tanstack/react-start'
import { upsertProject, getProject } from '@/lib/projects.functions'
import { generateImage } from '@/lib/openrouterImage.functions'
import { streamSynopsis } from '@/lib/scriptAgent.functions'

const save = useServerFn(upsertProject)
await save({ data: { id, name, sceneModel: 'qwen-image-max', aspect: '16:9' } })

const img = await useServerFn(generateImage)({ data: { prompt, model: 'qwen-image-max' } })

// 流式
const stream = useServerFn(streamSynopsis)
for await (const chunk of await stream({ data: { lang:'zh', type:'short', genre:'都市', tone:'爽剧', theme, plot, expectedEpisodes:60, totalMinutes:90 } })) {
  if (chunk.delta) appendText(chunk.delta)
  if (chunk.done) finalize(chunk.text)
}
```
