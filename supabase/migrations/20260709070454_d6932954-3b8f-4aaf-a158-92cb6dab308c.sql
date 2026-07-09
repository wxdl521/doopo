REVOKE EXECUTE ON FUNCTION public.is_in_team(uuid, uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.has_team_role(uuid, text[], uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_team_public_info(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_team_member_profiles(uuid[]) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.join_team_as_self(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.add_user_credits(integer) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.dissolve_team_with_refund(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.is_in_same_group(uuid, uuid) FROM anon, public;

GRANT EXECUTE ON FUNCTION public.is_in_team(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_team_role(uuid, text[], uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_team_public_info(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_team_member_profiles(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.join_team_as_self(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_user_credits(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dissolve_team_with_refund(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_in_same_group(uuid, uuid) TO authenticated;