
CREATE TABLE public.projects (
  id text PRIMARY KEY,
  user_id uuid NOT NULL,
  name text NOT NULL DEFAULT '未命名项目',
  aspect text NOT NULL DEFAULT '16:9',
  storyboard_model text NOT NULL DEFAULT 'google/gemini-3.1-flash-image-preview',
  scene_model text NOT NULL DEFAULT 'qwen-image-max',
  video_model text NOT NULL DEFAULT 'wan2.5-i2v-preview',
  audio text NOT NULL DEFAULT 'auto',
  workflow text NOT NULL DEFAULT 'grid',
  style text NOT NULL DEFAULT '3d-cg',
  custom_cover text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects TO authenticated;
GRANT ALL ON public.projects TO service_role;

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "projects_all_own" ON public.projects
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER projects_set_updated_at
  BEFORE UPDATE ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();
