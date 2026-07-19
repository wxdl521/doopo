-- 管理员仅可通过积分 RPC 为普通成员分配积分；成员角色和移除操作仅限团队所有者。
-- 小组长由应用层在指派时同步提升为 admin，因而可使用组内管理权限。

DROP POLICY IF EXISTS members_update_owner_or_admin ON public.team_members;
CREATE POLICY members_update_owner_or_admin ON public.team_members
  FOR UPDATE TO authenticated
  USING (public.has_team_role(team_id, ARRAY['owner']))
  WITH CHECK (public.has_team_role(team_id, ARRAY['owner']));

DROP POLICY IF EXISTS members_delete_owner_admin_or_self ON public.team_members;
CREATE POLICY members_delete_owner_admin_or_self ON public.team_members
  FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_team_role(team_id, ARRAY['owner'])
  );
