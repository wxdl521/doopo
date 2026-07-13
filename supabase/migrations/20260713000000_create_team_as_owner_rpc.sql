-- 待管理员在 Supabase SQL Editor 执行：
-- 通过当前登录用户的 auth.uid() 原子创建团队和其 owner 成员，避免初始
-- team_members 插入被 RLS 拒绝。无需给应用配置 service_role key。

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
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF char_length(btrim(coalesce(p_name, ''))) = 0 OR char_length(p_name) > 100 THEN
    RAISE EXCEPTION 'invalid team name';
  END IF;

  IF char_length(coalesce(p_description, '')) > 500 THEN
    RAISE EXCEPTION 'team description is too long';
  END IF;

  IF coalesce(p_credits, 0) < 0 OR coalesce(p_credits, 0) > 99999999 THEN
    RAISE EXCEPTION 'invalid initial credits';
  END IF;

  INSERT INTO public.teams (name, description, owner_id)
  VALUES (btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''), v_uid)
  RETURNING id INTO v_team_id;

  INSERT INTO public.team_members (
    team_id,
    user_id,
    role,
    credits_balance,
    subscription_credits
  )
  VALUES (v_team_id, v_uid, 'owner', coalesce(p_credits, 0), 0);

  RETURN v_team_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_team_as_owner(text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_team_as_owner(text, text, integer)
  TO authenticated, service_role;
