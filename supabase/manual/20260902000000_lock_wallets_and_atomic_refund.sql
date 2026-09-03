-- 与 supabase/migrations/20260902000000_lock_wallets_and_atomic_refund.sql 相同。
-- 当前协作者无 db:push 权限，请在 Supabase SQL Editor 直接执行本文件。

-- ====================================================================
-- 锁钱包 + 原子退款 + 流水汇总
-- ====================================================================

CREATE OR REPLACE FUNCTION public.ensure_user_wallet()
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_balance numeric;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  INSERT INTO public.user_wallets (user_id, credits_balance)
  VALUES (v_user, 0)
  ON CONFLICT (user_id) DO NOTHING;
  SELECT credits_balance INTO v_balance
  FROM public.user_wallets
  WHERE user_id = v_user;
  RETURN COALESCE(v_balance, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_user_wallet() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_user_wallet() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_my_credit_summary()
RETURNS TABLE(balance numeric, lifetime_earned numeric, lifetime_spent numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_balance numeric;
  v_earned numeric;
  v_spent numeric;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  INSERT INTO public.user_wallets (user_id, credits_balance)
  VALUES (v_user, 0)
  ON CONFLICT (user_id) DO NOTHING;
  SELECT w.credits_balance INTO v_balance
  FROM public.user_wallets w
  WHERE w.user_id = v_user;
  SELECT
    COALESCE(SUM(CASE WHEN t.amount > 0 THEN t.amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN t.amount < 0 THEN -t.amount ELSE 0 END), 0)
  INTO v_earned, v_spent
  FROM public.user_credit_transactions t
  WHERE t.user_id = v_user;
  RETURN QUERY SELECT COALESCE(v_balance, 0), COALESCE(v_earned, 0), COALESCE(v_spent, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_credit_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_credit_summary() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.refund_user_credits_by_key(
  p_charge_idempotency_key text,
  p_description text DEFAULT NULL
)
RETURNS TABLE(ok boolean, refunded boolean, reason text, amount numeric, balance_after numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_charge_amount numeric;
  v_refund_key text;
  v_new_balance numeric;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_charge_idempotency_key IS NULL OR length(btrim(p_charge_idempotency_key)) = 0 THEN
    RAISE EXCEPTION 'invalid idempotency key';
  END IF;

  SELECT abs(t.amount) INTO v_charge_amount
  FROM public.user_credit_transactions t
  WHERE t.user_id = v_user
    AND t.idempotency_key = p_charge_idempotency_key
    AND t.type = 'consume'
  LIMIT 1;

  IF v_charge_amount IS NULL THEN
    RETURN QUERY SELECT true, false, 'no_charge'::text, 0::numeric, NULL::numeric;
    RETURN;
  END IF;

  v_refund_key := 'refund:' || p_charge_idempotency_key;

  INSERT INTO public.user_wallets (user_id, credits_balance)
  VALUES (v_user, 0)
  ON CONFLICT (user_id) DO NOTHING;

  PERFORM 1 FROM public.user_wallets WHERE user_id = v_user FOR UPDATE;

  IF EXISTS (
    SELECT 1
    FROM public.user_credit_transactions t
    WHERE t.user_id = v_user AND t.idempotency_key = v_refund_key
  ) THEN
    SELECT w.credits_balance INTO v_new_balance
    FROM public.user_wallets w
    WHERE w.user_id = v_user;
    RETURN QUERY SELECT true, false, 'deduped'::text, v_charge_amount, v_new_balance;
    RETURN;
  END IF;

  UPDATE public.user_wallets
  SET credits_balance = credits_balance + v_charge_amount,
      updated_at = now()
  WHERE user_id = v_user
  RETURNING credits_balance INTO v_new_balance;

  INSERT INTO public.user_credit_transactions
    (user_id, type, amount, balance_after, description, idempotency_key)
  VALUES
    (
      v_user,
      'refund',
      v_charge_amount,
      v_new_balance,
      COALESCE(p_description, '按原扣费退款'),
      v_refund_key
    );

  RETURN QUERY SELECT true, true, 'refunded'::text, v_charge_amount, v_new_balance;
END;
$$;

REVOKE ALL ON FUNCTION public.refund_user_credits_by_key(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refund_user_credits_by_key(text, text) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.add_user_credits(integer);

REVOKE ALL ON FUNCTION public.add_user_credits(numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_user_credits(numeric) TO service_role;

DROP POLICY IF EXISTS user_wallets_update_own ON public.user_wallets;
DROP POLICY IF EXISTS user_wallets_insert_service_role ON public.user_wallets;
DROP POLICY IF EXISTS "user_wallets_update_own" ON public.user_wallets;
DROP POLICY IF EXISTS "user_wallets_insert_service_role" ON public.user_wallets;
