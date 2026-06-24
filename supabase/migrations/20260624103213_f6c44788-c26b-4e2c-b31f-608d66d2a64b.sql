GRANT SELECT, INSERT, UPDATE, DELETE ON public.characters TO authenticated;
GRANT ALL ON public.characters TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scenes TO authenticated;
GRANT ALL ON public.scenes TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.props TO authenticated;
GRANT ALL ON public.props TO service_role;

DROP POLICY IF EXISTS characters_all_own ON public.characters;
CREATE POLICY characters_all_own ON public.characters
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS scenes_all_own ON public.scenes;
CREATE POLICY scenes_all_own ON public.scenes
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage own props" ON public.props;
CREATE POLICY "Users manage own props" ON public.props
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

ALTER TABLE public.characters DROP CONSTRAINT IF EXISTS characters_pkey;
ALTER TABLE public.characters ADD CONSTRAINT characters_pkey PRIMARY KEY (user_id, id);

ALTER TABLE public.scenes DROP CONSTRAINT IF EXISTS scenes_pkey;
ALTER TABLE public.scenes ADD CONSTRAINT scenes_pkey PRIMARY KEY (user_id, id);

ALTER TABLE public.props DROP CONSTRAINT IF EXISTS props_pkey;
ALTER TABLE public.props ADD CONSTRAINT props_pkey PRIMARY KEY (user_id, id);