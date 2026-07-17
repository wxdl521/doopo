-- 团队积分改为成员个人积分的实时映射。
-- 团队剩余积分 = 当前团队全部成员个人可用积分之和；team_members.credits_balance
-- 仅作为 user_wallets.credits_balance 的同步快照，不再是独立的钱包。

ALTER TABLE public.team_members
  ALTER COLUMN credits_balance TYPE numeric(12,2) USING credits_balance::numeric(12,2);
ALTER TABLE public.credit_transactions
  ALTER COLUMN amount TYPE numeric(12,2) USING amount::numeric(12,2),
  ALTER COLUMN balance_after TYPE numeric(12,2) USING balance_after::numeric(12,2);
ALTER TABLE public.transfer_records
  ALTER COLUMN amount TYPE numeric(12,2) USING amount::numeric(12,2),
  ALTER COLUMN from_balance_after TYPE numeric(12,2) USING from_balance_after::numeric(12,2),
  ALTER COLUMN to_balance_after TYPE numeric(12,2) USING to_balance_after::numeric(12,2);

-- 个人钱包变更后，实时刷新该用户在全部团队中的展示余额。
CREATE OR REPLACE FUNCTION public.sync_team_member_wallet_balance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.team_members
  SET credits_balance = NEW.credits_balance
  WHERE user_id = NEW.user_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_team_member_wallet_balance ON public.user_wallets;
CREATE TRIGGER trg_sync_team_member_wallet_balance
  AFTER INSERT OR UPDATE OF credits_balance ON public.user_wallets
  FOR EACH ROW EXECUTE FUNCTION public.sync_team_member_wallet_balance();

-- 新成员直接展示自己的个人积分，禁止新建独立的团队余额。
CREATE OR REPLACE FUNCTION public.set_new_team_member_wallet_balance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_wallets (user_id, credits_balance)
  VALUES (NEW.user_id, 0)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT credits_balance INTO NEW.credits_balance
  FROM public.user_wallets
  WHERE user_id = NEW.user_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_new_team_member_wallet_balance ON public.team_members;
CREATE TRIGGER trg_set_new_team_member_wallet_balance
  BEFORE INSERT ON public.team_members
  FOR EACH ROW EXECUTE FUNCTION public.set_new_team_member_wallet_balance();

-- 保留历史数据：旧团队余额原本与个人钱包分离，因此先合并进个人钱包，
-- 再由上面的触发器将团队成员余额改为个人钱包余额。
INSERT INTO public.user_wallets (user_id, credits_balance)
SELECT user_id, SUM(credits_balance)::numeric(12,2)
FROM public.team_members
GROUP BY user_id
ON CONFLICT (user_id) DO UPDATE
SET credits_balance = public.user_wallets.credits_balance + EXCLUDED.credits_balance,
    updated_at = now();

-- 成员退出或被移出时，将其个人积分原子回收到团队所有者。
CREATE OR REPLACE FUNCTION public.reclaim_leaving_member_credits()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner_id uuid;
  v_member_balance numeric(12,2);
  v_owner_balance numeric(12,2);
