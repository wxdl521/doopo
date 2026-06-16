
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
