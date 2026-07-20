-- 团队成员列表展示的是 team_members 的钱包余额快照。
-- 该字段曾是 integer，或未随个人钱包变更同步，导致 44.8 被保留/四舍五入为 45。

ALTER TABLE public.team_members
  ALTER COLUMN credits_balance TYPE numeric(12,2) USING credits_balance::numeric(12,2);

CREATE OR REPLACE FUNCTION public.sync_team_member_wallet_balance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.team_members
  SET credits_balance = NEW.credits_balance
  WHERE user_id = NEW.user_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_team_member_wallet_balance ON public.user_wallets;
CREATE TRIGGER trg_sync_team_member_wallet_balance
  AFTER INSERT OR UPDATE OF credits_balance ON public.user_wallets
  FOR EACH ROW EXECUTE FUNCTION public.sync_team_member_wallet_balance();

REVOKE ALL ON FUNCTION public.sync_team_member_wallet_balance() FROM PUBLIC, anon, authenticated;

-- 一次性修复历史快照；后续由上面的触发器实时维护。
UPDATE public.team_members AS member
SET credits_balance = wallet.credits_balance
FROM public.user_wallets AS wallet
WHERE wallet.user_id = member.user_id
  AND member.credits_balance IS DISTINCT FROM wallet.credits_balance;
