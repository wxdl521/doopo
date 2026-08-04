-- 扣费幂等（库级原子方案）：流水表加幂等键 + deduct_user_credits 新签名。
-- 修复「查重+扣费非原子，并发同 key 可能双扣」的遗留问题。
-- 注意：旧 5 参签名先 DROP 再建 6 参（避免 PostgREST 重载歧义）。

ALTER TABLE public.user_credit_transactions
  ADD COLUMN IF NOT EXISTS idempotency_key text;

-- 同一用户同一幂等键只允许一条流水（NULL 不参与约束）
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_credit_txn_idempotency
  ON public.user_credit_transactions (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

DROP FUNCTION IF EXISTS public.deduct_user_credits(numeric, text, text, text, int);

CREATE OR REPLACE FUNCTION public.deduct_user_credits(
  p_amount numeric,
  p_description text,
  p_model text,
  p_resolution text,
  p_duration int,
  p_idempotency_key text DEFAULT NULL
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
      (user_id, type, amount, balance_after, model, resolution, duration, description, idempotency_key)
    VALUES (auth.uid(), 'consume', -p_amount, v_new_balance, p_model, p_resolution, p_duration, p_description, p_idempotency_key);
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

REVOKE ALL ON FUNCTION public.deduct_user_credits(numeric, text, text, text, int, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.deduct_user_credits(numeric, text, text, text, int, text) TO authenticated;
