-- ============================================================
-- 修复: team_members RLS 无限递归
-- 原因: 策略中 EXISTS (SELECT ... FROM team_members) 自己查自己
-- 解决: 用 SECURITY DEFINER 函数绕过 RLS
-- ============================================================

-- Phase 1: 辅助函数
-- ============================================================

-- 检查用户是否为团队成员
CREATE OR REPLACE FUNCTION public.is_in_team(p_team_id uuid, p_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.team_members
    WHERE team_id = p_team_id AND user_id = p_user_id
  );
$$;

-- 检查用户在团队中的角色
CREATE OR REPLACE FUNCTION public.has_team_role(p_team_id uuid, p_roles text[], p_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.team_members
    WHERE team_id = p_team_id AND user_id = p_user_id AND role = ANY(p_roles)
  );
$$;

-- Phase 2: 重建 team_members 策略
-- ============================================================

-- 删除旧的 team_members 策略
DROP POLICY IF EXISTS "members_select_own_or_team" ON public.team_members;
DROP POLICY IF EXISTS "members_insert_owner_or_admin" ON public.team_members;
DROP POLICY IF EXISTS "members_update_owner_or_admin" ON public.team_members;
DROP POLICY IF EXISTS "members_delete_owner_admin_or_self" ON public.team_members;

-- 重建 SELECT: 自己或同团队成员可看
CREATE POLICY "members_select_own_or_team" ON public.team_members
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_in_team(team_id));

-- 重建 INSERT: owner/admin 可邀请，用户可加入自己
CREATE POLICY "members_insert_owner_or_admin" ON public.team_members
  FOR INSERT TO authenticated
  WITH CHECK (public.has_team_role(team_id, ARRAY['owner','admin']) OR auth.uid() = user_id);

-- 重建 UPDATE: owner 可改所有人，admin 只可改 member
CREATE POLICY "members_update_owner_or_admin" ON public.team_members
  FOR UPDATE TO authenticated
  USING (
    public.has_team_role(team_id, ARRAY['owner'])
    OR (public.has_team_role(team_id, ARRAY['admin']) AND role = 'member')
  )
  WITH CHECK (
    public.has_team_role(team_id, ARRAY['owner'])
    OR (public.has_team_role(team_id, ARRAY['admin']) AND role = 'member')
  );

-- 重建 DELETE: owner 可删任何人，admin 可删 member，自己可离开
CREATE POLICY "members_delete_owner_admin_or_self" ON public.team_members
  FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_team_role(team_id, ARRAY['owner'])
    OR (public.has_team_role(team_id, ARRAY['admin']) AND role = 'member')
  );

-- Phase 3: 重建 teams 策略
-- ============================================================

DROP POLICY IF EXISTS "teams_select_member" ON public.teams;

CREATE POLICY "teams_select_member" ON public.teams
  FOR SELECT TO authenticated
  USING (public.is_in_team(id) OR auth.uid() = owner_id);

-- Phase 4: 重建流水/转账策略
-- ============================================================

DROP POLICY IF EXISTS "transactions_select_team_member" ON public.credit_transactions;
DROP POLICY IF EXISTS "transactions_insert_authenticated" ON public.credit_transactions;
DROP POLICY IF EXISTS "transfers_select_team_member" ON public.transfer_records;
DROP POLICY IF EXISTS "transfers_insert_authenticated" ON public.transfer_records;

CREATE POLICY "transactions_select_team_member" ON public.credit_transactions
  FOR SELECT TO authenticated
  USING (public.is_in_team(team_id));

CREATE POLICY "transactions_insert_authenticated" ON public.credit_transactions
  FOR INSERT TO authenticated
  WITH CHECK (public.has_team_role(team_id, ARRAY['owner','admin']));

CREATE POLICY "transfers_select_team_member" ON public.transfer_records
  FOR SELECT TO authenticated
  USING (public.is_in_team(team_id));

CREATE POLICY "transfers_insert_authenticated" ON public.transfer_records
  FOR INSERT TO authenticated
  WITH CHECK (public.is_in_team(team_id));
