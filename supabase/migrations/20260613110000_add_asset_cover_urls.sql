-- 2026/06:给 characters / scenes 表加 cover_url 列,保存资产时把主图一并入库。
-- assets 页(AssetsLibrary)读 DB 数据时显示真实图,而不是 emoji 占位。

ALTER TABLE public.characters
  ADD COLUMN IF NOT EXISTS cover_url text;

ALTER TABLE public.scenes
  ADD COLUMN IF NOT EXISTS cover_url text;