## 目标

让用户把保存的内容（剧本、单独的角色/场景/道具、漫剧）发布到社区，在首页新增「社区精选」区与独立 `/community` 页面展示，登录用户可点赞（每人每作品一次），所有访问自动计数浏览量。原 Showcase 保留为官方示例。

## 信息架构

```text
首页 /home
├── Hero
├── 最近项目
├── 社区精选（NEW · 最新6条 community_posts where visibility='public'）
└── 官方示例 Showcase（保留现有 mock）

/community            社区作品列表（公开 + 排序：最新 / 最热 / 点赞）
/community/$postId    社区作品详情（公开 或 链接可见）
/account/posts        我的发布（管理可见性 / 删除）
```

## 数据模型

新增 3 张表：

**community_posts** — 通用作品载体
- `id uuid PK`、`user_id uuid not null`
- `kind text not null` — `'script' | 'character' | 'scene' | 'prop' | 'comic'`
- `source_id text` — 关联 `scripts.id` 或资产 id（可空，资产可直接序列化进 payload）
- `title text`、`summary text`、`cover_gradient text`
- `payload jsonb not null` — 快照内容（避免源被删除后失效）
- `visibility text not null default 'private'` — `'public' | 'unlisted' | 'private'`
- `likes_count int not null default 0`、`views_count int not null default 0`
- `created_at` / `updated_at`

**post_likes** — `(post_id, user_id)` 复合唯一，触发器维护 `likes_count`

**post_views** — 仅 `(post_id, viewer_key, viewed_at)`，`viewer_key` = user_id 或匿名 session id；按天去重后累加 `views_count`

### RLS

- `community_posts`：
  - SELECT：`visibility='public'` 任何人可读；`unlisted` 任何人可读（靠 URL 难猜）；`private` 仅 owner
  - INSERT/UPDATE/DELETE：`auth.uid() = user_id`
- `post_likes`：SELECT 公开；INSERT/DELETE 仅本人
- `post_views`：INSERT 公开（含匿名）；SELECT 仅 owner（用于将来统计）

计数通过 AFTER INSERT/DELETE 触发器原子更新 `community_posts.likes_count` / `views_count`。

## Server Functions（`src/lib/community.functions.ts`）

- `publishPost({ kind, sourceId?, title, summary, coverGradient, payload, visibility })` — 需登录；写入 `community_posts`
- `updatePostVisibility({ id, visibility })` — owner
- `deletePost({ id })` — owner
- `listCommunityPosts({ sort: 'recent'|'hot'|'likes', limit, kind? })` — 公开（用 admin client，仅查 `visibility='public'` 与白名单列）
- `getPost({ id })` — 公开（`public` 或 `unlisted` 均返回；`private` 仅 owner）
- `toggleLike({ postId })` — 需登录，返回 `{ liked, likesCount }`
- `recordView({ postId })` — 公开（按天 + viewer_key 去重）
- `listMyPosts()` — 需登录

公开读取端点用 `supabaseAdmin` 加 WHERE 限定，避免对未登录用户依赖 RLS bearer。

## UI 改动

1. **`src/components/community/ShareDialog.tsx`**（新）
   - 选择可见性（公开 / 仅链接 / 私有）
   - 编辑标题、简介
   - 提交后展示作品链接 `/community/{id}`（可复制）

2. **入口按钮**
   - 剧本卡片 + 剧本详情页（`src/pages/Scripts.tsx`、`src/routes/scripts.$scriptId.tsx`）：「分享到社区」
   - 角色/场景/道具卡片（`src/pages/Characters.tsx`、`AssetsLibrary.tsx`）：单条「分享」按钮
   - 漫剧（workspace 输出）：导出后「分享到社区」

3. **`src/components/community/CommunityCard.tsx`**（新）
   - 复用现有 ShowcaseCard 视觉风格
   - 显示 kind 角标、标题、作者、♥ likes · 👁 views

4. **首页 `src/pages/Home.tsx`**
   - 在「最近项目」与原 Showcase 之间新增 `社区精选` 区，调 `listCommunityPosts({ sort: 'hot', limit: 6 })`

5. **新路由**
   - `src/routes/community.tsx`（layout + Outlet）
   - `src/routes/community.index.tsx`（列表 + 排序 tabs + kind 过滤）
   - `src/routes/community.$postId.tsx`（详情：渲染 payload 快照；按 kind 切换布局；点赞按钮调 `toggleLike`；mount 时 `recordView`）

6. **`src/routes/account.posts.tsx`**（新）—— 我的发布管理（改可见性 / 删除）

7. 原 `/showcase` 与首页 `Showcase` 区不动，保留 mock 官方示例。

## 交互细节

- 未登录点赞：toast「请先登录」+ 跳 `/login`
- visibility=private 链接被外部访问：显示「该作品未公开」
- payload 快照在 publish 时序列化（深拷贝），后续删除原剧本不影响社区展示
- 排序「最热」= `(likes_count * 3 + views_count) / pow(hours_since_created + 2, 1.2)` 在 server fn 内计算

## 任务拆分

1. migration：3 张表 + 触发器 + RLS
2. `community.functions.ts` 全套 server fn
3. ShareDialog 组件 + 在剧本/角色/场景/道具/漫剧入口接线
4. CommunityCard + `/community` 路由（列表 + 详情 + 排序）
5. 首页新增「社区精选」区
6. `/account/posts` 管理页 + Header 入口
7. 详情页 mount 时 `recordView`、点赞乐观更新

完成后可发布。