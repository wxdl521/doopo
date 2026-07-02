
-- 1. Tighten team_members INSERT policy: only owner/admin can add members
DROP POLICY IF EXISTS members_insert_owner_or_admin ON public.team_members;
CREATE POLICY members_insert_owner_or_admin ON public.team_members
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.team_members self
      WHERE self.team_id = team_members.team_id
        AND self.user_id = auth.uid()
        AND self.role IN ('owner', 'admin')
    )
    AND team_members.role = 'member'
  );

-- 2. Tighten credit_transactions INSERT policy: require truthful operator_id
DROP POLICY IF EXISTS transactions_insert_authenticated ON public.credit_transactions;
CREATE POLICY transactions_insert_authenticated ON public.credit_transactions
  FOR INSERT TO authenticated
  WITH CHECK (
    operator_id = auth.uid()
    AND (
      EXISTS (
        SELECT 1 FROM public.team_members
        WHERE team_members.team_id = credit_transactions.team_id
          AND team_members.user_id = auth.uid()
          AND team_members.role IN ('owner', 'admin')
      )
      OR user_id = auth.uid()
    )
  );

-- 3. Convert dissolve_team_with_refund to SECURITY INVOKER with explicit search_path,
--    and revoke default public execute.
CREATE OR REPLACE FUNCTION public.dissolve_team_with_refund(p_team_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  v_owner_id uuid;
  v_total_credits integer := 0;
BEGIN
  SELECT owner_id INTO v_owner_id
  FROM public.teams
  WHERE id = p_team_id AND deleted_at IS NULL;

  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'Team not found or already deleted';
  END IF;

  IF auth.uid() <> v_owner_id THEN
    RAISE EXCEPTION 'Only the team owner can dissolve the team';
  END IF;

  SELECT COALESCE(SUM(credits_balance), 0) INTO v_total_credits
  FROM public.team_members
  WHERE team_id = p_team_id;

  UPDATE public.teams
  SET deleted_at = now(), updated_at = now()
  WHERE id = p_team_id;

  UPDATE public.team_members
  SET credits_balance = 0
  WHERE team_id = p_team_id;

  IF v_total_credits > 0 THEN
    INSERT INTO public.credit_transactions
      (team_id, user_id, type, amount, balance_after, operator_id, source_type, description)
    VALUES
      (p_team_id, v_owner_id, 'refund', v_total_credits, v_total_credits, v_owner_id, 'recharge',
       '团队解散，积分退款');
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.dissolve_team_with_refund(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dissolve_team_with_refund(uuid) TO authenticated, service_role;

-- 4. Set explicit search_path on set_updated_at trigger function
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;
