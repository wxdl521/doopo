-- 2026/07:给 characters 表加 reference_audio_url 列,存储角色参考音频签名 URL。
-- 供视频生成时作为 Seedance reference_audio 使用(角色级声音参考)。
ALTER TABLE public.characters
ADD COLUMN IF NOT EXISTS reference_audio_url text;
