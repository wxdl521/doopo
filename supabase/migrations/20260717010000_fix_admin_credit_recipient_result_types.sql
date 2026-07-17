-- 修复 auth.users.email(varchar) 与 RPC 声明 text 的严格类型不匹配。
-- 已执行过 20260717000000 的环境需要执行本迁移。

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
