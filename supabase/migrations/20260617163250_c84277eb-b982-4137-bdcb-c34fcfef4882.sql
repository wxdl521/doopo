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

CREATE TRIGGER props_set_updated_at
  BEFORE UPDATE ON public.props
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();