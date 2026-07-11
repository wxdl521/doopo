# 模型调用积分消耗 + 个人消耗记录

## 目标
1. 调用指定模型成功才扣积分，失败/超时不扣
2. 个人页面（account.credits）可查看消耗记录
3. 模型选择下拉框标注预计消耗积分

## 决策（已确认）
- 余额 `user_wallets.credits_balance` 改 `numeric(12,2)`（支持 110.4 小数）
- 视频按 duration 比例计费：`cost = 价目表单价 × duration / 10`

## 关联模型 + 价目（其余模型不扣分）

### 生图（按张，固定）
| 前缀 | 积分/张 |
|---|---|
| `tokenflash/` | 5 |
| `revora/` | 4 |
| `azure/` `azure2/` `azure3/` | 9 |

### 视频（每 10 秒单价，按 duration/10 比例）
| 模型 id | 480P | 720P | 1080P |
|---|---|---|---|
| `kuaizi-lizhen-fast` | 89 | 192 | - |
| `kuaizi-lizhen-pro` | 110.4 | 118 | 593 |
| `kuaizi-lizhen-mini` | 56 | 120 | - |
| `doubao-seedance-2-0-fast-260128` | 52 | 114 | - |
| `doubao-seedance-2-0-260128`（正常）| 69 | 146 | - |

> 视频不含 4k；模型+分辨率不在表内 -> 不扣分（如即梦/Kling/HappyHorse/ToAPIs 等）。

## 改动清单

### 1. DB migration（新建 `supabase/migrations/<ts>_credits_consumption.sql`）
- `ALTER TABLE user_wallets ALTER COLUMN credits_balance TYPE numeric(12,2) USING credits_balance::numeric(12,2);`（integer->numeric，无数据丢失）
- 改 `add_user_credits(p_amount numeric)`（参数 int->numeric，兼容现有充值调用）
- 新建 RPC `deduct_user_credits(p_amount numeric, p_description text, p_model text, p_resolution text, p_duration int)` SECURITY DEFINER：
  - 原子扣减：`UPDATE user_wallets SET credits_balance = credits_balance - p_amount WHERE user_id = auth.uid() AND credits_balance >= p_amount RETURNING credits_balance`
  - 返回空 = 余额不足 -> `{ok:false}`；成功 -> INSERT `user_credit_transactions` + `{ok:true, balance_after}`
- 新建表 `user_credit_transactions`：`id, user_id, type(consume/recharge/refund), amount numeric(负=消耗), balance_after numeric, model text, resolution text, duration int, description text, created_at` + RLS（用户只查自己）+ 索引 `(user_id, created_at desc)`
- 本地 `bun run db:push`；生产发 SQL 给老板

### 2. `src/lib/creditsCost.ts`（新建）
- `IMAGE_CREDITS` 前缀表 + `VIDEO_CREDITS` 模型+分辨率表
- `imageCost(model): number | null`（前缀匹配，未命中 null）
- `videoCost(model, resolution, duration): number | null`（单价 × duration / 10，未命中 null）

### 3. `src/lib/authContext.ts`（新建）
- `getOptionalAuthCtx()`：复用 requireSupabaseAuth 逻辑（`getRequest()` + Authorization token + `supabase.auth.getClaims`），返回 `{userId, supabase} | null`（未登录/无效返回 null，**不抛异常**）。供生图 helper 在无法拿到中间件 context 时自助鉴权扣分。

### 4. `src/lib/userCredits.functions.ts`（扩展）
- `chargeCredits(supabase, userId, { amount, model, resolution, duration, description })`：调 `deduct_user_credits` RPC，返回 `{ok, balanceAfter}`（amount>0，RPC 内部转负）。扣失败不抛
- `getUserCreditTransactions(userId, limit, offset)`：查 `user_credit_transactions` 返回记录列表
- `rechargeCredits`：amount validator 保持正数（int 兼容 numeric RPC）

### 5. 生图扣分（3 helper 集中，0 handler 改动）
- 在 `callTokenflashImage` / `callRevoraImage` / `callAzureImage`（各自 `*.functions.ts`）**成功返回 url 前**，调 `getOptionalAuthCtx()` 拿 ctx，若非 null 且 `imageCost(model)` 非 null，则 `chargeCredits(ctx.supabase, ctx.userId, { amount, model, description: "生图" })`
- 这 3 个 helper 被全部 7 个生图 handler（generateImage / regenerateCharacterLook / generateStoryboardShotImage / regenerateStoryboardShot / generateStoryboardPitchDeck / regenerateStoryboardPitchDeck / regenerateSceneImage）委派调用，故一处扣分覆盖所有 T2I + I2I 路径，**无需给 handler 加中间件、无需改 18 处调用点**
- 扣分失败（余额不足/未登录）不阻断返回图片

### 6. 视频扣分（`src/lib/videoGenerate.functions.ts` generateVideo）
- generateVideo 已有 `requireSupabaseAuth` + context。在成功返回点 [L2228](src/lib/videoGenerate.functions.ts#L2228)（`poll.status === "succeeded"` 块内）调 `chargeCredits(supabase, userId, { amount: videoCost(model, data.resolution, data.duration), model, resolution: data.resolution, duration: data.duration, description: "视频生成" })`
- 失败/超时路径（L2194/L2211/L2240/L2249）不扣

### 7. `src/routes/account.credits.tsx`（加消耗记录）
- 调 `getUserCreditTransactions`，用 `Table` 展示（时间、模型/描述、变动积分、扣后余额），借鉴 [CreditsHistoryTab](src/components/team/CreditsHistoryTab.tsx)
- 分页（PAGE_SIZE 20）

### 8. `src/components/NewProjectDialog.tsx`（下拉框标注积分）
- imageModelOptions：tokenflash/revora/azure 的 sub 追加 `· 5积分/张` 等
- videoModels：丽帧/Seedance 的 sub 追加积分范围（如 `· 56-593积分/10s`）
- 可选：分辨率选择器旁动态显示当前预计消耗（videoCost 实时算）

### 9. i18n（zh.ts/en.ts）
- 消耗记录页文案（列头、空态、类型标签）

## 风险 / 待确认
- **getOptionalAuthCtx**：在 helper 深度调 `getRequest()` 鉴权，依赖 TanStack Start 请求上下文在 server fn 调用链内可用（requireSupabaseAuth 中间件同样用它，应可行）；未登录返回 null 不阻断
- **余额不足时已生成**：图片/视频已成功但扣分失败 -> 采用**后置扣分，扣失败仅记流水不阻断**（符合"成功才扣"语义；余额不足记欠款流水）
- **覆盖范围**：3 个 helper 覆盖所有 7 个生图 handler（T2I + I2I）；视频覆盖 generateVideo 成功路径
- 部署前置：生产 DB 先执行 migration（alter numeric + deduct RPC + user_credit_transactions 表），再部署代码
