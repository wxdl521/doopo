-- ============================================================
-- 团队分组(team_groups)+ 项目团队/组归属
-- 组与组长一对一:UNIQUE(team_id, admin_id)
-- 组内项目(group_id 非空)对本组成员共享;owner 全权;团队 admin 只读组项目
-- 注:此 SQL 已在生产库执行过,本文件为补提交(幂等,IF NOT EXISTS / DROP IF EXISTS)
-- ============================================================

-- ============================================================
-- ① projects.team_id -- 项目归属团队
--   team_id NULL = 个人项目(user_id 自己);非空 = 团队项目(团队成员可见)
-- ============================================================

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_projects_team_id
  ON public.projects (team_id) WHERE team_id IS NOT NULL;

DROP POLICY IF EXISTS projects_all_own ON public.projects;
DROP POLICY IF EXISTS projects_select ON public.projects;
DROP POLICY IF EXISTS projects_insert ON public.projects;
DROP POLICY IF EXISTS projects_update ON public.projects;
DROP POLICY IF EXISTS projects_delete ON public.projects;

CREATE POLICY projects_select ON public.projects
  FOR SELECT TO authenticated
  USING (
    (team_id IS NULL AND auth.uid() = user_id)
    OR (team_id IS NOT NULL AND public.is_in_team(team_id))
  );

CREATE POLICY projects_insert ON public.projects
  FOR INSERT TO authenticated
  WITH CHECK (
    (team_id IS NULL AND auth.uid() = user_id)
    OR (team_id IS NOT NULL AND public.is_in_team(team_id))
  );

CREATE POLICY projects_update ON public.projects
  FOR UPDATE TO authenticated
  USING (
    (team_id IS NULL AND auth.uid() = user_id)
    OR (team_id IS NOT NULL AND public.is_in_team(team_id))
  )
  WITH CHECK (
    (team_id IS NULL AND auth.uid() = user_id)
    OR (team_id IS NOT NULL AND public.is_in_team(team_id))
  );

CREATE POLICY projects_delete ON public.projects
  FOR DELETE TO authenticated
  USING (
    (team_id IS NULL AND auth.uid() = user_id)
    OR (team_id IS NOT NULL AND public.is_in_team(team_id))
  );


-- ============================================================
-- ② team_groups -- 团队内部分组
--   admin 与组一对一(UNIQUE(team_id, admin_id))
--   组项目(group_id 非空)仅本组 + owner 可写;owner/admin 可读所有组项目
-- ============================================================

CREATE TABLE IF NOT EXISTS public.team_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams ON DELETE CASCADE,
  name text NOT NULL,
  admin_id uuid REFERENCES auth.users ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, admin_id),
  UNIQUE (team_id, name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.team_groups TO authenticated;
GRANT ALL ON public.team_groups TO service_role;
ALTER TABLE public.team_groups ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.team_members
  ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES public.team_groups ON DELETE SET NULL;
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES public.team_groups ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_team_members_group_id
  ON public.team_members (group_id) WHERE group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_projects_group_id
  ON public.projects (group_id) WHERE group_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.is_in_same_group(p_group_id uuid, p_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.team_members
    WHERE user_id = p_user_id AND group_id = p_group_id
  );
$$;

DROP POLICY IF EXISTS team_groups_select ON public.team_groups;
DROP POLICY IF EXISTS team_groups_insert_owner ON public.team_groups;
DROP POLICY IF EXISTS team_groups_update_owner ON public.team_groups;
DROP POLICY IF EXISTS team_groups_delete_owner ON public.team_groups;

CREATE POLICY team_groups_select ON public.team_groups
  FOR SELECT TO authenticated
  USING (public.is_in_team(team_id));
CREATE POLICY team_groups_insert_owner ON public.team_groups
  FOR INSERT TO authenticated
  WITH CHECK (public.has_team_role(team_id, ARRAY['owner']));
CREATE POLICY team_groups_update_owner ON public.team_groups
  FOR UPDATE TO authenticated
  USING (public.has_team_role(team_id, ARRAY['owner']))
  WITH CHECK (public.has_team_role(team_id, ARRAY['owner']));
CREATE POLICY team_groups_delete_owner ON public.team_groups
  FOR DELETE TO authenticated
  USING (public.has_team_role(team_id, ARRAY['owner']));

-- projects RLS 改造:加入组维度(覆盖 ① 的 4 策略)
DROP POLICY IF EXISTS projects_select ON public.projects;
DROP POLICY IF EXISTS projects_insert ON public.projects;
DROP POLICY IF EXISTS projects_update ON public.projects;
DROP POLICY IF EXISTS projects_delete ON public.projects;

CREATE POLICY projects_select ON public.projects
  FOR SELECT TO authenticated
  USING (
    (team_id IS NULL AND auth.uid() = user_id)
    OR (team_id IS NOT NULL AND group_id IS NULL AND public.is_in_team(team_id))
    OR (team_id IS NOT NULL AND group_id IS NOT NULL AND (
      public.has_team_role(team_id, ARRAY['owner','admin'])
      OR public.is_in_same_group(group_id)
    ))
  );
CREATE POLICY projects_insert ON public.projects
  FOR INSERT TO authenticated
  WITH CHECK (
    (team_id IS NULL AND auth.uid() = user_id)
    OR (team_id IS NOT NULL AND group_id IS NULL AND public.is_in_team(team_id))
    OR (team_id IS NOT NULL AND group_id IS NOT NULL AND (
      public.has_team_role(team_id, ARRAY['owner'])
      OR public.is_in_same_group(group_id)
    ))
  );
CREATE POLICY projects_update ON public.projects
  FOR UPDATE TO authenticated
  USING (
    (team_id IS NULL AND auth.uid() = user_id)
    OR (team_id IS NOT NULL AND group_id IS NULL AND public.is_in_team(team_id))
    OR (team_id IS NOT NULL AND group_id IS NOT NULL AND (
      public.has_team_role(team_id, ARRAY['owner'])
      OR public.is_in_same_group(group_id)
    ))
  )
  WITH CHECK (
    (team_id IS NULL AND auth.uid() = user_id)
    OR (team_id IS NOT NULL AND group_id IS NULL AND public.is_in_team(team_id))
    OR (team_id IS NOT NULL AND group_id IS NOT NULL AND (
      public.has_team_role(team_id, ARRAY['owner'])
      OR public.is_in_same_group(group_id)
    ))
  );
CREATE POLICY projects_delete ON public.projects
  FOR DELETE TO authenticated
  USING (
    (team_id IS NULL AND auth.uid() = user_id)
    OR (team_id IS NOT NULL AND group_id IS NULL AND public.is_in_team(team_id))
    OR (team_id IS NOT NULL AND group_id IS NOT NULL AND (
      public.has_team_role(team_id, ARRAY['owner'])
      OR public.is_in_same_group(group_id)
    ))
  );
