-- 创建 workspace-media bucket（如果不存在）
INSERT INTO storage.buckets (id, name, public)
VALUES ('workspace-media', 'workspace-media', true)
ON CONFLICT (id) DO NOTHING;

-- RLS: 每个用户只能读写自己 userId/ 开头的路径
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
