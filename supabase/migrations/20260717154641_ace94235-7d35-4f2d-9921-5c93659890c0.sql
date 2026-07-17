
-- =====================================================================
-- 重新落库团队积分同步相关的 RPC / 触发器
-- 原迁移 20260717010000_sync_team_credits_with_personal_wallets 未在数据库执行
-- 本迁移只重建函数与触发器，不再重放历史数据合并 (会重复叠加余额)
-- =====================================================================

CREATE OR REPLACE FUNCTION public.sync_team_member_wallet_balance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE public.team_members SET credits_balance = NEW.credits_balance
  WHERE user_id = NEW.user_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_team_member_wallet_balance ON public.user_wallets;
CREATE TRIGGER trg_sync_team_member_wallet_balance
  AFTER INSERT OR UPDATE OF credits_balance ON public.user_wallets
  FOR EACH ROW EXECUTE FUNCTION public.sync_team_member_wallet_balance();

CREATE OR REPLACE FUNCTION public.set_new_team_member_wallet_balance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_wallets (user_id, credits_balance)
  VALUES (NEW.user_id, 0) ON CONFLICT (user_id) DO NOTHING;
  SELECT credits_balance INTO NEW.credits_balance
  FROM public.user_wallets WHERE user_id = NEW.user_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_new_team_member_wallet_balance ON public.team_members;
CREATE TRIGGER trg_set_new_team_member_wallet_balance
  BEFORE INSERT ON public.team_members
  FOR EACH ROW EXECUTE FUNCTION public.set_new_team_member_wallet_balance();

CREATE OR REPLACE FUNCTION public.reclaim_leaving_member_credits()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_owner_id uuid; v_member_balance numeric(12,2); v_owner_balance numeric(12,2);
BEGIN
  IF OLD.role = 'owner' THEN RETURN OLD; END IF;
  SELECT user_id INTO v_owner_id FROM public.team_members
  WHERE team_id = OLD.team_id AND role = 'owner' FOR UPDATE;
  IF v_owner_id IS NULL OR v_owner_id = OLD.user_id THEN RETURN OLD; END IF;

  INSERT INTO public.user_wallets (user_id, credits_balance)
  VALUES (OLD.user_id, COALESCE(OLD.credits_balance, 0)), (v_owner_id, 0)
  ON CONFLICT (user_id) DO NOTHING;
  PERFORM 1 FROM public.user_wallets
  WHERE user_id = ANY (ARRAY[OLD.user_id, v_owner_id]) ORDER BY user_id FOR UPDATE;

  SELECT credits_balance INTO v_member_balance FROM public.user_wallets WHERE user_id = OLD.user_id;
  UPDATE public.user_wallets SET credits_balance = 0, updated_at = now() WHERE user_id = OLD.user_id;
  UPDATE public.user_wallets SET credits_balance = credits_balance + v_member_balance, updated_at = now()
  WHERE user_id = v_owner_id RETURNING credits_balance INTO v_owner_balance;

  IF v_member_balance <> 0 THEN
    INSERT INTO public.user_credit_transactions (user_id, type, amount, balance_after, description) VALUES
      (OLD.user_id, 'team_member_reclaim', -v_member_balance, 0, '离开团队，积分回收至所有者'),
      (v_owner_id, 'team_member_reclaim', v_member_balance, v_owner_balance, '团队成员离开，积分回收');
    INSERT INTO public.credit_transactions
      (team_id, user_id, type, amount, balance_after, operator_id, source_type, description)
    VALUES (OLD.team_id, OLD.user_id, 'reclaim', -v_member_balance, 0, auth.uid(), 'recharge',
      '成员离开或被移出团队，积分回收至所有者');
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_reclaim_leaving_member_credits ON public.team_members;
CREATE TRIGGER trg_reclaim_leaving_member_credits
  BEFORE DELETE ON public.team_members
  FOR EACH ROW EXECUTE FUNCTION public.reclaim_leaving_member_credits();

-- 团队积分分配
CREATE OR REPLACE FUNCTION public.allocate_team_credits(
  p_team_id uuid, p_user_id uuid, p_amount numeric, p_description text DEFAULT NULL
) RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor_role text; v_target_role text; v_owner_id uuid;
  v_owner_balance numeric(12,2); v_target_balance numeric(12,2);
