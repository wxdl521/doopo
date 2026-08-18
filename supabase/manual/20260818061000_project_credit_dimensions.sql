-- ====================================================================
-- 积分流水加项目维度（2026-08 后台「按项目名称查消耗明细」需求）
--
-- 1. user_credit_transactions 加 project_id / project_name 两列（可空,
--    旧流水为 NULL）;
-- 2. 重建 deduct_user_credits：加 p_project_id / p_project_name 并写入流水,
--    幂等逻辑与 20260804230000 原文完全一致（先 DROP 旧 6 参签名避免
--    PostgREST 重载歧义）;
-- 3. project_name 索引（后台 ILIKE 模糊筛选）。
--
-- 本项目约定不自动执行 db:push —— 请有 Supabase 权限的同学手动执行本文件。
-- 未执行期间 chargeCredits 自动回退旧 6 参签名（PGRST202/204 捕获重试）。
-- ====================================================================

ALTER TABLE public.user_credit_transactions
  ADD COLUMN IF NOT EXISTS project_id text,
  ADD COLUMN IF NOT EXISTS project_name text;

CREATE INDEX IF NOT EXISTS idx_user_credit_txn_project_name
  ON public.user_credit_transactions (project_name);

DROP FUNCTION IF EXISTS public.deduct_user_credits(numeric, text, text, text, int, text);

CREATE OR REPLACE FUNCTION public.deduct_user_credits(
  p_amount numeric,
  p_description text,
  p_model text,
  p_resolution text,
  p_duration int,
  p_idempotency_key text DEFAULT NULL,
  p_project_id text DEFAULT NULL,
  p_project_name text DEFAULT NULL
)
RETURNS TABLE(ok boolean, balance_after numeric, deduped boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_balance numeric;
BEGIN
  IF p_amount <= 0 THEN
    RETURN QUERY SELECT false, NULL::numeric, false;
    RETURN;
  END IF;

  -- 幂等键命中：直接返回当前余额，不扣费（原子判定靠唯一索引兜底）
  IF p_idempotency_key IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.user_credit_transactions
      WHERE user_id = auth.uid() AND idempotency_key = p_idempotency_key
    ) THEN
      SELECT credits_balance INTO v_new_balance
      FROM public.user_wallets WHERE user_id = auth.uid();
      RETURN QUERY SELECT false, v_new_balance, true;
      RETURN;
    END IF;
  END IF;

  INSERT INTO public.user_wallets (user_id, credits_balance)
  VALUES (auth.uid(), -p_amount)
  ON CONFLICT (user_id) DO UPDATE
  SET credits_balance = user_wallets.credits_balance - p_amount,
      updated_at = now()
  RETURNING credits_balance INTO v_new_balance;

  BEGIN
    INSERT INTO public.user_credit_transactions
      (user_id, type, amount, balance_after, model, resolution, duration, description, idempotency_key, project_id, project_name)
    VALUES (auth.uid(), 'consume', -p_amount, v_new_balance, p_model, p_resolution, p_duration, p_description, p_idempotency_key, p_project_id, p_project_name);
  EXCEPTION WHEN unique_violation THEN
    -- 并发同键：钱包已扣的需要回补
    UPDATE public.user_wallets
    SET credits_balance = credits_balance + p_amount, updated_at = now()
    WHERE user_id = auth.uid()
    RETURNING credits_balance INTO v_new_balance;
    RETURN QUERY SELECT false, v_new_balance, true;
    RETURN;
  END;

  RETURN QUERY SELECT true, v_new_balance, false;
END;
$$;

REVOKE ALL ON FUNCTION public.deduct_user_credits(numeric, text, text, text, int, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.deduct_user_credits(numeric, text, text, text, int, text, text, text) TO authenticated;
