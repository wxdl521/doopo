-- ====================================================================
-- 邀请好友：专属邀请码、注册绑定、注册送 50、首次发放/充值双方 5% 返现
--
-- 口径：
--   - 所有新用户注册送 50（signup_bonus），不触发返现
--   - 通过邀请码注册时先绑定再发 50
--   - 被邀请人个人钱包第一笔 admin_grant / recharge 触发双方 floor(金额*5%)
--   - <1 分记 skipped，机会用掉；团队发放按所有者个人流水判定
-- 本文件需在 Supabase 执行；协作者不要 db push 到生产。
-- ====================================================================

CREATE TABLE IF NOT EXISTS public.user_invite_codes (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_invite_codes_format CHECK (code ~ '^[2-9A-HJ-NP-Z]{8}$')
);

CREATE TABLE IF NOT EXISTS public.user_referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inviter_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  invitee_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  invite_code text NOT NULL,
  bound_at timestamptz NOT NULL DEFAULT now(),
  reward_status text NOT NULL DEFAULT 'pending'
    CHECK (reward_status IN ('pending', 'rewarded', 'skipped')),
  source_tx_id uuid REFERENCES public.user_credit_transactions(id) ON DELETE SET NULL,
  source_amount numeric(12,2),
  reward_amount integer,
  rewarded_at timestamptz,
  CONSTRAINT user_referrals_no_self CHECK (inviter_id <> invitee_id)
);

CREATE INDEX IF NOT EXISTS idx_user_referrals_inviter_bound
  ON public.user_referrals (inviter_id, bound_at DESC);

ALTER TABLE public.user_invite_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_referrals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_invite_codes_select_own ON public.user_invite_codes;
CREATE POLICY user_invite_codes_select_own ON public.user_invite_codes
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS user_referrals_select_own ON public.user_referrals;
CREATE POLICY user_referrals_select_own ON public.user_referrals
  FOR SELECT TO authenticated
  USING (auth.uid() = inviter_id OR auth.uid() = invitee_id);

REVOKE ALL ON TABLE public.user_invite_codes FROM anon, authenticated;
REVOKE ALL ON TABLE public.user_referrals FROM anon, authenticated;
GRANT SELECT ON TABLE public.user_invite_codes TO authenticated;
GRANT SELECT ON TABLE public.user_referrals TO authenticated;

-- ---------- 内部：给指定用户生成/读取邀请码 ----------
CREATE OR REPLACE FUNCTION public.ensure_invite_code_for_user(p_user_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text;
  v_alphabet constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  v_i int;
  v_attempt int := 0;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user id required';
  END IF;

  SELECT code INTO v_code
  FROM public.user_invite_codes
  WHERE user_id = p_user_id;
  IF v_code IS NOT NULL THEN
    RETURN v_code;
  END IF;

  LOOP
    v_attempt := v_attempt + 1;
    IF v_attempt > 20 THEN
      RAISE EXCEPTION 'failed to allocate invite code';
    END IF;
    v_code := '';
    FOR v_i IN 1..8 LOOP
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * 32)::int, 1);
    END LOOP;
    BEGIN
      INSERT INTO public.user_invite_codes (user_id, code)
      VALUES (p_user_id, v_code);
      RETURN v_code;
    EXCEPTION WHEN unique_violation THEN
      -- 码冲突则重抽；user_id 冲突则读已有码
      SELECT code INTO v_code FROM public.user_invite_codes WHERE user_id = p_user_id;
      IF v_code IS NOT NULL THEN
        RETURN v_code;
      END IF;
    END;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_my_invite_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  RETURN public.ensure_invite_code_for_user(v_user);
END;
$$;

