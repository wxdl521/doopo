-- 2026/06:给 characters 表加 images 列,存储多张已生成的图片 URL(含标签)
ALTER TABLE public.characters
ADD COLUMN IF NOT EXISTS images jsonb DEFAULT '[]'::jsonb;
