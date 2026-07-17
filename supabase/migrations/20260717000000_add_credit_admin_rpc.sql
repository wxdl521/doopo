-- 后台积分分配（不使用 service role key）
--
-- 前端/Server Function 始终以登录用户的 JWT 调用以下 RPC。函数在数据库内
-- 校验 admin_users 白名单，因此 service role key 无须配置到应用运行环境。

CREATE TABLE IF NOT EXISTS public.admin_users (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.admin_users FROM anon, authenticated;

-- 初始管理员。之后增加账号时，由项目所有者在 SQL Editor 执行：
-- INSERT INTO public.admin_users (user_id)
-- SELECT id FROM auth.users WHERE lower(email) = lower('new-admin@example.com')
-- ON CONFLICT (user_id) DO NOTHING;
INSERT INTO public.admin_users (user_id)
SELECT id FROM auth.users WHERE lower(email) = lower('liaowangg@163.com')
ON CONFLICT (user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.is_credit_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_users WHERE user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.assert_credit_admin()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_credit_admin() THEN
    RAISE EXCEPTION 'Admin permission required' USING ERRCODE = '42501';
  END IF;
END;
$$;

-- 查询全部已注册个人用户或全部团队，使用分页避免一次性暴露大量数据。
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

-- 原子加积分并记录流水。团队积分保存在 owner 对应的 team_members 余额中，
-- 与现有团队积分系统保持一致。
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
  v_balance numeric;
  v_owner_id uuid;
BEGIN
  PERFORM public.assert_credit_admin();
  IF p_target_type NOT IN ('user', 'team') OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Invalid credit grant';
  END IF;

  IF p_target_type = 'user' THEN
    INSERT INTO public.user_wallets (user_id, credits_balance)
    VALUES (p_target_id, p_amount)
    ON CONFLICT (user_id) DO UPDATE
      SET credits_balance = public.user_wallets.credits_balance + EXCLUDED.credits_balance,
          updated_at = now()
    RETURNING credits_balance INTO v_balance;

    INSERT INTO public.user_credit_transactions
      (user_id, type, amount, balance_after, description)
    VALUES
      (p_target_id, 'admin_grant', p_amount, v_balance, COALESCE(p_description, '管理员分配积分'));
  ELSE
    SELECT user_id INTO v_owner_id
    FROM public.team_members
    WHERE team_id = p_target_id AND role = 'owner'
    FOR UPDATE;

    IF v_owner_id IS NULL THEN
      RAISE EXCEPTION 'Team owner wallet not found';
    END IF;

    UPDATE public.team_members
    SET credits_balance = credits_balance + p_amount
    WHERE team_id = p_target_id AND user_id = v_owner_id
    RETURNING credits_balance INTO v_balance;

    INSERT INTO public.credit_transactions
      (team_id, user_id, type, amount, balance_after, operator_id, description)
    VALUES
      (p_target_id, v_owner_id, 'admin_grant', p_amount, v_balance, auth.uid(), COALESCE(p_description, '管理员分配积分'));
  END IF;

  RETURN QUERY SELECT v_balance;
END;
$$;

-- 现有团队流水约束加入后台发放类型。
ALTER TABLE public.credit_transactions
  DROP CONSTRAINT IF EXISTS credit_transactions_type_check;
ALTER TABLE public.credit_transactions
  ADD CONSTRAINT credit_transactions_type_check CHECK (
    type IN ('allocate', 'reclaim', 'transfer_in', 'transfer_out', 'consume', 'refund', 'admin_grant')
  );

REVOKE ALL ON FUNCTION public.is_credit_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.assert_credit_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_list_credit_recipients(text, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_grant_credits(text, uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_credit_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_credit_recipients(text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_grant_credits(text, uuid, integer, text) TO authenticated;
