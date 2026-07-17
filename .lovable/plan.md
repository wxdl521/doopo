## 问题定位

**问题 1：团队积分分配报错 `Could not find the function public.allocate_team_credits(...)`**

- 迁移文件 `supabase/migrations/20260717010000_sync_team_credits_with_personal_wallets.sql` 定义了 `allocate_team_credits / reclaim_team_credits / transfer_team_credits` 三个 RPC，但通过 `supabase--read_query` 核查 `pg_proc`，线上数据库里这三个函数**都不存在**（之前的迁移没有落库成功）。前端 `src/lib/teamCredits.functions.ts` 调用的正是这些 RPC，因此报 schema cache not found。

**问题 2：账户积分余额没有下限保护**

- `chargeCredits`（`src/lib/userCredits.functions.ts`）在生成完成后才扣费，RPC `deduct_user_credits` 允许扣到负数（"欠款"）。
- `generateImage`（seedream.functions.ts）目前**根本没有扣费/校验**；`submitVideoTaskFn`（videoGenerate.functions.ts）只在成功后扣费。
- 结果：余额 ≤ 0 的用户仍能无限生成，与产品预期不符。

---

## 修复方案

### 一、重新应用团队积分迁移（DB 迁移）

重新执行 `20260717010000` 迁移中三个 RPC 的 `CREATE OR REPLACE FUNCTION` + 权限授予部分，确保线上存在：

- `allocate_team_credits(p_team_id, p_user_id, p_amount, p_description)`
- `reclaim_team_credits(...)`
- `transfer_team_credits(...)`

以及配套的 `reclaim_leaving_member_credits` 触发器（若缺失）。全部保持 `SECURITY DEFINER` + `search_path=public`，`REVOKE FROM anon`、`GRANT EXECUTE TO authenticated, service_role`（与安全内存一致）。

迁移完成后前端无需改动，`allocateCredits` server function 立即可用。

### 二、生成前积分预校验（代码）

新增共享工具 `src/lib/creditsGuard.ts`（服务端函数内使用）：

```
assertEnoughCredits(supabase, userId, requiredCost, meta)
  → 读 user_wallets.credits_balance
  → balance < requiredCost 时：
      • 写入 generation_error_logs（复用现有 logGenerationError，type='insufficient_credits'）
      • 抛出 Response(402, JSON) 或返回 { ok:false, error:'积分不足' }
```

接入两个关键路径（仅在成本可算出、cost>0 时校验；cost=null 的模型保持免费不拦截）：

1. **`src/lib/seedream.functions.ts` › `generateImage.handler`**  
   在真正分发到各供应商之前，用 `imageCost(model)` 计算成本 × 目标张数（seedream 支持批量），不足则直接返回 `{ ok:false, error, code:'INSUFFICIENT_CREDITS' }`，前端已有错误 toast 展示。生成成功后追加 `chargeCredits`（目前生图路径漏扣，一并补上，与现有 videoGenerate 保持一致的"成功后扣费"逻辑）。

2. **`src/lib/videoGenerate.functions.ts` › `submitVideoTaskFn`**  
   在向 ARK / kuaizi 等提交任务前，用 `videoCost(model, resolution, duration)` 预校验，不足则拒绝提交（不产生外部调用费用）。

### 三、前端错误提示

`ZopiaChatPanel` 与 `StoryboardTimeline` 已有统一的错误弹窗渲染 `error` 字段，无需改 UI；只需保证服务端返回的 `error` 文案为「当前积分不足，无法继续生成，请充值后再试」，即可自然展示并停止后续动作。

---

## 技术细节

- 预校验读的是 `user_wallets.credits_balance`（RLS 只允许自读，安全）。
- 预校验与扣费之间存在极小竞态窗口：仍依赖 `deduct_user_credits` RPC 的原子扣减做最终一致性，本次不改 RPC 语义（避免影响历史欠款用户）。
- `imageCost` 目前仅覆盖 tokenflash / revora / azure* 前缀，其它供应商返回 null → 不校验也不扣费，行为与今天一致，避免误伤。
- 生图批量：以请求里 `n` / `numImages` / 参考图循环次数为准计算 `cost * count`；handler 中已有相应变量，直接乘算。
- 团队迁移用 supabase migration 工具下发，等你审批后执行。

---

## 变更清单

- 迁移 SQL：重建 `allocate_team_credits` / `reclaim_team_credits` / `transfer_team_credits` + 权限
- 新增 `src/lib/creditsGuard.ts`
- 修改 `src/lib/seedream.functions.ts`（预校验 + 成功后扣费）
- 修改 `src/lib/videoGenerate.functions.ts`（提交前预校验）

不动 UI、不动其它业务逻辑。