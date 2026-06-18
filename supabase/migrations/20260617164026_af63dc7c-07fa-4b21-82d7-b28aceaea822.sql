-- Explicitly deny client-side inserts on post_views; recordView uses service role and bypasses RLS.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='post_views' AND policyname='post_views_no_client_insert') THEN
    CREATE POLICY post_views_no_client_insert ON public.post_views
      FOR INSERT TO anon, authenticated
      WITH CHECK (false);
  END IF;
END $$;