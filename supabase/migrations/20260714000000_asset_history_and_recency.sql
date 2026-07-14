-- 资产库：保存时间用于“最新在前”；场景也保存完整的生成图历史。
ALTER TABLE public.characters
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE public.scenes
  ADD COLUMN IF NOT EXISTS images JSONB NOT NULL DEFAULT '[]'::JSONB,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- props 已有 updated_at/images；补齐旧环境可能缺失的字段。
ALTER TABLE public.props
  ADD COLUMN IF NOT EXISTS images JSONB NOT NULL DEFAULT '[]'::JSONB,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS characters_user_updated_at_idx ON public.characters (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS scenes_user_updated_at_idx ON public.scenes (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS props_user_updated_at_idx ON public.props (user_id, updated_at DESC);
