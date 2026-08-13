# 管理后台：用户列表增加密码重置 / 启用 / 停用

在「积分分配」的用户与团队列表右侧「操作」列补齐管理动作，让管理员可以直接重置密码、停用或恢复账号。

## 交互设计

用户列表（注册用户 Tab）每行「操作」列新增三个动作：

- 重置密码：弹窗输入新密码（≥8 位，二次确认），确认后立即生效；弹窗内另提供「改为发送重置邮件」选项，只发链接不改密码。
- 停用：二次确认弹窗，停用后该用户无法登录（长期封禁）。
- 启用：对已停用用户显示，一键解除封禁。

行内新增「状态」徽标（正常 / 已停用），停用行整体降低透明度。

团队 Tab：团队本身没有登录态，操作列对团队展示其所有者（owner）账号的同样三个动作，作用对象是所有者用户；表头提示「操作对象为团队所有者」。

所有动作走确认弹窗（沿用项目已有的 AlertDialog / useConfirmDialog 风格），结果用 toast 提示，成功后刷新列表。

## 技术方案

新增 `src/lib/adminUsers.functions.ts`（服务端函数，全部先用现有 `is_credit_admin()` RPC 校验管理员身份，再在 handler 内 `await import("@/integrations/supabase/client.server")` 取 supabaseAdmin）：

- `getAdminUserStatuses({ userIds })`：用 Auth Admin API 逐个 `getUserById`，返回 `{ id, banned, email, lastSignInAt }`，供列表渲染状态徽标。
- `adminResetUserPassword({ userId, newPassword })`：`auth.admin.updateUserById(userId, { password })`。
- `adminSendPasswordResetEmail({ email })`：`auth.admin.generateLink({ type: "recovery" })`，走现有邮件通道。
- `adminSetUserBanned({ userId, banned })`：`updateUserById(userId, { ban_duration: banned ? "876000h" : "none" })`。
- 自我保护：禁止管理员停用/重置自己的账号；禁止对其他管理员（`admin_users` 中存在）执行停用。

前端改动：

- `src/routes/admin.credits.tsx`：表格增加「状态」「操作」两列；页面加载后批量拉取本页用户状态；新增 `AdminUserActionsDialog` 组件承载密码重置表单与停用/启用确认。
- 团队行需要所有者 userId — 现有 `admin_list_credit_recipients` 只返回团队 id 与所有者邮箱，因此新增服务端函数 `getTeamOwnerIds({ teamIds })`，用 supabaseAdmin 从 `teams.owner_id` 读取（无需改数据库）。
- i18n：在 `src/i18n/zh.ts` 与 `en.ts` 同步新增 `admin_user_*` 文案键。

无需数据库迁移：封禁状态与密码均由 Supabase Auth 管理，不新增表或 RLS 策略。

## 安全边界

- 每个函数入口独立校验 `is_credit_admin()`，不依赖前端隐藏按钮。
- 新密码只在请求体内传输，不落库、不写日志；错误日志只记录 userId 与失败原因。
