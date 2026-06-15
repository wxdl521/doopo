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