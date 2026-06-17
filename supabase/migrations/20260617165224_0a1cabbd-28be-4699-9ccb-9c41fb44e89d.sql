-- 1. props 表：先移除旧版（text 主键）再创建正确的 UUID 版本
DROP TABLE IF EXISTS public.props;

CREATE TABLE public.props (
  id UUID NOT NULL PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  movement_description TEXT,
  key_moments TEXT[] DEFAULT '{}'::TEXT[],
  palette TEXT[] DEFAULT '{}'::TEXT[],
  cover_url TEXT,
  images JSONB DEFAULT '[]'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.props TO authenticated;
GRANT ALL ON public.props TO service_role;

ALTER TABLE public.props ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS props_all_own ON public.props;
CREATE POLICY "Users manage own props" ON public.props
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER props_set_updated_at
  BEFORE UPDATE ON public.props
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2. generated-images 存储桶的 RLS 策略（仅允许用户操作自己的文件夹）
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='generated_images_read_own') THEN
    CREATE POLICY generated_images_read_own ON storage.objects FOR SELECT TO authenticated
      USING (bucket_id = 'generated-images' AND auth.uid()::text = (storage.foldername(name))[1]);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='generated_images_insert_own') THEN
    CREATE POLICY generated_images_insert_own ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'generated-images' AND auth.uid()::text = (storage.foldername(name))[1]);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='generated_images_update_own') THEN
    CREATE POLICY generated_images_update_own ON storage.objects FOR UPDATE TO authenticated
      USING (bucket_id = 'generated-images' AND auth.uid()::text = (storage.foldername(name))[1])
      WITH CHECK (bucket_id = 'generated-images' AND auth.uid()::text = (storage.foldername(name))[1]);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='generated_images_delete_own') THEN
    CREATE POLICY generated_images_delete_own ON storage.objects FOR DELETE TO authenticated
      USING (bucket_id = 'generated-images' AND auth.uid()::text = (storage.foldername(name))[1]);
  END IF;
END $$;

-- 3. 为 characters 表增加 images 列
ALTER TABLE public.characters
ADD COLUMN IF NOT EXISTS images jsonb DEFAULT '[]'::jsonb;

-- 4. 禁止客户端直接插入 post_views，recordView 通过服务角色绕过 RLS
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='post_views' AND policyname='post_views_no_client_insert') THEN
    CREATE POLICY post_views_no_client_insert ON public.post_views
      FOR INSERT TO anon, authenticated
      WITH CHECK (false);
  END IF;
END $$;