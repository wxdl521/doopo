
DROP POLICY IF EXISTS "script_covers_select_own" ON storage.objects;
CREATE POLICY "script_covers_select_own"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'script-covers' AND auth.uid()::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "user_wallets_update_own" ON public.user_wallets;
CREATE POLICY "user_wallets_update_own"
ON public.user_wallets FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_wallets_delete_none" ON public.user_wallets;
CREATE POLICY "user_wallets_delete_none"
ON public.user_wallets FOR DELETE
TO authenticated
USING (false);
