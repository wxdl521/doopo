-- 模型定价入库：public.model_pricing
--
-- 定价原先写死在 src/lib/creditsCost.ts，改为数据库驱动：
--   - kind='image'：按张固定价，model_id 为前缀（tokenflash/、revora/、azure…）
--   - kind='video'：按 model_id + resolution（480P/720P/1080P）每 10 秒单价
-- RLS：authenticated 可 SELECT；写入仅 is_credit_admin()（该函数由
-- 20260717000000_add_credit_admin_rpc.sql 创建，本迁移直接复用，不重复定义）。
-- 首批数据由 creditsCost.ts 现有价目导入（IMAGE_CREDITS 6 条 + VIDEO_CREDITS 5 模型×分辨率）。

CREATE TABLE public.model_pricing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('video', 'image')),
  model_id text NOT NULL,
  label text NOT NULL,
  resolution text,
  credits numeric NOT NULL CHECK (credits >= 0),
  note text,
  is_default boolean NOT NULL DEFAULT false,
  enabled boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 唯一键 (kind, model_id, coalesce(resolution,''))：resolution 为 NULL 的图像档
-- 与空串视为同一档，用表达式唯一索引实现。
CREATE UNIQUE INDEX model_pricing_kind_model_resolution_key
  ON public.model_pricing (kind, model_id, coalesce(resolution, ''));

CREATE INDEX idx_model_pricing_kind ON public.model_pricing (kind, enabled, sort_order);

-- ============ RLS ============
ALTER TABLE public.model_pricing ENABLE ROW LEVEL SECURITY;

CREATE POLICY model_pricing_select ON public.model_pricing
  FOR SELECT TO authenticated USING (true);
CREATE POLICY model_pricing_insert ON public.model_pricing
  FOR INSERT TO authenticated WITH CHECK (public.is_credit_admin());
CREATE POLICY model_pricing_update ON public.model_pricing
  FOR UPDATE TO authenticated
  USING (public.is_credit_admin()) WITH CHECK (public.is_credit_admin());
CREATE POLICY model_pricing_delete ON public.model_pricing
  FOR DELETE TO authenticated USING (public.is_credit_admin());

-- ============ GRANT ============
GRANT SELECT, INSERT, UPDATE, DELETE ON public.model_pricing TO authenticated;
GRANT ALL ON public.model_pricing TO service_role;

-- ============ 首批价目（与 src/lib/creditsCost.ts 保持一致） ============
-- 生图：前缀 -> 积分/张
INSERT INTO public.model_pricing (kind, model_id, label, resolution, credits, is_default, enabled, sort_order) VALUES
  ('image', 'tokenflash/', 'TokenFlash 生图', NULL, 5, false, true, 1),
  ('image', 'revora/',     'Revora 生图',     NULL, 4, false, true, 2),
  ('image', 'azure/',      'Azure 生图',      NULL, 9, false, true, 3),
  ('image', 'azure2/',     'Azure 2 生图',    NULL, 9, false, true, 4),
  ('image', 'azure3/',     'Azure 3 生图',    NULL, 9, false, true, 5),
  ('image', 'azure0716/',  'Azure 0716 生图', NULL, 9, false, true, 6);

-- 视频：模型 + 分辨率 -> 每 10 秒积分。默认推荐：Seedance 2.0 720P。
INSERT INTO public.model_pricing (kind, model_id, label, resolution, credits, note, is_default, enabled, sort_order) VALUES
  ('video', 'kuaizi-lizhen-fast',               '丽帧 Fast',        '480P', 89,    NULL,               false, true, 1),
  ('video', 'kuaizi-lizhen-fast',               '丽帧 Fast',        '720P', 192,   NULL,               false, true, 2),
  ('video', 'kuaizi-lizhen-pro',                '丽帧 Pro',         '480P', 110.4, NULL,               false, true, 3),
  ('video', 'kuaizi-lizhen-pro',                '丽帧 Pro',         '720P', 118,   NULL,               false, true, 4),
  ('video', 'kuaizi-lizhen-pro',                '丽帧 Pro',         '1080P', 593,  NULL,               false, true, 5),
  ('video', 'kuaizi-lizhen-mini',               '丽帧 Mini',        '480P', 56,    NULL,               false, true, 6),
  ('video', 'kuaizi-lizhen-mini',               '丽帧 Mini',        '720P', 120,   NULL,               false, true, 7),
  ('video', 'doubao-seedance-2-0-fast-260128',  'Seedance 2.0 Fast', '480P', 192,  NULL,               false, true, 8),
  ('video', 'doubao-seedance-2-0-fast-260128',  'Seedance 2.0 Fast', '720P', 192,  NULL,               false, true, 9),
  ('video', 'doubao-seedance-2-0-260128',       'Seedance 2.0',     '480P', 237.6, '支持真人；理解力好', false, true, 10),
  ('video', 'doubao-seedance-2-0-260128',       'Seedance 2.0',     '720P', 237.6, '支持真人；理解力好', true,  true, 11);
