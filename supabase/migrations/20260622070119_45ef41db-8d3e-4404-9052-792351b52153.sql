
-- workspace-media storage RLS (bucket already exists)
DROP POLICY IF EXISTS workspace_media_read_own ON storage.objects;
CREATE POLICY workspace_media_read_own ON storage.objects
  FOR SELECT
  USING (bucket_id = 'workspace-media' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS workspace_media_write_own ON storage.objects;
CREATE POLICY workspace_media_write_own ON storage.objects
  FOR INSERT
  WITH CHECK (bucket_id = 'workspace-media' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS workspace_media_update_own ON storage.objects;
CREATE POLICY workspace_media_update_own ON storage.objects
  FOR UPDATE
  USING (bucket_id = 'workspace-media' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'workspace-media' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS workspace_media_delete_own ON storage.objects;
CREATE POLICY workspace_media_delete_own ON storage.objects
  FOR DELETE
  USING (bucket_id = 'workspace-media' AND (storage.foldername(name))[1] = auth.uid()::text);

-- generated-images storage RLS
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

-- props table: rebuild as UUID-keyed canonical version
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

CREATE POLICY "Users manage own props" ON public.props
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS props_set_updated_at ON public.props;
CREATE TRIGGER props_set_updated_at
  BEFORE UPDATE ON public.props
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- characters: add images column
ALTER TABLE public.characters
ADD COLUMN IF NOT EXISTS images JSONB DEFAULT '[]'::JSONB;

-- post_views: deny client inserts (recorded server-side via service role)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='post_views' AND policyname='post_views_no_client_insert') THEN
    CREATE POLICY post_views_no_client_insert ON public.post_views
      FOR INSERT TO anon, authenticated
      WITH CHECK (false);
  END IF;
END $$;
