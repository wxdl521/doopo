-- 转绘 v2（/restyle/v2）数据表：项目/集/转写/双层资产/分镜/分组/片段/审核/产物确认中枢
-- 统一约定：id text pk、user_id uuid、RLS owner-only、timestamptz

-- ============ 项目与集 ============
CREATE TABLE public.restyle_projects (
  id text PRIMARY KEY,
  user_id uuid REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  title text NOT NULL,
  style_brief text,
  stage text NOT NULL DEFAULT 'analysis',
  text_model text,
  vision_model text,
  image_model text,
  video_model text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE public.restyle_episodes (
  id text PRIMARY KEY,
  user_id uuid REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  project_id text REFERENCES public.restyle_projects ON DELETE CASCADE NOT NULL,
  episode_no int NOT NULL,
  source_media_url text,
  duration_sec numeric,
  analysis_units jsonb DEFAULT '[]'::jsonb,
  analysis_json jsonb,
  analysis_status text NOT NULL DEFAULT 'pending',
  analysis_error text,
  review_status text NOT NULL DEFAULT 'pending',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX idx_restyle_episodes_project ON public.restyle_episodes (project_id, episode_no);

CREATE TABLE public.restyle_transcripts (
  id text PRIMARY KEY,
  user_id uuid REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  episode_id text REFERENCES public.restyle_episodes ON DELETE CASCADE NOT NULL,
  unit_id text,
  sentence_id text,
  begin_ms int NOT NULL,
  end_ms int NOT NULL,
  text text NOT NULL,
  speaker text,
  confidence numeric,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_restyle_transcripts_episode ON public.restyle_transcripts (episode_id, begin_ms);

-- ============ 原片资产 ============
CREATE TABLE public.restyle_source_assets (
  id text PRIMARY KEY,
  user_id uuid REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  episode_id text REFERENCES public.restyle_episodes ON DELETE CASCADE NOT NULL,
  kind text NOT NULL CHECK (kind IN ('character','scene','prop')),
  source_name text NOT NULL,
  aliases jsonb DEFAULT '[]'::jsonb,
  first_seen_ms int,
  last_seen_ms int,
  appearance text,
  wardrobe text,
  description text,
  relationships jsonb DEFAULT '[]'::jsonb,
  uncertainty jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_restyle_source_assets_episode ON public.restyle_source_assets (episode_id, kind);

-- ============ 目标资产 ============
CREATE TABLE public.restyle_characters (
  id text PRIMARY KEY,
  user_id uuid REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  project_id text REFERENCES public.restyle_projects ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  identity_lock text,
  description text,
  clothing text,
  asset_origin jsonb,
  source_description text,
  main_image_url text,
  turnaround_url text,
  voice_profile jsonb,
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE public.restyle_character_relations (
  id text PRIMARY KEY,
  user_id uuid REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  character_id text REFERENCES public.restyle_characters ON DELETE CASCADE NOT NULL,
  related_character_id text REFERENCES public.restyle_characters ON DELETE CASCADE NOT NULL,
  relation text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE (character_id, related_character_id)
);

CREATE TABLE public.restyle_character_looks (
  id text PRIMARY KEY,
  user_id uuid REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  character_id text REFERENCES public.restyle_characters ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  from_shot text,
  to_shot text,
  redesign_reason text,
  reuse_existing boolean DEFAULT false,
  reuse_source text,
  front_url text,
  back_url text,
  side_url text,
  image_url text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.restyle_scenes (
  id text PRIMARY KEY,
  user_id uuid REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  project_id text REFERENCES public.restyle_projects ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  description text,
  source_description text,
  asset_origin jsonb,
  prompt text,
  image_url text,
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.restyle_props (
  id text PRIMARY KEY,
  user_id uuid REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  project_id text REFERENCES public.restyle_projects ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  description text,
  source_description text,
  asset_origin jsonb,
  prompt text,
  image_url text,
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.restyle_ignored_assets (
  id text PRIMARY KEY,
  user_id uuid REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  project_id text REFERENCES public.restyle_projects ON DELETE CASCADE NOT NULL,
  kind text NOT NULL CHECK (kind IN ('character','scene','prop')),
  name text NOT NULL,
  reason text,
  created_at timestamptz DEFAULT now()
);

-- ============ 分镜/分组/片段 ============
CREATE TABLE public.restyle_shots (
  id text PRIMARY KEY,
  user_id uuid REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  episode_id text REFERENCES public.restyle_episodes ON DELETE CASCADE NOT NULL,
  shot_no text NOT NULL,
  start_ms int NOT NULL,
  end_ms int NOT NULL,
  shot_type text,
  spatial_anchor text,
  end_state_action text,
  scene_type text,
  voice_type text,
  emotion text,
  use_new_set boolean DEFAULT false,
  sound_effects text,
  characters jsonb DEFAULT '[]'::jsonb,
  set_ref text,
  props jsonb DEFAULT '[]'::jsonb,
  dialogue text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_restyle_shots_episode ON public.restyle_shots (episode_id, start_ms);

CREATE TABLE public.restyle_groups (
  id text PRIMARY KEY,
  user_id uuid REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  episode_id text REFERENCES public.restyle_episodes ON DELETE CASCADE NOT NULL,
  group_no int NOT NULL,
  shot_ids text[] NOT NULL DEFAULT '{}',
  reason text,
  total_seconds numeric NOT NULL CHECK (total_seconds >= 4 AND total_seconds <= 15),
  status text NOT NULL DEFAULT 'draft',
  scope_hash text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.restyle_segments (
  id text PRIMARY KEY,
  user_id uuid REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  group_id text REFERENCES public.restyle_groups ON DELETE CASCADE NOT NULL,
  prompt_pack jsonb,
  precheck jsonb,
  postcheck jsonb,
  render_status text NOT NULL DEFAULT 'queued',
  render_task_id text,
  result_url text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ============ 审核与产物确认 ============
CREATE TABLE public.restyle_reviews (
  id text PRIMARY KEY,
  user_id uuid REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  project_id text REFERENCES public.restyle_projects ON DELETE CASCADE NOT NULL,
  episode_id text REFERENCES public.restyle_episodes ON DELETE CASCADE,
  doc_kind text NOT NULL,
  issue_type text,
  severity text,
  description text,
  risk text,
  suggestion text,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_restyle_reviews_project ON public.restyle_reviews (project_id, doc_kind);

CREATE TABLE public.restyle_artifacts (
  id text PRIMARY KEY,
  user_id uuid REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  project_id text REFERENCES public.restyle_projects ON DELETE CASCADE NOT NULL,
  stage text NOT NULL,
  node_key text NOT NULL,
  content jsonb,
  user_content jsonb,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ai_checked','user_approved','rejected')),
  verdict text,
  issues jsonb DEFAULT '[]'::jsonb,
  scope_hash text,
  revision int NOT NULL DEFAULT 1,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (project_id, stage, node_key)
);
CREATE INDEX idx_restyle_artifacts_project ON public.restyle_artifacts (project_id, stage);

-- ============ RLS（owner-only） ============
ALTER TABLE public.restyle_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restyle_episodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restyle_transcripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restyle_source_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restyle_characters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restyle_character_relations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restyle_character_looks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restyle_scenes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restyle_props ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restyle_ignored_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restyle_shots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restyle_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restyle_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restyle_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restyle_artifacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY restyle_projects_own ON public.restyle_projects FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY restyle_episodes_own ON public.restyle_episodes FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY restyle_transcripts_own ON public.restyle_transcripts FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY restyle_source_assets_own ON public.restyle_source_assets FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY restyle_characters_own ON public.restyle_characters FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY restyle_character_relations_own ON public.restyle_character_relations FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY restyle_character_looks_own ON public.restyle_character_looks FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY restyle_scenes_own ON public.restyle_scenes FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY restyle_props_own ON public.restyle_props FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY restyle_ignored_assets_own ON public.restyle_ignored_assets FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY restyle_shots_own ON public.restyle_shots FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY restyle_groups_own ON public.restyle_groups FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY restyle_segments_own ON public.restyle_segments FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY restyle_reviews_own ON public.restyle_reviews FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY restyle_artifacts_own ON public.restyle_artifacts FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============ GRANT ============
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
