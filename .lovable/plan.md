
## 目标

`/account/rewards`（积分与奖励）当前全部使用 `mockRewards` 假数据（余额、累计获得、等级、进度条、明细表）。改为读取当前登录用户的真实积分与流水，与顶部导航栏、`/account/credits` 页保持一致、实时同步。

## 现状核对（已核验）

- 真实积分余额来源：`public.user_wallets.credits_balance`（`getUserBalance` 已封装）。
- 真实流水来源：`public.user_credit_transactions`，字段含 `type / amount / balance_after / model / resolution / duration / description / created_at`（`getUserCreditTransactions` 已封装）。
- 现有 `type` 取值：`consume / recharge / admin_grant / admin_reclaim / team_allocate / team_reclaim`（无 `earn / cashout` 之类奖励语义，产品尚无“获赞奖励 / 提现”功能）。
- `account.credits.tsx` 已经用这两个 server fn 正确渲染余额 + 明细，可作为参考实现。
- `account.rewards.tsx` 里的“等级 / 等级进度 / 满 500 分可提现”是纯装饰文案，与后端无对应数据。

## 改动方案

### 1. 新增一个聚合查询 server fn（`src/lib/userCredits.functions.ts`）

新增 `getUserCreditSummary`：
- 用当前用户 token 查 `user_wallets.credits_balance` → `balance`
- 汇总 `user_credit_transactions` 中该用户 `amount > 0` 的记录 → `lifetimeEarned`（含充值、管理员发放等所有入账）
- 汇总 `amount < 0` 的绝对值 → `lifetimeSpent`
- 返回 `{ balance, lifetimeEarned, lifetimeSpent }`
- 使用现有 `requireSupabaseAuth` 中间件；RLS 已限制只查自己。

### 2. 重写 `src/routes/account.rewards.tsx`

- 移除对 `mockRewards` 的所有依赖。
- 顶部三张 StatCard 改为：
  - 余额 → `balance`（真实值，加载中显示 `...`）
  - 累计获得 → `lifetimeEarned`
  - 累计消耗 → `lifetimeSpent`（替换掉“等级 / 社区前 8%”这类无后端支撑的假指标）
- 删除“等级进度”卡片（当前没有真实等级体系，保留只会继续误导）。
- 明细表改为读取 `getUserCreditTransactions`（复用 credits 页的 20 条/页分页交互）：
  - 列：日期 / 描述（description / model / resolution / duration 组合，与 credits 页一致） / 类型 / 积分变动
  - 类型显示按真实 `type` 做一次中文映射：`recharge=充值`、`consume=消耗`、`admin_grant=系统发放`、`admin_reclaim=系统回收`、`team_allocate=团队分配`、`team_reclaim=团队回收`、`team_transfer_in/out=团队转账`
  - 正数绿色、负数橙红，与现有配色一致
- 页面副标题改为客观描述（例如“查看你的积分余额与全部收支明细”），不再承诺“满 500 可提现”。

### 3. 实时性

- 页面挂载即拉取；用户在其他页面（充值、生成图）产生变动后，回到此页会重新触发 `useEffect`，与 `/account/credits` 行为一致。
- 顶部导航栏的余额已由各自的 hook 拉取，不在本次范围内改动。

### 4. 验证

- 用真实账号访问 `/account/rewards`：
  - 三张卡片值 = SQL 手动核对（`user_wallets.credits_balance`、`SUM(amount) FILTER (WHERE amount>0)`、`SUM(-amount) FILTER (WHERE amount<0)`）。
  - 明细分页翻页、类型/描述/时间显示正确。
  - 与 `/account/credits` 的余额、最新一条流水完全一致。
- 新账号（无流水）：三张卡片显示 0，表格显示空状态文案。

## 不改动

- `mockRewards` 数据结构本身保留在 `src/data/mock/index.ts`（其它演示位可能引用），本次仅是页面不再使用。
- 顶部导航、`/account/credits`、i18n 键、后端 RPC、其它路由均不变。