-- ---------- 内部：入账（注册赠送 / 邀请返现）----------
CREATE OR REPLACE FUNCTION public.credit_wallet(
  p_user_id uuid,
  p_amount numeric,
  p_type text,
  p_description text,
  p_idempotency_key text DEFAULT NULL
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_balance numeric;
BEGIN
  IF p_user_id IS NULL OR p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'invalid credit_wallet args';
  END IF;

  IF p_idempotency_key IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.user_credit_transactions
    WHERE user_id = p_user_id AND idempotency_key = p_idempotency_key
  ) THEN
    SELECT credits_balance INTO v_new_balance
    FROM public.user_wallets WHERE user_id = p_user_id;
    RETURN COALESCE(v_new_balance, 0);
  END IF;

  INSERT INTO public.user_wallets (user_id, credits_balance)
  VALUES (p_user_id, 0)
  ON CONFLICT (user_id) DO NOTHING;

  UPDATE public.user_wallets
  SET credits_balance = credits_balance + p_amount,
      updated_at = now()
  WHERE user_id = p_user_id
  RETURNING credits_balance INTO v_new_balance;

  INSERT INTO public.user_credit_transactions
    (user_id, type, amount, balance_after, description, idempotency_key)
  VALUES
    (p_user_id, p_type, p_amount, v_new_balance, p_description, p_idempotency_key);

  RETURN v_new_balance;
END;
$$;

