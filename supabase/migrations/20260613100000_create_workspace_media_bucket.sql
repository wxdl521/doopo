-- 2026/06:Storyboard 视频 + 故事板图入库到用户自己的 Supabase Storage,
-- 绕开 ARK/DashScope/Seedream 三方 URL 的 24h 过期限制。
--
-- 复用 script-covers 同样的模式:public bucket,RLS 用 path 的第一个 folder segment
-- 锁定到 auth.uid() —— 用户只能读写自己文件夹下的文件。
--
-- 路径约定:
--   {userId}/{workspaceId}/videos/{groupId}.mp4          —— 整组分镜视频
--   {userId}/{workspaceId}/storyboards/{groupId}.png     —— 漫剧故事板图

INSERT INTO storage.buckets (id, name, public)
VALUES ('workspace-media', 'workspace-media', true)
ON CONFLICT (id) DO NOTHING;

-- RLS: 每个用户只能读写自己 userId/ 开头的路径。
-- script-covers 验证过这个 pattern,直接照搬。

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