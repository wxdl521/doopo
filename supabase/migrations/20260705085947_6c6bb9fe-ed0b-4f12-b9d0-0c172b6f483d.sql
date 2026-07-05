
-- 1) Restrict SECURITY DEFINER helpers: no anon / public execute
REVOKE ALL ON FUNCTION public.is_in_team(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_team_role(uuid, text[], uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_team_member_profiles(uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.add_user_credits(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_in_team(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_team_role(uuid, text[], uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_team_member_profiles(uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.add_user_credits(integer) TO authenticated, service_role;

-- 2) teams SELECT — restrict to members / owner
DROP POLICY IF EXISTS teams_select_member ON public.teams;
CREATE POLICY teams_select_member ON public.teams
  FOR SELECT TO authenticated
  USING (deleted_at IS NULL AND (auth.uid() = owner_id OR public.is_in_team(id)));

-- 2a) SECURITY DEFINER helper so the join page can show the team name to non-members
CREATE OR REPLACE FUNCTION public.get_team_public_info(p_team_id uuid)
RETURNS TABLE (id uuid, name text, description text, owner_id uuid, created_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.id, t.name, t.description, t.owner_id, t.created_at
  FROM public.teams t
  WHERE t.id = p_team_id AND t.deleted_at IS NULL;
$$;
REVOKE ALL ON FUNCTION public.get_team_public_info(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_team_public_info(uuid) TO authenticated, service_role;

-- 3) team_members INSERT — only owner/admin can add members; no self-insert
DROP POLICY IF EXISTS members_insert_owner_or_admin ON public.team_members;
CREATE POLICY members_insert_owner_or_admin ON public.team_members
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_team_role(team_id, ARRAY['owner','admin'])
    AND role = 'member'
  );

-- 3a) SECURITY DEFINER server-side join helper (bypasses restricted RLS after own checks)
CREATE OR REPLACE FUNCTION public.join_team_as_self(p_team_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.teams WHERE id = p_team_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'team not found';
  END IF;
  INSERT INTO public.team_members (team_id, user_id, role)
  VALUES (p_team_id, v_uid, 'member')
  ON CONFLICT (team_id, user_id) DO NOTHING;
END;
$$;
REVOKE ALL ON FUNCTION public.join_team_as_self(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_team_as_self(uuid) TO authenticated, service_role;

-- 4) team_members UPDATE — only owner can change role; admins cannot escalate
DROP POLICY IF EXISTS members_update_owner_or_admin ON public.team_members;
CREATE POLICY members_update_owner_or_admin ON public.team_members
  FOR UPDATE TO authenticated
  USING (
    public.has_team_role(team_id, ARRAY['owner'])
    OR (public.has_team_role(team_id, ARRAY['admin']) AND role = 'member')
  )
  WITH CHECK (
    -- Owner can write any role except elevating past 'admin' to 'owner' remains scoped to owner.
    public.has_team_role(team_id, ARRAY['owner'])
    OR (
      public.has_team_role(team_id, ARRAY['admin'])
      AND role = 'member'   -- admin may only leave the row as 'member'
    )
  );

-- 5) credit_transactions INSERT — require truthful operator_id
DROP POLICY IF EXISTS transactions_insert_authenticated ON public.credit_transactions;
CREATE POLICY transactions_insert_authenticated ON public.credit_transactions
  FOR INSERT TO authenticated
  WITH CHECK (
    operator_id = auth.uid()
    AND public.has_team_role(team_id, ARRAY['owner','admin'])
  );

-- 6) transfer_records INSERT — require from_user_id = auth.uid() AND operator_id = auth.uid()
DROP POLICY IF EXISTS transfers_insert_authenticated ON public.transfer_records;
CREATE POLICY transfers_insert_authenticated ON public.transfer_records
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_in_team(team_id)
    AND from_user_id = auth.uid()
    AND operator_id = auth.uid()
  );
