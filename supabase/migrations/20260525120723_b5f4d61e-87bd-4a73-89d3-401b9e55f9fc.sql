
DROP POLICY IF EXISTS likes_select_all ON public.post_likes;
CREATE POLICY likes_select_own ON public.post_likes
  FOR SELECT TO public
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS views_insert_owner ON public.post_views;
