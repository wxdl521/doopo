-- 一次性执行：修复后台积分分配列表，并给 805238877@qq.com 发放 2,000 个人积分。
-- 前置条件：已执行 20260717000000_add_credit_admin_rpc.sql。
-- 请在 Supabase SQL Editor 中以项目数据库管理员身份运行；无需 service role key。

BEGIN;

-- 修复 auth.users.email(varchar) 与 RPC 返回值 text 的严格类型不匹配。
CREATE OR REPLACE FUNCTION public.admin_list_credit_recipients(
  p_kind text,
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 25
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
  IF p_kind NOT IN ('user', 'team') THEN
    RAISE EXCEPTION 'Unsupported recipient type';
  END IF;
  IF p_page < 1 OR p_page_size < 1 OR p_page_size > 100 THEN
    RAISE EXCEPTION 'Invalid page';
  END IF;

  IF p_kind = 'user' THEN
    RETURN QUERY
    SELECT
      u.id,
      'user'::text,
      COALESCE(
        u.raw_user_meta_data ->> 'display_name',
        u.raw_user_meta_data ->> 'full_name',
        u.raw_user_meta_data ->> 'name',
        u.email::text
      )::text,
      u.email::text,
      COALESCE(w.credits_balance, 0)::numeric,
      u.created_at,
      COUNT(*) OVER ()
    FROM auth.users u
    LEFT JOIN public.user_wallets w ON w.user_id = u.id
    ORDER BY u.created_at DESC
    OFFSET (p_page - 1) * p_page_size LIMIT p_page_size;
  ELSE
    RETURN QUERY
    SELECT
      t.id,
      'team'::text,
      t.name,
      owner.email::text,
      COALESCE(member.credits_balance, 0)::numeric,
      t.created_at,
      COUNT(*) OVER ()
    FROM public.teams t
    LEFT JOIN public.team_members member
      ON member.team_id = t.id AND member.role = 'owner'
    LEFT JOIN auth.users owner ON owner.id = t.owner_id
    WHERE t.deleted_at IS NULL
    ORDER BY t.created_at DESC
    OFFSET (p_page - 1) * p_page_size LIMIT p_page_size;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_credit_recipients(text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_credit_recipients(text, integer, integer) TO authenticated;

-- 给指定已注册用户增加 2,000 积分，并记录可审计流水。
DO $$
DECLARE
  v_user_id uuid;
  v_balance numeric;
BEGIN
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE lower(email) = lower('805238877@qq.com');

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Registered user not found: 805238877@qq.com';
  END IF;

  INSERT INTO public.user_wallets (user_id, credits_balance)
  VALUES (v_user_id, 2000)
  ON CONFLICT (user_id) DO UPDATE
    SET credits_balance = public.user_wallets.credits_balance + EXCLUDED.credits_balance,
        updated_at = now()
  RETURNING credits_balance INTO v_balance;

  INSERT INTO public.user_credit_transactions
    (user_id, type, amount, balance_after, description)
  VALUES
    (v_user_id, 'admin_grant', 2000, v_balance, '管理员手工发放 2000 积分');
END;
$$;

COMMIT;