BEGIN
  -- 所有者不能通过普通的退出/移除流程回收给自己。
  IF OLD.role = 'owner' THEN
    RETURN OLD;
  END IF;

  SELECT user_id INTO v_owner_id
  FROM public.team_members
  WHERE team_id = OLD.team_id AND role = 'owner'
  FOR UPDATE;

  -- 团队级联删除时所有者可能已不存在；此时不再处理成员回收。
  IF v_owner_id IS NULL OR v_owner_id = OLD.user_id THEN
    RETURN OLD;
  END IF;

  INSERT INTO public.user_wallets (user_id, credits_balance)
  VALUES (OLD.user_id, COALESCE(OLD.credits_balance, 0)), (v_owner_id, 0)
  ON CONFLICT (user_id) DO NOTHING;

  -- 统一按 user_id 锁定，避免同时移除/转账造成死锁。
  PERFORM 1
  FROM public.user_wallets
  WHERE user_id = ANY (ARRAY[OLD.user_id, v_owner_id])
  ORDER BY user_id
  FOR UPDATE;

  SELECT credits_balance INTO v_member_balance
  FROM public.user_wallets
  WHERE user_id = OLD.user_id;

  UPDATE public.user_wallets
  SET credits_balance = 0, updated_at = now()
  WHERE user_id = OLD.user_id;

  UPDATE public.user_wallets
  SET credits_balance = credits_balance + v_member_balance, updated_at = now()
  WHERE user_id = v_owner_id
  RETURNING credits_balance INTO v_owner_balance;

  IF v_member_balance <> 0 THEN
    INSERT INTO public.user_credit_transactions
      (user_id, type, amount, balance_after, description)
    VALUES
      (OLD.user_id, 'team_member_reclaim', -v_member_balance, 0, '离开团队，积分回收至所有者'),
      (v_owner_id, 'team_member_reclaim', v_member_balance, v_owner_balance, '团队成员离开，积分回收');

    INSERT INTO public.credit_transactions
      (team_id, user_id, type, amount, balance_after, operator_id, source_type, description)
    VALUES
      (OLD.team_id, OLD.user_id, 'reclaim', -v_member_balance, 0, auth.uid(), 'recharge',
       '成员离开或被移出团队，积分回收至所有者');
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_reclaim_leaving_member_credits ON public.team_members;
CREATE TRIGGER trg_reclaim_leaving_member_credits
  BEFORE DELETE ON public.team_members
  FOR EACH ROW EXECUTE FUNCTION public.reclaim_leaving_member_credits();

