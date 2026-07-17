-- 后台积分分配：按用户名称/邮箱或团队名称/所有者邮箱搜索。
-- 函数新增 p_query 参数，需先移除旧的三参数版本。

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
    WHERE trim(COALESCE(p_query, '')) = ''
      OR COALESCE(recipients.name, '') ILIKE '%' || trim(COALESCE(p_query, '')) || '%'
      OR COALESCE(recipients.email, '') ILIKE '%' || trim(COALESCE(p_query, '')) || '%'
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
    WHERE trim(COALESCE(p_query, '')) = ''
      OR COALESCE(recipients.name, '') ILIKE '%' || trim(COALESCE(p_query, '')) || '%'
      OR COALESCE(recipients.email, '') ILIKE '%' || trim(COALESCE(p_query, '')) || '%'
    ORDER BY recipients.created_at DESC
    OFFSET (p_page - 1) * p_page_size LIMIT p_page_size;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_credit_recipients(text, integer, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_credit_recipients(text, integer, integer, text) TO authenticated;
