CREATE INDEX IF NOT EXISTS characters_user_id_idx ON public.characters (user_id);
CREATE INDEX IF NOT EXISTS scenes_user_id_idx ON public.scenes (user_id);
CREATE INDEX IF NOT EXISTS props_user_id_idx ON public.props (user_id);