BEGIN
  IF p_amount <= 0 THEN RAISE EXCEPTION 'amount must be positive'; END IF;
  SELECT role INTO v_actor_role FROM public.team_members WHERE team_id = p_team_id AND user_id = auth.uid();
  IF v_actor_role NOT IN ('owner','admin') THEN RAISE EXCEPTION 'You do not have permission to allocate credits'; END IF;
  SELECT role INTO v_target_role FROM public.team_members WHERE team_id = p_team_id AND user_id = p_user_id;
  IF v_target_role IS NULL THEN RAISE EXCEPTION 'Target member not found'; END IF;
  IF v_actor_role = 'admin' AND v_target_role <> 'member' THEN
    RAISE EXCEPTION 'Admin can only allocate credits to members';
  END IF;
  SELECT user_id INTO v_owner_id FROM public.team_members WHERE team_id = p_team_id AND role = 'owner';
  IF v_owner_id IS NULL THEN RAISE EXCEPTION 'Team owner not found'; END IF;
  IF p_user_id = v_owner_id THEN
    SELECT credits_balance INTO v_target_balance FROM public.user_wallets WHERE user_id = v_owner_id;
    RETURN COALESCE(v_target_balance, 0);
  END IF;

  INSERT INTO public.user_wallets (user_id, credits_balance)
  VALUES (v_owner_id, 0), (p_user_id, 0) ON CONFLICT (user_id) DO NOTHING;
  PERFORM 1 FROM public.user_wallets
  WHERE user_id = ANY (ARRAY[v_owner_id, p_user_id]) ORDER BY user_id FOR UPDATE;

  SELECT credits_balance INTO v_owner_balance FROM public.user_wallets WHERE user_id = v_owner_id;
  IF v_owner_balance < p_amount THEN RAISE EXCEPTION 'Insufficient owner credits'; END IF;

  UPDATE public.user_wallets SET credits_balance = credits_balance - p_amount, updated_at = now()
  WHERE user_id = v_owner_id;
  UPDATE public.user_wallets SET credits_balance = credits_balance + p_amount, updated_at = now()
  WHERE user_id = p_user_id RETURNING credits_balance INTO v_target_balance;

  INSERT INTO public.user_credit_transactions (user_id, type, amount, balance_after, description) VALUES
    (v_owner_id, 'team_allocate', -p_amount, v_owner_balance - p_amount, COALESCE(p_description,'团队积分分配')),
    (p_user_id, 'team_allocate', p_amount, v_target_balance, COALESCE(p_description,'团队积分分配'));
  INSERT INTO public.credit_transactions
    (team_id, user_id, type, amount, balance_after, operator_id, source_type, description)
  VALUES (p_team_id, p_user_id, 'allocate', p_amount, v_target_balance, auth.uid(), 'recharge',
    COALESCE(p_description,'积分分配'));
  RETURN v_target_balance;
END;
$$;

-- 团队积分回收
CREATE OR REPLACE FUNCTION public.reclaim_team_credits(
  p_team_id uuid, p_user_id uuid, p_amount numeric, p_description text DEFAULT NULL
) RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor_role text; v_target_role text; v_owner_id uuid;
  v_target_balance numeric(12,2); v_owner_balance numeric(12,2);
BEGIN
  IF p_amount <= 0 THEN RAISE EXCEPTION 'amount must be positive'; END IF;
  SELECT role INTO v_actor_role FROM public.team_members WHERE team_id = p_team_id AND user_id = auth.uid();
  IF v_actor_role NOT IN ('owner','admin') THEN RAISE EXCEPTION 'You do not have permission to reclaim credits'; END IF;
  SELECT role INTO v_target_role FROM public.team_members WHERE team_id = p_team_id AND user_id = p_user_id;
  IF v_target_role IS NULL THEN RAISE EXCEPTION 'Target member not found'; END IF;
  IF v_actor_role = 'admin' AND v_target_role <> 'member' THEN
    RAISE EXCEPTION 'Admin can only reclaim credits from members';
  END IF;
  SELECT user_id INTO v_owner_id FROM public.team_members WHERE team_id = p_team_id AND role = 'owner';
  IF v_owner_id IS NULL THEN RAISE EXCEPTION 'Team owner not found'; END IF;
  IF p_user_id = v_owner_id THEN
    SELECT credits_balance INTO v_target_balance FROM public.user_wallets WHERE user_id = v_owner_id;
    RETURN COALESCE(v_target_balance, 0);
  END IF;

  INSERT INTO public.user_wallets (user_id, credits_balance)
  VALUES (v_owner_id, 0), (p_user_id, 0) ON CONFLICT (user_id) DO NOTHING;
  PERFORM 1 FROM public.user_wallets
  WHERE user_id = ANY (ARRAY[v_owner_id, p_user_id]) ORDER BY user_id FOR UPDATE;
  SELECT credits_balance INTO v_target_balance FROM public.user_wallets WHERE user_id = p_user_id;
  IF v_target_balance < p_amount THEN RAISE EXCEPTION 'Member has insufficient credits to reclaim'; END IF;

  UPDATE public.user_wallets SET credits_balance = credits_balance - p_amount, updated_at = now()
  WHERE user_id = p_user_id RETURNING credits_balance INTO v_target_balance;
  UPDATE public.user_wallets SET credits_balance = credits_balance + p_amount, updated_at = now()
  WHERE user_id = v_owner_id RETURNING credits_balance INTO v_owner_balance;

  INSERT INTO public.user_credit_transactions (user_id, type, amount, balance_after, description) VALUES
    (p_user_id, 'team_reclaim', -p_amount, v_target_balance, COALESCE(p_description,'团队积分回收')),
    (v_owner_id, 'team_reclaim', p_amount, v_owner_balance, COALESCE(p_description,'团队积分回收'));
  INSERT INTO public.credit_transactions
    (team_id, user_id, type, amount, balance_after, operator_id, source_type, description)
  VALUES (p_team_id, p_user_id, 'reclaim', -p_amount, v_target_balance, auth.uid(), 'recharge',
    COALESCE(p_description,'积分回收'));
  RETURN v_target_balance;
