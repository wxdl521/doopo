# 邀请好友 · 充值返现 5%

在账户中心新增「邀请好友」页面：生成专属邀请链接，好友通过链接注册后建立绑定关系；好友**首次**积分到账（个人发放或团队发放）时，双方各获得该笔金额 **5%** 的积分返现。

## 用户流程

```text
我 → /account/referral → 复制邀请链接 (…/register?ref=XXXXXX)
好友打开链接 → 注册 → 首次登录时自动绑定「邀请关系」
管理员给好友（或其团队）发放 100 积分
   → 好友 +5 积分，我 +5 积分（各写一条「邀请返现」流水）
   → 该好友后续再到账不再返现（仅首次）
邀请页可看到：已邀请人数 / 已返现人数 / 累计返现积分 / 好友列表
```

## 规则

- 仅首次到账触发，每位好友最多返现一次；返现基数为该笔到账金额，5% 向下取整（不足 1 分不返）。
- 个人钱包发放与团队发放都算；团队发放按「团队所有者」为被邀请人判定。
- 不能自己邀请自己；已被邀请过或已有积分流水的老账号不再绑定。
- 返现积分与普通积分等价，可直接消耗。

## 技术方案

### 数据库（迁移）

- `public.referral_codes(user_id, code unique, created_at)` — 6~8 位大写字母数字码，首次访问邀请页时懒生成。
- `public.referrals(id, inviter_id, invitee_id unique, code, status[pending|rewarded], reward_amount, rewarded_at, created_at)`。
- GRANT + RLS：本人可读自己作为 inviter 或 invitee 的行；写入统一走 SECURITY DEFINER 函数，客户端不可直接 INSERT/UPDATE。
- 函数：
  - `ensure_referral_code()` → 返回当前用户邀请码（不存在则生成）。
  - `bind_referral(p_code text)` → 校验非自邀、无重复绑定、账号无历史积分流水，写 pending 行。
  - `apply_referral_cashback(p_invitee uuid, p_amount numeric)`（内部）→ 命中 pending 行则给双方钱包各加 `floor(amount*0.05)`，写 `user_credit_transactions`（type=`referral_cashback`），把行标记为 rewarded；幂等。
  - 修改 `admin_grant_credits`：用户分支用目标用户、团队分支用团队所有者，成功后调用 `apply_referral_cashback`。

### 服务端函数（`src/lib/referral.functions.ts`）

- `getMyReferralOverview`（requireSupabaseAuth）：邀请码、邀请链接、统计与好友列表（邮箱脱敏，经 SECURITY DEFINER 读 `auth.users`）。
- `bindReferralCode`（requireSupabaseAuth）：调用 `bind_referral`，失败静默返回原因。

### 前端

- `src/routes/register.tsx`：读取 `?ref=`（`useSearch`），存 `sessionStorage`，并写入 `signUp` 的 `options.data.referral_code`。
- 登录后入口（`src/hooks/useAuth.ts` 之外，在 `MainLayout` 或 `account` 布局挂一次性 effect）：有 session 且本地存在待绑定 code → 调 `bindReferralCode` 后清除。
- 新页面 `src/routes/account.referral.tsx`：邀请链接输入框 + 复制按钮、二维码可后续再加、4 个统计卡（已邀请 / 已返现 / 累计返现积分 / 返现比例 5%）、好友列表表格（脱敏邮箱、注册时间、状态、返现积分）。
- `src/routes/account.tsx` 侧边栏在「积分与奖励」下新增「邀请好友」（`UserPlus` 图标）。
- `src/routes/account.rewards.tsx` 的 `TYPE_LABEL` 增加 `referral_cashback: "邀请返现"`。
- i18n：`zh.ts` / `en.ts` 同步补齐 ~15 个文案键。

### 顺序

1. 迁移（表 + 函数 + 改 `admin_grant_credits`）→ 2. 服务端函数 → 3. 注册链路带参与绑定 → 4. 邀请页与侧边栏 → 5. i18n 与流水类型文案。
