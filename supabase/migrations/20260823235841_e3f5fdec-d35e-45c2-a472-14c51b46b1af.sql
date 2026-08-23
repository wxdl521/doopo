CREATE OR REPLACE FUNCTION public.admin_revoke_credits(p_target_type text, p_target_id uuid, p_amount integer, p_description text DEFAULT NULL::text)
 RETURNS TABLE(balance_after numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_owner_id uuid;
  v_owner_balance numeric(12,2);
  v_team_balance numeric(12,2);
BEGIN
  PERFORM public.assert_credit_admin();

  IF p_target_type NOT IN ('user', 'team') OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Invalid credit revoke';
  END IF;

  IF p_target_type = 'user' THEN
    INSERT INTO public.user_wallets (user_id, credits_balance)
    VALUES (p_target_id, 0)
    ON CONFLICT (user_id) DO NOTHING;

    SELECT credits_balance INTO v_owner_balance
    FROM public.user_wallets
    WHERE user_id = p_target_id
    FOR UPDATE;

    IF COALESCE(v_owner_balance, 0) < p_amount THEN
      RAISE EXCEPTION 'Insufficient credits to revoke';
    END IF;

    UPDATE public.user_wallets
    SET credits_balance = credits_balance - p_amount,
        updated_at = now()
    WHERE user_id = p_target_id
    RETURNING credits_balance INTO v_owner_balance;

    INSERT INTO public.user_credit_transactions
      (user_id, type, amount, balance_after, description)
    VALUES
      (p_target_id, 'admin_revoke', -p_amount, v_owner_balance,
       COALESCE(p_description, '管理员回收积分'));

    RETURN QUERY SELECT v_owner_balance;
    RETURN;
  END IF;

  SELECT user_id INTO v_owner_id
  FROM public.team_members
  WHERE team_id = p_target_id AND role = 'owner'
  FOR UPDATE;

  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'Team owner wallet not found';
  END IF;

  INSERT INTO public.user_wallets (user_id, credits_balance)
  VALUES (v_owner_id, 0)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT credits_balance INTO v_owner_balance
  FROM public.user_wallets
  WHERE user_id = v_owner_id
  FOR UPDATE;

  IF COALESCE(v_owner_balance, 0) < p_amount THEN
    RAISE EXCEPTION 'Insufficient credits to revoke';
  END IF;

  UPDATE public.user_wallets
  SET credits_balance = credits_balance - p_amount,
      updated_at = now()
  WHERE user_id = v_owner_id
  RETURNING credits_balance INTO v_owner_balance;

  SELECT COALESCE(SUM(credits_balance), 0) INTO v_team_balance
  FROM public.team_members
  WHERE team_id = p_target_id;

  INSERT INTO public.user_credit_transactions
    (user_id, type, amount, balance_after, description)
  VALUES
    (v_owner_id, 'admin_revoke', -p_amount, v_owner_balance,
     COALESCE(p_description, '管理员回收积分'));

  INSERT INTO public.credit_transactions
    (team_id, user_id, type, amount, balance_after, operator_id, source_type, description)
  VALUES
    (p_target_id, v_owner_id, 'admin_revoke', -p_amount, v_team_balance,
     auth.uid(), 'recharge', COALESCE(p_description, '管理员回收积分'));

  RETURN QUERY SELECT v_team_balance;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_revoke_credits(text, uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_revoke_credits(text, uuid, integer, text) TO authenticated;