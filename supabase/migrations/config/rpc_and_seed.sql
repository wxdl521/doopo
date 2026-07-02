-- ============================================================
-- 合并脚本: RPC 函数 + 测试积分
-- 发给老板在 Supabase SQL Editor 一次性跑完
-- ============================================================

-- 1. RPC: 批量获取团队成员资料（访问 auth.users）
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

-- 2. 测试用: 给指定用户加积分
UPDATE public.team_members
SET credits_balance = 10000
WHERE user_id = '67b417f0-c541-4a91-8726-2664f4c1029b'
  AND team_id = 'a2b41c33-8a47-4cb8-b6ee-c62e2e378005';
