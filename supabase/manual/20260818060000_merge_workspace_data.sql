-- ====================================================================
-- merge_workspace_data —— workspace_data 字段级合并（jsonb || patch）
--
-- 背景（2026-08「离开项目再回来分镜全丢」）：saveWorkspaceData 此前整列
-- 覆盖 workspace_data,某段加载未成功时把 storyboard/storyboardGroups 等
-- 未加载字段写成空数组。改为字段级合并:patch 里没有的键保留数据库旧值。
--
-- 本项目约定不自动执行 db:push —— 请有 Supabase 权限的同学手动执行本文件。
-- 未执行前 saveWorkspaceData 会回退旧的整列覆盖路径（前端守卫已阻断丢失）。
-- RLS:函数用 security invoker,projects 表现有策略照常生效。
-- ====================================================================

create or replace function public.merge_workspace_data(
  p_project_id text,
  p_patch jsonb,
  p_completed_stages text[]
) returns void
language sql
security invoker
set search_path = public
as $$
  update public.projects
     set workspace_data = coalesce(workspace_data, '{}'::jsonb) || p_patch,
         completed_stages = p_completed_stages
   where id = p_project_id;
$$;

grant execute on function public.merge_workspace_data(text, jsonb, text[]) to authenticated;
