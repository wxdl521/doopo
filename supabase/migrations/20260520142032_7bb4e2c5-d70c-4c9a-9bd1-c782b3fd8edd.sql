
DROP POLICY IF EXISTS "views_insert_any" ON public.post_views;
-- Only owner or service role can insert directly; recordView server fn uses supabaseAdmin
CREATE POLICY "views_insert_owner" ON public.post_views
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.community_posts p WHERE p.id = post_views.post_id AND p.user_id = auth.uid())
  );