-- 将所有者个人积分分配给成员。
CREATE OR REPLACE FUNCTION public.allocate_team_credits(
  p_team_id uuid,
  p_user_id uuid,
  p_amount numeric,
  p_description text DEFAULT NULL
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_role text;
  v_target_role text;
  v_owner_id uuid;
  v_owner_balance numeric(12,2);
  v_target_balance numeric(12,2);
BEGIN
  IF p_amount <= 0 THEN RAISE EXCEPTION 'amount must be positive'; END IF;

  SELECT role INTO v_actor_role FROM public.team_members
  WHERE team_id = p_team_id AND user_id = auth.uid();
  IF v_actor_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'You do not have permission to allocate credits';
  END IF;

  SELECT role INTO v_target_role FROM public.team_members
  WHERE team_id = p_team_id AND user_id = p_user_id;
  IF v_target_role IS NULL THEN RAISE EXCEPTION 'Target member not found'; END IF;
  IF v_actor_role = 'admin' AND v_target_role <> 'member' THEN
    RAISE EXCEPTION 'Admin can only allocate credits to members';
  END IF;

  SELECT user_id INTO v_owner_id FROM public.team_members
  WHERE team_id = p_team_id AND role = 'owner';
  IF v_owner_id IS NULL THEN RAISE EXCEPTION 'Team owner not found'; END IF;
  IF p_user_id = v_owner_id THEN
    SELECT credits_balance INTO v_target_balance FROM public.user_wallets WHERE user_id = v_owner_id;
    RETURN COALESCE(v_target_balance, 0);
  END IF;

  INSERT INTO public.user_wallets (user_id, credits_balance)
  VALUES (v_owner_id, 0), (p_user_id, 0)
  ON CONFLICT (user_id) DO NOTHING;
  PERFORM 1 FROM public.user_wallets
  WHERE user_id = ANY (ARRAY[v_owner_id, p_user_id]) ORDER BY user_id FOR UPDATE;

  SELECT credits_balance INTO v_owner_balance FROM public.user_wallets WHERE user_id = v_owner_id;
  IF v_owner_balance < p_amount THEN RAISE EXCEPTION 'Insufficient owner credits'; END IF;

  UPDATE public.user_wallets SET credits_balance = credits_balance - p_amount, updated_at = now()
  WHERE user_id = v_owner_id;
  UPDATE public.user_wallets SET credits_balance = credits_balance + p_amount, updated_at = now()
  WHERE user_id = p_user_id RETURNING credits_balance INTO v_target_balance;

  INSERT INTO public.user_credit_transactions (user_id, type, amount, balance_after, description)
  VALUES
    (v_owner_id, 'team_allocate', -p_amount, v_owner_balance - p_amount, COALESCE(p_description, '团队积分分配')),
    (p_user_id, 'team_allocate', p_amount, v_target_balance, COALESCE(p_description, '团队积分分配'));
  INSERT INTO public.credit_transactions
    (team_id, user_id, type, amount, balance_after, operator_id, source_type, description)
  VALUES
    (p_team_id, p_user_id, 'allocate', p_amount, v_target_balance, auth.uid(), 'recharge',
     COALESCE(p_description, '积分分配'));

  RETURN v_target_balance;
END;
$$;

-- 将成员个人积分回收到所有者。
CREATE OR REPLACE FUNCTION public.reclaim_team_credits(
  p_team_id uuid,
  p_user_id uuid,
  p_amount numeric,
  p_description text DEFAULT NULL
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_role text;
  v_target_role text;
  v_owner_id uuid;
  v_target_balance numeric(12,2);
  v_owner_balance numeric(12,2);
BEGIN
  IF p_amount <= 0 THEN RAISE EXCEPTION 'amount must be positive'; END IF;
  SELECT role INTO v_actor_role FROM public.team_members
  WHERE team_id = p_team_id AND user_id = auth.uid();
  IF v_actor_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'You do not have permission to reclaim credits';
  END IF;
  SELECT role INTO v_target_role FROM public.team_members
  WHERE team_id = p_team_id AND user_id = p_user_id;
  IF v_target_role IS NULL THEN RAISE EXCEPTION 'Target member not found'; END IF;
  IF v_actor_role = 'admin' AND v_target_role <> 'member' THEN
    RAISE EXCEPTION 'Admin can only reclaim credits from members';
  END IF;
  SELECT user_id INTO v_owner_id FROM public.team_members
  WHERE team_id = p_team_id AND role = 'owner';
  IF v_owner_id IS NULL THEN RAISE EXCEPTION 'Team owner not found'; END IF;
  IF p_user_id = v_owner_id THEN
    SELECT credits_balance INTO v_target_balance FROM public.user_wallets WHERE user_id = v_owner_id;
    RETURN COALESCE(v_target_balance, 0);
  END IF;

  INSERT INTO public.user_wallets (user_id, credits_balance)
  VALUES (v_owner_id, 0), (p_user_id, 0)
  ON CONFLICT (user_id) DO NOTHING;
  PERFORM 1 FROM public.user_wallets
  WHERE user_id = ANY (ARRAY[v_owner_id, p_user_id]) ORDER BY user_id FOR UPDATE;
  SELECT credits_balance INTO v_target_balance FROM public.user_wallets WHERE user_id = p_user_id;
  IF v_target_balance < p_amount THEN RAISE EXCEPTION 'Member has insufficient credits to reclaim'; END IF;

  UPDATE public.user_wallets SET credits_balance = credits_balance - p_amount, updated_at = now()
  WHERE user_id = p_user_id RETURNING credits_balance INTO v_target_balance;
  UPDATE public.user_wallets SET credits_balance = credits_balance + p_amount, updated_at = now()
  WHERE user_id = v_owner_id RETURNING credits_balance INTO v_owner_balance;

  INSERT INTO public.user_credit_transactions (user_id, type, amount, balance_after, description)
  VALUES
    (p_user_id, 'team_reclaim', -p_amount, v_target_balance, COALESCE(p_description, '团队积分回收')),
    (v_owner_id, 'team_reclaim', p_amount, v_owner_balance, COALESCE(p_description, '团队积分回收'));
  INSERT INTO public.credit_transactions
    (team_id, user_id, type, amount, balance_after, operator_id, source_type, description)
  VALUES
    (p_team_id, p_user_id, 'reclaim', -p_amount, v_target_balance, auth.uid(), 'recharge',
     COALESCE(p_description, '积分回收'));

  RETURN v_target_balance;
END;
$$;

-- 团队成员之间的积分转账，实际移动两人的个人钱包。
CREATE OR REPLACE FUNCTION public.transfer_team_credits(
  p_team_id uuid,
  p_to_user_id uuid,
  p_amount numeric,
  p_description text DEFAULT NULL
)
RETURNS TABLE (from_new_balance numeric, to_new_balance numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from_user_id uuid := auth.uid();
  v_from_balance numeric(12,2);
  v_to_balance numeric(12,2);
BEGIN
  IF p_amount <= 0 THEN RAISE EXCEPTION 'amount must be positive'; END IF;
  IF p_to_user_id = v_from_user_id THEN RAISE EXCEPTION 'Cannot transfer credits to yourself'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.team_members WHERE team_id = p_team_id AND user_id = v_from_user_id) THEN
    RAISE EXCEPTION 'You are not a member of this team';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.team_members WHERE team_id = p_team_id AND user_id = p_to_user_id) THEN
    RAISE EXCEPTION 'Target member not found in this team';
  END IF;

  INSERT INTO public.user_wallets (user_id, credits_balance)
  VALUES (v_from_user_id, 0), (p_to_user_id, 0)
  ON CONFLICT (user_id) DO NOTHING;
  PERFORM 1 FROM public.user_wallets
  WHERE user_id = ANY (ARRAY[v_from_user_id, p_to_user_id]) ORDER BY user_id FOR UPDATE;
  SELECT credits_balance INTO v_from_balance FROM public.user_wallets WHERE user_id = v_from_user_id;
  IF v_from_balance < p_amount THEN RAISE EXCEPTION 'Insufficient credits'; END IF;

  UPDATE public.user_wallets SET credits_balance = credits_balance - p_amount, updated_at = now()
  WHERE user_id = v_from_user_id RETURNING credits_balance INTO v_from_balance;
  UPDATE public.user_wallets SET credits_balance = credits_balance + p_amount, updated_at = now()
  WHERE user_id = p_to_user_id RETURNING credits_balance INTO v_to_balance;

  INSERT INTO public.user_credit_transactions (user_id, type, amount, balance_after, description)
  VALUES
    (v_from_user_id, 'team_transfer_out', -p_amount, v_from_balance, COALESCE(p_description, '团队成员转账')),
    (p_to_user_id, 'team_transfer_in', p_amount, v_to_balance, COALESCE(p_description, '团队成员转账'));
  INSERT INTO public.credit_transactions
    (team_id, user_id, type, amount, balance_after, operator_id, source_type, description)
  VALUES
    (p_team_id, v_from_user_id, 'transfer_out', -p_amount, v_from_balance, v_from_user_id, 'recharge',
     COALESCE(p_description, '转账给成员')),
    (p_team_id, p_to_user_id, 'transfer_in', p_amount, v_to_balance, v_from_user_id, 'recharge',
     COALESCE(p_description, '收到转账'));
  INSERT INTO public.transfer_records
    (team_id, from_user_id, to_user_id, amount, from_balance_after, to_balance_after, operator_id)
  VALUES
    (p_team_id, v_from_user_id, p_to_user_id, p_amount, v_from_balance, v_to_balance, v_from_user_id);

  RETURN QUERY SELECT v_from_balance, v_to_balance;
END;
$$;

REVOKE ALL ON FUNCTION public.allocate_team_credits(uuid, uuid, numeric, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reclaim_team_credits(uuid, uuid, numeric, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.transfer_team_credits(uuid, uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.allocate_team_credits(uuid, uuid, numeric, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reclaim_team_credits(uuid, uuid, numeric, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.transfer_team_credits(uuid, uuid, numeric, text) TO authenticated, service_role;

-- 创建团队的初始积分直接发给创建者的个人钱包。
CREATE OR REPLACE FUNCTION public.create_team_as_owner(
  p_name text,
  p_description text DEFAULT NULL,
  p_credits integer DEFAULT 0
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_team_id uuid;
  v_balance numeric(12,2);
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF char_length(btrim(coalesce(p_name, ''))) = 0 OR char_length(p_name) > 100 THEN
    RAISE EXCEPTION 'invalid team name';
  END IF;
  IF char_length(coalesce(p_description, '')) > 500 THEN RAISE EXCEPTION 'team description is too long'; END IF;
  IF coalesce(p_credits, 0) < 0 OR coalesce(p_credits, 0) > 99999999 THEN
    RAISE EXCEPTION 'invalid initial credits';
  END IF;

  INSERT INTO public.user_wallets (user_id, credits_balance)
  VALUES (v_uid, coalesce(p_credits, 0))
  ON CONFLICT (user_id) DO UPDATE
  SET credits_balance = public.user_wallets.credits_balance + EXCLUDED.credits_balance,
      updated_at = now()
  RETURNING credits_balance INTO v_balance;
  IF coalesce(p_credits, 0) > 0 THEN
    INSERT INTO public.user_credit_transactions (user_id, type, amount, balance_after, description)
    VALUES (v_uid, 'team_initial_credit', p_credits, v_balance, '创建团队初始积分');
  END IF;

  INSERT INTO public.teams (name, description, owner_id)
  VALUES (btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''), v_uid)
  RETURNING id INTO v_team_id;
  INSERT INTO public.team_members (team_id, user_id, role, credits_balance, subscription_credits)
  VALUES (v_team_id, v_uid, 'owner', 0, 0);
  RETURN v_team_id;
END;
$$;

-- 解散团队时先逐个移除非所有者成员，复用回收触发器；所有者的钱包保留最终余额。
CREATE OR REPLACE FUNCTION public.dissolve_team_with_refund(p_team_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner_id uuid;
BEGIN
  SELECT owner_id INTO v_owner_id FROM public.teams
  WHERE id = p_team_id AND deleted_at IS NULL;
  IF v_owner_id IS NULL THEN RAISE EXCEPTION 'Team not found or already deleted'; END IF;
  IF auth.uid() <> v_owner_id THEN RAISE EXCEPTION 'Only the team owner can dissolve the team'; END IF;

  DELETE FROM public.team_members WHERE team_id = p_team_id AND role <> 'owner';
  UPDATE public.teams SET deleted_at = now(), updated_at = now() WHERE id = p_team_id;
  DELETE FROM public.team_members WHERE team_id = p_team_id AND role = 'owner';
END;
$$;

-- 管理端团队列表展示所有成员个人积分之和；给团队加分则加到所有者个人钱包。
DROP FUNCTION IF EXISTS public.admin_list_credit_recipients(text, integer, integer);
CREATE FUNCTION public.admin_list_credit_recipients(
  p_kind text,
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 25,
  p_query text DEFAULT ''
)
RETURNS TABLE (
  target_id uuid,
  target_type text,
  name text,
  email text,
  balance numeric,
  created_at timestamptz,
  total_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  PERFORM public.assert_credit_admin();
  IF p_kind NOT IN ('user', 'team') THEN RAISE EXCEPTION 'Unsupported recipient type'; END IF;
  IF p_page < 1 OR p_page_size < 1 OR p_page_size > 100 THEN RAISE EXCEPTION 'Invalid page'; END IF;

  IF p_kind = 'user' THEN
    RETURN QUERY
    SELECT u.id, 'user'::text,
      COALESCE(u.raw_user_meta_data ->> 'display_name', u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', u.email::text)::text,
      u.email::text, COALESCE(w.credits_balance, 0)::numeric, u.created_at, COUNT(*) OVER ()
    FROM auth.users u
    LEFT JOIN public.user_wallets w ON w.user_id = u.id
    WHERE coalesce(p_query, '') = ''
      OR u.email ILIKE '%' || p_query || '%'
      OR COALESCE(u.raw_user_meta_data ->> 'display_name', u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', '') ILIKE '%' || p_query || '%'
    ORDER BY u.created_at DESC
    OFFSET (p_page - 1) * p_page_size LIMIT p_page_size;
  ELSE
    RETURN QUERY
    SELECT t.id, 'team'::text, t.name, owner.email::text,
      COALESCE((SELECT SUM(m.credits_balance) FROM public.team_members m WHERE m.team_id = t.id), 0)::numeric,
      t.created_at, COUNT(*) OVER ()
    FROM public.teams t
    LEFT JOIN auth.users owner ON owner.id = t.owner_id
    WHERE t.deleted_at IS NULL
      AND (coalesce(p_query, '') = '' OR t.name ILIKE '%' || p_query || '%' OR owner.email ILIKE '%' || p_query || '%')
    ORDER BY t.created_at DESC
    OFFSET (p_page - 1) * p_page_size LIMIT p_page_size;
  END IF;
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
  IF p_target_type NOT IN ('user', 'team') OR p_amount <= 0 THEN RAISE EXCEPTION 'Invalid credit grant'; END IF;

  IF p_target_type = 'user' THEN
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

REVOKE ALL ON FUNCTION public.create_team_as_owner(text, text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dissolve_team_with_refund(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_list_credit_recipients(text, integer, integer, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_grant_credits(text, uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_team_as_owner(text, text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dissolve_team_with_refund(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_credit_recipients(text, integer, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_grant_credits(text, uuid, integer, text) TO authenticated;
