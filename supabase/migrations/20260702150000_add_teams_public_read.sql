-- ============================================================
-- 修复: 允许已登录用户查看团队基本信息（用于加入页面）
-- ============================================================

-- 添加公开读取策略：任何已登录用户都能看到未删除团队的基本信息
CREATE POLICY "teams_select_public" ON public.teams
  FOR SELECT TO authenticated
  USING (deleted_at IS NULL);
