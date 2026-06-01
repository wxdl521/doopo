-- Script cover images: a public bucket scoped by user folder.
-- Files are stored as {user_id}/{script_id}.{ext} so each user can only
-- manage their own scripts. The actual URL still lives in scripts.payload
-- jsonb, but it's now a permanent Supabase Storage URL instead of a
-- time-limited Qwen/Aliyun temp URL.

INSERT INTO storage.buckets (id, name, public)
VALUES ('script-covers', 'script-covers', true)
ON CONFLICT (id) DO NOTHING;

-- Each user can manage files in their own folder only.
-- The "first folder segment must equal auth.uid()" pattern is enforced via
-- path matching in the policy expression.

DROP POLICY IF EXISTS script_covers_read_own ON storage.objects;
CREATE POLICY script_covers_read_own ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'script-covers'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS script_covers_write_own ON storage.objects;
CREATE POLICY script_covers_write_own ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'script-covers'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS script_covers_update_own ON storage.objects;
CREATE POLICY script_covers_update_own ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'script-covers'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'script-covers'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS script_covers_delete_own ON storage.objects;
CREATE POLICY script_covers_delete_own ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'script-covers'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
