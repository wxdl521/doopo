-- ARK Seedance 会从公网下载 reference_audio。旧环境可能在 workspace-media
-- bucket 已存在时跳过了早期 INSERT ... ON CONFLICT DO NOTHING，导致 bucket
-- 仍为私有，getPublicUrl 返回的地址实际不可访问。
UPDATE storage.buckets
SET public = true
WHERE id = 'workspace-media'
  AND public IS DISTINCT FROM true;
