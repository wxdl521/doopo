-- 由管理员在 Supabase SQL Editor 执行：项目自定义文字风格 + 团队解散修复。
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS custom_style text;

-- 工作区媒体必须是公开桶，才能将供应商临时 URL 替换为长期可播放的 URL。
UPDATE storage.buckets
SET public = true
WHERE id = 'workspace-media'
  AND public IS DISTINCT FROM true;

-- 旧函数为 SECURITY INVOKER，在 RLS 下可能只能写入部分记录，导致团队看似解散却仍可访问。
-- 函数仍以 auth.uid() 强制校验调用者必须是团队 owner。
CREATE OR REPLACE FUNCTION public.dissolve_team_with_refund(p_team_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
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
  SET credits_balance = 0, subscription_credits = 0
  WHERE team_id = p_team_id;

  IF v_total_credits > 0 THEN
    INSERT INTO public.credit_transactions
      (team_id, user_id, type, amount, balance_after, operator_id, source_type, description)
    VALUES
      (p_team_id, v_owner_id, 'refund', v_total_credits, v_total_credits, v_owner_id,
       'recharge', '团队解散，积分退款');
  END IF;

  -- 移除全部成员关系，已解散团队不再保留任何成员访问权限。
  DELETE FROM public.team_members
  WHERE team_id = p_team_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.dissolve_team_with_refund(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dissolve_team_with_refund(uuid) TO authenticated, service_role;