END;
$$;

-- 团队成员之间转账
CREATE OR REPLACE FUNCTION public.transfer_team_credits(
  p_team_id uuid, p_to_user_id uuid, p_amount numeric, p_description text DEFAULT NULL
) RETURNS TABLE (from_balance_after numeric, to_balance_after numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_from_user_id uuid := auth.uid();
  v_from_balance numeric(12,2); v_to_balance numeric(12,2);
BEGIN
  IF p_amount <= 0 THEN RAISE EXCEPTION 'amount must be positive'; END IF;
  IF v_from_user_id IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF v_from_user_id = p_to_user_id THEN RAISE EXCEPTION 'Cannot transfer to yourself'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.team_members WHERE team_id = p_team_id AND user_id = v_from_user_id)
     OR NOT EXISTS (SELECT 1 FROM public.team_members WHERE team_id = p_team_id AND user_id = p_to_user_id) THEN
    RAISE EXCEPTION 'Both users must be members of the team';
  END IF;

  INSERT INTO public.user_wallets (user_id, credits_balance)
  VALUES (v_from_user_id, 0), (p_to_user_id, 0) ON CONFLICT (user_id) DO NOTHING;
  PERFORM 1 FROM public.user_wallets
  WHERE user_id = ANY (ARRAY[v_from_user_id, p_to_user_id]) ORDER BY user_id FOR UPDATE;

  SELECT credits_balance INTO v_from_balance FROM public.user_wallets WHERE user_id = v_from_user_id;
  IF v_from_balance < p_amount THEN RAISE EXCEPTION 'Insufficient credits'; END IF;

  UPDATE public.user_wallets SET credits_balance = credits_balance - p_amount, updated_at = now()
  WHERE user_id = v_from_user_id RETURNING credits_balance INTO v_from_balance;
  UPDATE public.user_wallets SET credits_balance = credits_balance + p_amount, updated_at = now()
  WHERE user_id = p_to_user_id RETURNING credits_balance INTO v_to_balance;

  INSERT INTO public.user_credit_transactions (user_id, type, amount, balance_after, description) VALUES
    (v_from_user_id, 'team_transfer_out', -p_amount, v_from_balance, COALESCE(p_description,'团队成员转账')),
    (p_to_user_id, 'team_transfer_in', p_amount, v_to_balance, COALESCE(p_description,'团队成员转账'));
  INSERT INTO public.credit_transactions
    (team_id, user_id, type, amount, balance_after, operator_id, source_type, description)
  VALUES
    (p_team_id, v_from_user_id, 'transfer_out', -p_amount, v_from_balance, v_from_user_id, 'recharge',
      COALESCE(p_description,'转账给成员')),
    (p_team_id, p_to_user_id, 'transfer_in', p_amount, v_to_balance, v_from_user_id, 'recharge',
      COALESCE(p_description,'收到转账'));
  INSERT INTO public.transfer_records
    (team_id, from_user_id, to_user_id, amount, from_balance_after, to_balance_after, operator_id)
  VALUES (p_team_id, v_from_user_id, p_to_user_id, p_amount, v_from_balance, v_to_balance, v_from_user_id);

  RETURN QUERY SELECT v_from_balance, v_to_balance;
END;
$$;

REVOKE ALL ON FUNCTION public.allocate_team_credits(uuid, uuid, numeric, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reclaim_team_credits(uuid, uuid, numeric, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.transfer_team_credits(uuid, uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.allocate_team_credits(uuid, uuid, numeric, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reclaim_team_credits(uuid, uuid, numeric, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.transfer_team_credits(uuid, uuid, numeric, text) TO authenticated, service_role;
