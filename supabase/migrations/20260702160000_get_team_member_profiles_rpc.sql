-- ============================================================
-- RPC 函数: get_team_member_profiles
-- 用于团队成员管理页面批量获取用户邮箱和显示名称
-- SECURITY DEFINER 以访问 auth.users 表
-- ============================================================
-- 执行方式：在 Supabase SQL Editor 中运行此文件

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
