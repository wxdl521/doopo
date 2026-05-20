
-- community_posts
CREATE TABLE public.community_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('script','character','scene','prop','comic')),
  source_id text,
  title text NOT NULL DEFAULT '未命名作品',
  summary text,
  cover_gradient text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('public','unlisted','private')),
  likes_count int NOT NULL DEFAULT 0,
  views_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_community_posts_public_recent ON public.community_posts (created_at DESC) WHERE visibility = 'public';
CREATE INDEX idx_community_posts_user ON public.community_posts (user_id, created_at DESC);
CREATE INDEX idx_community_posts_kind ON public.community_posts (kind) WHERE visibility = 'public';

ALTER TABLE public.community_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "posts_select_public_or_unlisted_or_own" ON public.community_posts
  FOR SELECT USING (visibility IN ('public','unlisted') OR auth.uid() = user_id);
CREATE POLICY "posts_insert_own" ON public.community_posts
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "posts_update_own" ON public.community_posts
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "posts_delete_own" ON public.community_posts
  FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER trg_community_posts_updated_at
  BEFORE UPDATE ON public.community_posts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- post_likes
CREATE TABLE public.post_likes (
  post_id uuid NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);
ALTER TABLE public.post_likes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "likes_select_all" ON public.post_likes FOR SELECT USING (true);
CREATE POLICY "likes_insert_own" ON public.post_likes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "likes_delete_own" ON public.post_likes FOR DELETE USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.bump_likes_count()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.community_posts SET likes_count = likes_count + 1 WHERE id = NEW.post_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.community_posts SET likes_count = GREATEST(likes_count - 1, 0) WHERE id = OLD.post_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER trg_post_likes_count
  AFTER INSERT OR DELETE ON public.post_likes
  FOR EACH ROW EXECUTE FUNCTION public.bump_likes_count();

-- post_views (per-day dedup)
CREATE TABLE public.post_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
  viewer_key text NOT NULL,
  viewed_on date NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (post_id, viewer_key, viewed_on)
);
ALTER TABLE public.post_views ENABLE ROW LEVEL SECURITY;

CREATE POLICY "views_insert_any" ON public.post_views FOR INSERT WITH CHECK (true);
CREATE POLICY "views_select_owner" ON public.post_views FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.community_posts p WHERE p.id = post_views.post_id AND p.user_id = auth.uid())
);

CREATE OR REPLACE FUNCTION public.bump_views_count()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  UPDATE public.community_posts SET views_count = views_count + 1 WHERE id = NEW.post_id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_post_views_count
  AFTER INSERT ON public.post_views
  FOR EACH ROW EXECUTE FUNCTION public.bump_views_count();