CREATE OR REPLACE FUNCTION public.grant_signup_bonus(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.credit_wallet(
    p_user_id,
    50,
    'signup_bonus',
    '新用户注册赠送',
    'signup_bonus:' || p_user_id::text
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.try_bind_referral(p_invitee_id uuid, p_code text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text;
  v_inviter uuid;
BEGIN
  v_code := upper(btrim(COALESCE(p_code, '')));
  IF p_invitee_id IS NULL OR v_code !~ '^[2-9A-HJ-NP-Z]{8}$' THEN
    RETURN false;
  END IF;

  SELECT user_id INTO v_inviter
  FROM public.user_invite_codes
  WHERE code = v_code;

  IF v_inviter IS NULL OR v_inviter = p_invitee_id THEN
    RETURN false;
  END IF;

  IF EXISTS (SELECT 1 FROM public.user_referrals WHERE invitee_id = p_invitee_id) THEN
    RETURN false;
  END IF;

  IF EXISTS (SELECT 1 FROM public.user_credit_transactions WHERE user_id = p_invitee_id) THEN
    RETURN false;
  END IF;

  BEGIN
    INSERT INTO public.user_referrals (inviter_id, invitee_id, invite_code)
    VALUES (v_inviter, p_invitee_id, v_code);
    RETURN true;
  EXCEPTION WHEN unique_violation THEN
    RETURN false;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.ensure_invite_code_for_user(NEW.id);
  PERFORM public.try_bind_referral(
    NEW.id,
    NEW.raw_user_meta_data ->> 'invite_code'
  );
  PERFORM public.grant_signup_bonus(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 在改目标钱包之前，按 user_id 顺序锁邀请人+被邀请人，避免互邀并发死锁。
CREATE OR REPLACE FUNCTION public.lock_referral_pair_wallets(p_invitee_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inviter uuid;
  v_invitee uuid;
BEGIN
  SELECT inviter_id, invitee_id INTO v_inviter, v_invitee
  FROM public.user_referrals
  WHERE invitee_id = p_invitee_id AND reward_status = 'pending'
  FOR UPDATE;
  IF v_inviter IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO public.user_wallets (user_id, credits_balance)
  VALUES (v_inviter, 0), (v_invitee, 0)
  ON CONFLICT (user_id) DO NOTHING;
  PERFORM 1
  FROM public.user_wallets
  WHERE user_id IN (v_inviter, v_invitee)
  ORDER BY user_id
  FOR UPDATE;
END;
$$;

-- ---------- 首次发放/充值返现 ----------
CREATE OR REPLACE FUNCTION public.settle_referral_reward()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_referral_id uuid;
  v_inviter uuid;
  v_invitee uuid;
  v_reward integer;
BEGIN
  IF NEW.amount IS NULL OR NEW.amount <= 0 THEN
    RETURN NEW;
  END IF;
  IF NEW.type IS DISTINCT FROM 'admin_grant' AND NEW.type IS DISTINCT FROM 'recharge' THEN
    RETURN NEW;
  END IF;

  SELECT id, inviter_id, invitee_id, reward_status
    INTO v_referral_id, v_inviter, v_invitee, v_status
  FROM public.user_referrals
  WHERE invitee_id = NEW.user_id
  FOR UPDATE;

  IF v_referral_id IS NULL OR v_status IS DISTINCT FROM 'pending' THEN
    RETURN NEW;
  END IF;

  v_reward := floor(NEW.amount * 0.05)::integer;

  INSERT INTO public.user_wallets (user_id, credits_balance)
  VALUES (v_inviter, 0), (v_invitee, 0)
  ON CONFLICT (user_id) DO NOTHING;

  PERFORM 1
  FROM public.user_wallets
  WHERE user_id IN (v_inviter, v_invitee)
  ORDER BY user_id
  FOR UPDATE;

  IF v_reward < 1 THEN
    UPDATE public.user_referrals
    SET reward_status = 'skipped',
        source_tx_id = NEW.id,
        source_amount = NEW.amount,
        reward_amount = 0,
        rewarded_at = now()
    WHERE id = v_referral_id AND reward_status = 'pending';
    RETURN NEW;
  END IF;

  PERFORM public.credit_wallet(
    v_inviter,
    v_reward,
    'referral_reward',
    '邀请好友返现',
    'referral_reward:' || v_referral_id::text || ':inviter'
  );
  PERFORM public.credit_wallet(
    v_invitee,
    v_reward,
    'referral_reward',
    '接受邀请返现',
    'referral_reward:' || v_referral_id::text || ':invitee'
  );

  UPDATE public.user_referrals
  SET reward_status = 'rewarded',
      source_tx_id = NEW.id,
      source_amount = NEW.amount,
      reward_amount = v_reward,
      rewarded_at = now()
  WHERE id = v_referral_id AND reward_status = 'pending';

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_settle_referral_reward ON public.user_credit_transactions;
CREATE TRIGGER trg_settle_referral_reward
  AFTER INSERT ON public.user_credit_transactions
  FOR EACH ROW EXECUTE FUNCTION public.settle_referral_reward();

-- ---------- 邀请页总览 ----------
CREATE OR REPLACE FUNCTION public.get_my_referral_overview()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_code text;
  v_earned numeric;
  v_invitees jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  v_code := public.ensure_invite_code_for_user(v_user);

  SELECT COALESCE(SUM(reward_amount), 0) INTO v_earned
  FROM public.user_referrals
  WHERE inviter_id = v_user AND reward_status = 'rewarded';

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'emailMasked',
          CASE
            WHEN u.email IS NULL OR position('@' in u.email::text) = 0 THEN '—'
            ELSE left(u.email::text, 1) || '***@' || split_part(u.email::text, '@', 2)
          END,
        'boundAt', r.bound_at,
        'rewardStatus', r.reward_status,
        'sourceAmount', r.source_amount,
        'rewardAmount', r.reward_amount,
        'rewardedAt', r.rewarded_at
      )
      ORDER BY r.bound_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_invitees
  FROM public.user_referrals r
  LEFT JOIN auth.users u ON u.id = r.invitee_id
  WHERE r.inviter_id = v_user;

  RETURN jsonb_build_object(
    'code', v_code,
    'invitedCount', (SELECT count(*) FROM public.user_referrals WHERE inviter_id = v_user),
    'pendingCount', (SELECT count(*) FROM public.user_referrals WHERE inviter_id = v_user AND reward_status = 'pending'),
    'rewardedCount', (SELECT count(*) FROM public.user_referrals WHERE inviter_id = v_user AND reward_status = 'rewarded'),
    'skippedCount', (SELECT count(*) FROM public.user_referrals WHERE inviter_id = v_user AND reward_status = 'skipped'),
    'myRewardTotal', v_earned,
    'invitees', v_invitees
  );
END;
$$;

-- 支付回调走显式 user id（service_role 的 auth.uid() 为空）
CREATE OR REPLACE FUNCTION public.add_user_credits_for_user(p_user_id uuid, p_amount numeric)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_balance numeric;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user id required';
  END IF;
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'amount must be positive';
  END IF;
  PERFORM public.lock_referral_pair_wallets(p_user_id);
  INSERT INTO public.user_wallets (user_id, credits_balance)
  VALUES (p_user_id, 0)
  ON CONFLICT (user_id) DO NOTHING;
  PERFORM 1 FROM public.user_wallets WHERE user_id = p_user_id FOR UPDATE;
  UPDATE public.user_wallets
  SET credits_balance = credits_balance + p_amount,
      updated_at = now()
  WHERE user_id = p_user_id
  RETURNING credits_balance INTO v_new_balance;
  INSERT INTO public.user_credit_transactions
    (user_id, type, amount, balance_after, description)
  VALUES (p_user_id, 'recharge', p_amount, v_new_balance, '充值');
  -- 返现触发器可能已改余额，返回结算后的数
  SELECT credits_balance INTO v_new_balance
  FROM public.user_wallets WHERE user_id = p_user_id;
  RETURN v_new_balance;
END;
$$;

CREATE OR REPLACE FUNCTION public.add_user_credits(p_amount numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  PERFORM public.add_user_credits_for_user(v_user, p_amount);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_grant_credits(
  p_target_type text,
  p_target_id uuid,
  p_amount integer,
  p_description text DEFAULT NULL
)
RETURNS TABLE (balance_after numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner_id uuid;
  v_owner_balance numeric(12,2);
  v_team_balance numeric(12,2);
BEGIN
  PERFORM public.assert_credit_admin();
  IF p_target_type NOT IN ('user', 'team') OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Invalid credit grant';
  END IF;

  IF p_target_type = 'user' THEN
    PERFORM public.lock_referral_pair_wallets(p_target_id);
    INSERT INTO public.user_wallets (user_id, credits_balance)
    VALUES (p_target_id, p_amount)
    ON CONFLICT (user_id) DO UPDATE
      SET credits_balance = public.user_wallets.credits_balance + EXCLUDED.credits_balance,
          updated_at = now()
    RETURNING credits_balance INTO v_owner_balance;
    INSERT INTO public.user_credit_transactions (user_id, type, amount, balance_after, description)
    VALUES (p_target_id, 'admin_grant', p_amount, v_owner_balance, COALESCE(p_description, '管理员分配积分'));
    RETURN QUERY SELECT v_owner_balance;
    RETURN;
  END IF;

  SELECT user_id INTO v_owner_id FROM public.team_members
  WHERE team_id = p_target_id AND role = 'owner' FOR UPDATE;
  IF v_owner_id IS NULL THEN RAISE EXCEPTION 'Team owner wallet not found'; END IF;
  PERFORM public.lock_referral_pair_wallets(v_owner_id);
  INSERT INTO public.user_wallets (user_id, credits_balance)
  VALUES (v_owner_id, p_amount)
  ON CONFLICT (user_id) DO UPDATE
    SET credits_balance = public.user_wallets.credits_balance + EXCLUDED.credits_balance,
        updated_at = now()
    RETURNING credits_balance INTO v_owner_balance;
  SELECT COALESCE(SUM(credits_balance), 0) INTO v_team_balance
  FROM public.team_members WHERE team_id = p_target_id;

  INSERT INTO public.user_credit_transactions (user_id, type, amount, balance_after, description)
  VALUES (v_owner_id, 'admin_grant', p_amount, v_owner_balance, COALESCE(p_description, '管理员分配积分'));
  INSERT INTO public.credit_transactions
    (team_id, user_id, type, amount, balance_after, operator_id, source_type, description)
  VALUES
    (p_target_id, v_owner_id, 'admin_grant', p_amount, v_team_balance, auth.uid(), 'recharge',
     COALESCE(p_description, '管理员分配积分'));
  RETURN QUERY SELECT v_team_balance;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_invite_code_for_user(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.credit_wallet(uuid, numeric, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.grant_signup_bonus(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.try_bind_referral(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.settle_referral_reward() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lock_referral_pair_wallets(uuid) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.ensure_my_invite_code() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_my_invite_code() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_my_referral_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_referral_overview() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.add_user_credits(numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_user_credits(numeric) TO service_role;
REVOKE ALL ON FUNCTION public.add_user_credits_for_user(uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_user_credits_for_user(uuid, numeric) TO service_role;
