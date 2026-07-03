-- 个人积分钱包：独立的用户级别积分余额，与团队积分分开
CREATE TABLE public.user_wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  credits_balance integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- RLS：用户只能读自己的钱包
ALTER TABLE public.user_wallets ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_wallets_select_own ON public.user_wallets
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- 只允许 service_role 写入（防用户自己改余额）
CREATE POLICY user_wallets_insert_service_role ON public.user_wallets
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- 触发器：自动更新 updated_at
CREATE TRIGGER set_updated_at_user_wallets
  BEFORE UPDATE ON public.user_wallets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RPC：安全充值（SECURITY DEFINER 绕过 RLS，只能给自己加、只能加正数）
CREATE OR REPLACE FUNCTION public.add_user_credits(p_amount integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'amount must be positive';
  END IF;

  INSERT INTO public.user_wallets (user_id, credits_balance)
  VALUES (auth.uid(), p_amount)
  ON CONFLICT (user_id) DO UPDATE
  SET credits_balance = user_wallets.credits_balance + p_amount,
      updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.add_user_credits(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_user_credits(integer) TO authenticated;
