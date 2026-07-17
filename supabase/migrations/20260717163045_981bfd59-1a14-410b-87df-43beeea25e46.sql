REVOKE EXECUTE ON FUNCTION public.sync_team_member_wallet_balance() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_new_team_member_wallet_balance() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reclaim_leaving_member_credits() FROM PUBLIC, anon, authenticated;