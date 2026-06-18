DROP POLICY IF EXISTS "Public can read public and unlisted posts" ON public.community_posts;
DROP POLICY IF EXISTS community_posts_select_public ON public.community_posts;

CREATE POLICY community_posts_select_anon
  ON public.community_posts FOR SELECT
  TO anon
  USING (visibility = 'public');

CREATE POLICY community_posts_select_authed
  ON public.community_posts FOR SELECT
  TO authenticated
  USING (visibility IN ('public','unlisted') OR auth.uid() = user_id);