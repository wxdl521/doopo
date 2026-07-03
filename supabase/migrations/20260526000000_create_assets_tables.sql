-- Create characters table for workspace assets
DROP TABLE IF EXISTS public.characters;
CREATE TABLE public.characters (
  id text PRIMARY KEY,
  user_id uuid REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  role text NOT NULL DEFAULT 'supporting',
  role_label text,
  age integer,
  look text,
  personality text,
  motivation text,
  debut_shot text,
  palette text[],
  mbti text,
  key_prop text,
  gradient text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.characters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS characters_all_own ON public.characters;
CREATE POLICY characters_all_own ON public.characters
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Create scenes table for workspace assets
DROP TABLE IF EXISTS public.scenes;
CREATE TABLE public.scenes (
  id text PRIMARY KEY,
  user_id uuid REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  location text,
  time_of_day text,
  action text,
  beats text[],
  dialogue jsonb,
  gradient text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.scenes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS scenes_all_own ON public.scenes;
CREATE POLICY scenes_all_own ON public.scenes
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);