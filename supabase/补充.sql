-- Part 1: RPC 获取团队成员资料（成员名 + 邮箱）
CREATE OR REPLACE FUNCTION public.get_team_member_profiles(p_user_ids uuid[])
RETURNS TABLE(
  user_id uuid,
  email text,
  raw_user_meta_data jsonb
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    u.id AS user_id,
    u.email::text,
    u.raw_user_meta_data
  FROM auth.users u
  WHERE u.id = ANY(p_user_ids);
$$;

-- Part 2: 修复团队加入流程
-- 2a. 修复 INSERT 策略：允许用户通过邀请链接自己加入（auth.uid() = user_id）
DROP POLICY IF EXISTS members_insert_owner_or_admin ON team_members;
CREATE POLICY members_insert_owner_or_admin ON team_members
  FOR INSERT TO authenticated
  WITH CHECK (
    (auth.uid() = user_id)
    AND role = 'member'
  );
-- 2b. 允许任何登录用户查看未删除的团队（加入页需要显示团队名称）
DROP POLICY IF EXISTS teams_select_member ON teams;
CREATE POLICY teams_select_member ON teams
  FOR SELECT TO authenticated
  USING (deleted_at IS NULL);

-- Part 3: 个人积分钱包
CREATE TABLE IF NOT EXISTS public.user_wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  credits_balance integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_wallets ENABLE ROW LEVEL SECURITY;

-- 用户只能读自己的钱包
DROP POLICY IF EXISTS user_wallets_select_own ON user_wallets;
CREATE POLICY user_wallets_select_own ON user_wallets
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- 用户可创建自己的钱包
DROP POLICY IF EXISTS user_wallets_insert_self ON user_wallets;
CREATE POLICY user_wallets_insert_self ON user_wallets
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- 自动更新 updated_at
DROP TRIGGER IF EXISTS set_updated_at_user_wallets ON user_wallets;
CREATE TRIGGER set_updated_at_user_wallets
  BEFORE UPDATE ON public.user_wallets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 安全充值 RPC（只能给自己加、只能加正数）
CREATE OR REPLACE FUNCTION public.add_user_credits(p_amount integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'amount must be positive';
  END IF;

  INSERT INTO public.user_wallets (user_id, credits_balance)
  VALUES (auth.uid(), p_amount)
  ON CONFLICT (user_id) DO UPDATE
  SET credits_balance = user_wallets.credits_balance + p_amount,
      updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.add_user_credits(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_user_credits(integer) TO authenticated;
