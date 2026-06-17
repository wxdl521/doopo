-- Create props table for workspace assets
DROP TABLE IF EXISTS public.props;
CREATE TABLE public.props (
  id text PRIMARY KEY,
  user_id text REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  description text,
  movement_description text,
  key_moments text[],
  palette text[],
  cover_url text,
  images jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.props ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS props_all_own ON public.props;
CREATE POLICY props_all_own ON public.props
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
