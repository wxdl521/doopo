-- Community posts visibility policies
DROP POLICY IF EXISTS "Public can read public and unlisted posts" ON public.community_posts;
DROP POLICY IF EXISTS community_posts_select_public ON public.community_posts;
DROP POLICY IF EXISTS community_posts_select_anon ON public.community_posts;
DROP POLICY IF EXISTS community_posts_select_authed ON public.community_posts;

CREATE POLICY community_posts_select_anon
  ON public.community_posts FOR SELECT
  TO anon
  USING (visibility = 'public');

CREATE POLICY community_posts_select_authed
  ON public.community_posts FOR SELECT
  TO authenticated
  USING (visibility IN ('public','unlisted') OR auth.uid() = user_id);

-- Workspace media per-user storage policies
DROP POLICY IF EXISTS workspace_media_read_own ON storage.objects;
CREATE POLICY workspace_media_read_own ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'workspace-media'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS workspace_media_write_own ON storage.objects;
CREATE POLICY workspace_media_write_own ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'workspace-media'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS workspace_media_update_own ON storage.objects;
CREATE POLICY workspace_media_update_own ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'workspace-media'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'workspace-media'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS workspace_media_delete_own ON storage.objects;
CREATE POLICY workspace_media_delete_own ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'workspace-media'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );