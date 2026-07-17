-- 一次性执行：启用积分分配搜索，并将 2801260735@qq.com 添加为管理员。
-- 前置条件：已执行 20260717000000_add_credit_admin_rpc.sql。
-- 请在 Supabase SQL Editor 中以项目数据库管理员身份运行。

BEGIN;

-- 积分分配列表新增 p_query 搜索参数。
DROP FUNCTION IF EXISTS public.admin_list_credit_recipients(text, integer, integer);

CREATE FUNCTION public.admin_list_credit_recipients(
  p_kind text,
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 10,
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
  IF p_kind NOT IN ('user', 'team') THEN
    RAISE EXCEPTION 'Unsupported recipient type';
  END IF;
  IF p_page < 1 OR p_page_size < 1 OR p_page_size > 100 THEN
    RAISE EXCEPTION 'Invalid page';
  END IF;

  p_query := trim(COALESCE(p_query, ''));

  IF p_kind = 'user' THEN
    RETURN QUERY
    WITH recipients AS (
      SELECT
        u.id AS target_id,
        'user'::text AS target_type,
        COALESCE(
          u.raw_user_meta_data ->> 'display_name',
          u.raw_user_meta_data ->> 'full_name',
          u.raw_user_meta_data ->> 'name',
          u.email::text
        )::text AS name,
        u.email::text AS email,
        COALESCE(w.credits_balance, 0)::numeric AS balance,
        u.created_at
      FROM auth.users u
      LEFT JOIN public.user_wallets w ON w.user_id = u.id
    )
    SELECT
      recipients.target_id,
      recipients.target_type,
      recipients.name,
      recipients.email,
      recipients.balance,
      recipients.created_at,
      COUNT(*) OVER ()
    FROM recipients
    WHERE p_query = ''
      OR COALESCE(recipients.name, '') ILIKE '%' || p_query || '%'
      OR COALESCE(recipients.email, '') ILIKE '%' || p_query || '%'
    ORDER BY recipients.created_at DESC
    OFFSET (p_page - 1) * p_page_size LIMIT p_page_size;
  ELSE
    RETURN QUERY
    WITH recipients AS (
      SELECT
        t.id AS target_id,
        'team'::text AS target_type,
        t.name,
        owner.email::text AS email,
        COALESCE(member.credits_balance, 0)::numeric AS balance,
        t.created_at
      FROM public.teams t
      LEFT JOIN public.team_members member
        ON member.team_id = t.id AND member.role = 'owner'
      LEFT JOIN auth.users owner ON owner.id = t.owner_id
      WHERE t.deleted_at IS NULL
    )
    SELECT
      recipients.target_id,
      recipients.target_type,
      recipients.name,
      recipients.email,
      recipients.balance,
      recipients.created_at,
      COUNT(*) OVER ()
    FROM recipients
    WHERE p_query = ''
      OR COALESCE(recipients.name, '') ILIKE '%' || p_query || '%'
      OR COALESCE(recipients.email, '') ILIKE '%' || p_query || '%'
    ORDER BY recipients.created_at DESC
    OFFSET (p_page - 1) * p_page_size LIMIT p_page_size;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_credit_recipients(text, integer, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_credit_recipients(text, integer, integer, text) TO authenticated;

-- 新管理员必须已注册；账号不存在时抛错并回滚整个事务。
DO $$
DECLARE
  v_user_id uuid;
BEGIN
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE lower(email) = lower('2801260735@qq.com');

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Registered user not found: 2801260735@qq.com';
  END IF;

  INSERT INTO public.admin_users (user_id)
  VALUES (v_user_id)
  ON CONFLICT (user_id) DO NOTHING;
END;
$$;

COMMIT;
