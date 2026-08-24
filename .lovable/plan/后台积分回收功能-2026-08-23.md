# 后台积分回收功能

在管理后台「积分发放」中，增加与发放对称的**积分回收**能力，便于发错积分时收回后重新发放。

## 功能设计

- 侧边操作卡从单一「发放」改为「发放 / 回收」两个模式切换（与团队积分弹窗的分配/回收交互一致）。
- 选中用户或团队后，输入数量与备注，点击确认执行。
- 回收前二次确认（沿用现有 `useConfirmDialog`），提示将从目标扣除多少积分。
- 余额不足时明确报错「可回收积分不足」，不允许扣成负数。
- 回收成功后刷新列表余额，并写入积分流水（类型 `admin_revoke`，金额为负），后台流水明细与用户「积分与奖励」页面均可见。

### 用户 / 团队的回收口径

- 用户：直接从该用户钱包扣除。
- 团队：从团队所有者钱包扣除（与现有发放口径一致，发放也是打给所有者），并同时写团队流水。

## 技术方案

1. 数据库迁移：新增 `public.admin_revoke_credits(p_target_type, p_target_id, p_amount, p_description)`，SECURITY DEFINER，`search_path = public`，开头调用 `public.assert_credit_admin()`；对目标钱包行加锁校验余额，扣减后写 `user_credit_transactions`（团队时另写 `credit_transactions`），返回扣减后余额。执行权限仅授予 `authenticated`，撤销 `anon`/`public`。
2. `src/lib/adminCredits.functions.ts`：新增 `revokeAdminCredits` 服务端函数，复用 `requireSupabaseAuth` + `hasCreditAdminAccess` 校验，Zod 校验输入后调用上述 RPC。
3. `src/routes/admin.credits.tsx`：操作卡增加模式切换按钮与回收提交逻辑；按钮文案、成功/失败提示按模式区分。
4. i18n：在 `src/i18n/zh.ts` 与 `en.ts` 同步新增回收相关文案键（模式切换、确认弹窗、成功/失败、余额不足）。

## 实施顺序

先提交数据库迁移（需你确认执行），迁移通过后再改服务端函数与前端页面。
