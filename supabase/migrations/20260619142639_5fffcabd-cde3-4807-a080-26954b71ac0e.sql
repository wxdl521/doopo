-- Tighten community_posts SELECT: keep anon limited to 'public' only.
-- The previous permissive policy applied to {public} (which includes anon)
-- and allowed visibility IN ('public','unlisted'), which OR'd with the
-- anon-specific policy effectively let anon read unlisted posts.

DROP POLICY IF EXISTS posts_select_public_or_unlisted_or_own ON public.community_posts;

CREATE POLICY posts_select_public_or_unlisted_or_own
ON public.community_posts
FOR SELECT
TO authenticated
USING (
  visibility IN ('public', 'unlisted')
  OR user_id = auth.uid()
);
