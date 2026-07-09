-- ====================================================================
-- 积分消耗系统:余额改 numeric(12,2) + 扣分 RPC + 消耗记录表
--
-- 设计:
--   - credits_balance 改 numeric(12,2) 支持小数积分(如丽帧 Pro 480P = 110.4)
--   - deduct_user_credits:无条件扣(支持欠款,余额可负) + 写消耗流水
--     (调用方保证模型成功后才调;余额不足扣到负数,下次充值抵扣)
--   - user_credit_transactions:个人消耗记录,RLS 用户只查自己
-- ====================================================================

-- 1. 余额改 numeric(12,2) 支持小数积分
ALTER TABLE public.user_wallets
  ALTER COLUMN credits_balance TYPE numeric(12,2) USING credits_balance::numeric(12,2);

-- 2. 充值 RPC 参数 int -> numeric(兼容现有整数充值调用)
CREATE OR REPLACE FUNCTION public.add_user_credits(p_amount numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'amount must be positive';
  END IF;
  INSERT INTO public.user_wallets (user_id, credits_balance)
  VALUES (auth.uid(), p_amount)
  ON CONFLICT (user_id) DO UPDATE
  SET credits_balance = user_wallets.credits_balance + p_amount,
      updated_at = now();
END;
$$;
REVOKE ALL ON FUNCTION public.add_user_credits(numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_user_credits(numeric) TO authenticated;

-- 3. 扣分 RPC:UPSERT 原子扣减(防并发) + 写消耗流水
CREATE OR REPLACE FUNCTION public.deduct_user_credits(
  p_amount numeric,
  p_description text,
  p_model text,
  p_resolution text,
  p_duration int
)
RETURNS TABLE(ok boolean, balance_after numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_balance numeric;
BEGIN
  IF p_amount <= 0 THEN
    RETURN QUERY SELECT false, NULL::numeric;
    RETURN;
  END IF;
  -- UPSERT 扣减:钱包不存在则创建为负,ON CONFLICT 原子防并发
  INSERT INTO public.user_wallets (user_id, credits_balance)
  VALUES (auth.uid(), -p_amount)
  ON CONFLICT (user_id) DO UPDATE
  SET credits_balance = user_wallets.credits_balance - p_amount,
      updated_at = now()
  RETURNING credits_balance INTO v_new_balance;

  INSERT INTO public.user_credit_transactions
    (user_id, type, amount, balance_after, model, resolution, duration, description)
  VALUES (auth.uid(), 'consume', -p_amount, v_new_balance, p_model, p_resolution, p_duration, p_description);

  RETURN QUERY SELECT true, v_new_balance;
END;
$$;
REVOKE ALL ON FUNCTION public.deduct_user_credits(numeric, text, text, text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.deduct_user_credits(numeric, text, text, text, int) TO authenticated;

-- 4. 个人积分消耗记录表
CREATE TABLE IF NOT EXISTS public.user_credit_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL DEFAULT 'consume',
  amount numeric(12,2) NOT NULL,
  balance_after numeric(12,2),
  model text,
  resolution text,
  duration int,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_credit_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_credit_transactions_select_own ON public.user_credit_transactions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
-- insert 由 deduct_user_credits / add_user_credits RPC (SECURITY DEFINER) 完成,用户无直接 insert 权限

CREATE INDEX idx_user_credit_transactions_user_created
  ON public.user_credit_transactions (user_id, created_at DESC);
