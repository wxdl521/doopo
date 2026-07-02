# 团队协作 + 积分分配系统 — 任务清单

> 项目：Doopoo AI Creative Studio
> 分支：main
> 开始日期：2026-07-02

---

## 任务总览

| # | 任务 | 涉及文件 | 依赖 |
|---|------|---------|------|
| 1 | 数据库迁移脚本 | `supabase/migrations/XXXXXX_team_system.sql` | — |
| 2 | Server Functions | `src/lib/teams.functions.ts` + `teamMembers.functions.ts` + `teamCredits.functions.ts` | 1 |
| 3 | 「我的团队」页面 | `src/routes/my-team.tsx` | 2 |
| 4 | 管理端布局框架 | `src/routes/team/$teamId/manage.tsx` | 2 |
| 5 | 成员管理 Tab | `src/components/team/MembersTab.tsx` | 4 |
| 6 | 积分分配/回收弹窗 | `src/components/team/CreditManageDialog.tsx` | 5 |
| 7 | 积分记录 Tab | `src/components/team/CreditsHistoryTab.tsx` | 4 |
| 8 | 设置 Tab | `src/components/team/SettingsTab.tsx` | 4 |
| 9 | i18n 翻译同步 | `src/i18n/zh.ts` + `src/i18n/en.ts` | 3-8 |

---

## 详细任务

### 1. 数据库迁移脚本

**文件**：`supabase/migrations/XXXXXX_team_system.sql`

创建 4 张表：

- **`teams`** — 团队主表
  - `id` UUID PK, `name` TEXT, `description` TEXT, `owner_id` UUID FK→auth.users
  - `created_at`, `updated_at`, `deleted_at`（软删除）

- **`team_members`** — 成员关系
  - `id` UUID PK, `team_id` FK→teams, `user_id` FK→auth.users
  - `role` TEXT ('owner'/'admin'/'member')
  - `credits_balance` INTEGER, `subscription_credits` INTEGER
  - `joined_at`, `invited_by` FK→auth.users
  - UNIQUE(team_id, user_id)

- **`credit_transactions`** — 积分流水
  - `id` UUID PK, `team_id`, `user_id`, `type` TEXT, `amount` INTEGER
  - `balance_after` INTEGER, `operator_id`, `source_type` TEXT, `description` TEXT, `created_at`

- **`transfer_records`** — 转账明细
  - `id` UUID PK, `team_id`, `from_user_id`, `to_user_id`, `amount` INTEGER
  - `from_balance_after`, `to_balance_after`, `operator_id`, `created_at`

还需：RLS 策略 + 索引 + 删除团队退款 Supabase Function

---

### 2. Server Functions（API 层）

**文件**：
- `src/lib/teams.functions.ts` — 创建/更新/查询详情/我的团队列表
- `src/lib/teamMembers.functions.ts` — 成员列表/修改角色/移除/离开/邀请/加入
- `src/lib/teamCredits.functions.ts` — 分配/回收/转账/流水/转账记录/余额

模式：`createServerFn({ method: "POST" })` + Zod 校验 + `requireSupabaseAuth`

---

### 3. 「我的团队」页面

**文件**：`src/routes/my-team.tsx`

- 团队规则说明（3 条固定文案）
- 当前团队卡片（名称/角色/创建时间）
- 「管理团队」按钮（owner/admin 可见）
- 「离开团队」按钮（非 owner，二次确认）
- 无团队空状态

---

### 4. 管理端布局框架

**文件**：`src/routes/team/$teamId/manage.tsx`

- 顶部团队信息栏
- 三 Tab：成员管理 / 积分记录 / 设置
- Tab 切换逻辑

---

### 5. 成员管理 Tab

**文件**：`src/components/team/MembersTab.tsx`

- 表格：头像+昵称 / 邮箱 / 角色下拉 / 积分 / 加入时间 / 操作
- 角色切换（权限控制）
- 分配/回收按钮 + 删除按钮
- 「邀请成员」按钮

---

### 6. 积分分配/回收弹窗

**文件**：`src/components/team/CreditManageDialog.tsx`

- 团队剩余积分 + 成员积分展示
- 分配/回收切换
- 数量输入 + 约束校验 + 确认

---

### 7. 积分记录 Tab

**文件**：`src/components/team/CreditsHistoryTab.tsx`

- 积分记录列表（credit_transactions）
- 转账记录列表（transfer_records）
- 团队剩余积分 + 转入入口 + 分页

---

### 8. 设置 Tab

**文件**：`src/components/team/SettingsTab.tsx`

- 编辑名称/描述 + 保存
- 「解散团队」红色按钮 → 输入名称确认 → 最终弹窗

---

### 9. i18n 翻译同步

**文件**：`src/i18n/zh.ts` + `src/i18n/en.ts`

---

## 路由规划

```
src/routes/
├── my-team.tsx                     # 成员端
└── team/$teamId/manage.tsx         # 管理端（三 Tab）
```

## 组件规划

```
src/components/team/
├── MembersTab.tsx                  # 成员管理
├── CreditManageDialog.tsx          # 积分弹窗
├── CreditsHistoryTab.tsx           # 积分记录
├── SettingsTab.tsx                 # 设置
└── TeamInfoBar.tsx                 # 团队信息栏
```

## 验证

1. `bun run dev` — 页面渲染正常
2. `/my-team` — 成员端
3. `/team/{id}/manage` — 管理端三 Tab 切换
4. `bun run lint && bun run format` — 通过
5. `bun run build` — 构建成功
