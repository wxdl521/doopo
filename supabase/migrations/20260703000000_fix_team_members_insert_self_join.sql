-- Fix 1: allow self-join (auth.uid() = user_id) in team_members INSERT policy.
-- Previous migration (20260702080756) removed self-join, breaking the join-team
-- flow for invited users who aren't yet members.
DROP POLICY IF EXISTS members_insert_owner_or_admin ON team_members;
CREATE POLICY members_insert_owner_or_admin ON team_members
  FOR INSERT TO authenticated
  WITH CHECK (
    (auth.uid() = user_id)
    AND role = 'member'
  );

-- Fix 2: allow any authenticated user to SELECT non-deleted teams.
-- Required for the join page (getTeamJoinInfo) to show team name/description
-- before the user has joined. Without this, non-members can't see the team
-- they're trying to join.
DROP POLICY IF EXISTS teams_select_member ON teams;
CREATE POLICY teams_select_member ON teams
  FOR SELECT TO authenticated
  USING (deleted_at IS NULL);
