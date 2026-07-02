-- ============================================================
-- 团队协作 + 积分分配系统 — 数据库迁移
-- ============================================================

-- ============================================================
-- Phase 0: 辅助函数（如项目尚无此函数则创建）
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ============================================================
-- Phase 1: 建表
-- ============================================================

-- 1.1 teams — 团队主表
CREATE TABLE public.teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  owner_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.teams TO authenticated;
GRANT ALL ON public.teams TO service_role;

ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER trg_teams_updated_at
  BEFORE UPDATE ON public.teams
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- 1.2 team_members — 团队成员关系
CREATE TABLE public.team_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  credits_balance integer NOT NULL DEFAULT 0,
  subscription_credits integer NOT NULL DEFAULT 0,
  joined_at timestamptz NOT NULL DEFAULT now(),
  invited_by uuid REFERENCES auth.users ON DELETE SET NULL,
  UNIQUE (team_id, user_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.team_members TO authenticated;
GRANT ALL ON public.team_members TO service_role;

ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;


-- 1.3 credit_transactions — 积分流水
CREATE TABLE public.credit_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('allocate', 'reclaim', 'transfer_in', 'transfer_out', 'consume', 'refund')),
  amount integer NOT NULL,
  balance_after integer,
  operator_id uuid REFERENCES auth.users ON DELETE SET NULL,
  source_type text NOT NULL DEFAULT 'recharge' CHECK (source_type IN ('recharge', 'subscription')),
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.credit_transactions TO authenticated;
GRANT ALL ON public.credit_transactions TO service_role;

ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;


-- 1.4 transfer_records — 转账明细
CREATE TABLE public.transfer_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams ON DELETE CASCADE,
  from_user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  to_user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  amount integer NOT NULL CHECK (amount > 0),
  from_balance_after integer,
  to_balance_after integer,
  operator_id uuid REFERENCES auth.users ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.transfer_records TO authenticated;
GRANT ALL ON public.transfer_records TO service_role;

ALTER TABLE public.transfer_records ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- Phase 2: RLS 策略（所有表已建完，安全引用）
-- ============================================================

-- 2.1 teams 策略
-- =====================

-- 团队成员可读自己所在的团队
CREATE POLICY "teams_select_member" ON public.teams
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.team_members
      WHERE team_members.team_id = teams.id
        AND team_members.user_id = auth.uid()
    )
    OR auth.uid() = owner_id
  );

-- 创建者即 owner
CREATE POLICY "teams_insert_any" ON public.teams
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = owner_id);

-- owner 可更新团队
CREATE POLICY "teams_update_owner" ON public.teams
  FOR UPDATE TO authenticated
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

-- owner 可删除团队
CREATE POLICY "teams_delete_owner" ON public.teams
  FOR DELETE TO authenticated
  USING (auth.uid() = owner_id);


-- 2.2 team_members 策略
-- =====================

-- 团队成员可互看
CREATE POLICY "members_select_own_or_team" ON public.team_members
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.team_members self
      WHERE self.team_id = team_members.team_id
        AND self.user_id = auth.uid()
    )
  );

-- owner/admin 可邀请；创建者可将自己加入
CREATE POLICY "members_insert_owner_or_admin" ON public.team_members
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.team_members self
      WHERE self.team_id = team_members.team_id
        AND self.user_id = auth.uid()
        AND self.role IN ('owner', 'admin')
    )
    OR auth.uid() = user_id
  );

-- owner 可改所有人；admin 只可改 member
CREATE POLICY "members_update_owner_or_admin" ON public.team_members
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.team_members self
      WHERE self.team_id = team_members.team_id
        AND self.user_id = auth.uid()
        AND (
          self.role = 'owner'
          OR (self.role = 'admin' AND team_members.role = 'member')
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.team_members self
      WHERE self.team_id = team_members.team_id
        AND self.user_id = auth.uid()
        AND (
          self.role = 'owner'
          OR (self.role = 'admin' AND team_members.role = 'member')
        )
    )
  );

-- owner 可删任何人；admin 可删 member；成员可自己离开
CREATE POLICY "members_delete_owner_admin_or_self" ON public.team_members
  FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.team_members self
      WHERE self.team_id = team_members.team_id
        AND self.user_id = auth.uid()
        AND (
          self.role = 'owner'
          OR (self.role = 'admin' AND team_members.role = 'member')
        )
    )
  );


-- 2.3 credit_transactions 策略
-- =====================

-- 团队成员可读本团队流水
CREATE POLICY "transactions_select_team_member" ON public.credit_transactions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.team_members
      WHERE team_members.team_id = credit_transactions.team_id
        AND team_members.user_id = auth.uid()
    )
  );

-- owner/admin 可写入流水
CREATE POLICY "transactions_insert_authenticated" ON public.credit_transactions
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.team_members
      WHERE team_members.team_id = credit_transactions.team_id
        AND team_members.user_id = auth.uid()
        AND team_members.role IN ('owner', 'admin')
    )
  );


-- 2.4 transfer_records 策略
-- =====================

-- 团队成员可读本团队转账记录
CREATE POLICY "transfers_select_team_member" ON public.transfer_records
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.team_members
      WHERE team_members.team_id = transfer_records.team_id
        AND team_members.user_id = auth.uid()
    )
  );

-- 团队成员可创建转账记录
CREATE POLICY "transfers_insert_authenticated" ON public.transfer_records
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.team_members
      WHERE team_members.team_id = transfer_records.team_id
        AND team_members.user_id = auth.uid()
    )
  );


-- ============================================================
-- Phase 3: 索引
-- ============================================================

CREATE INDEX idx_teams_owner_id ON public.teams (owner_id);
CREATE INDEX idx_teams_deleted_at ON public.teams (deleted_at) WHERE deleted_at IS NULL;

CREATE INDEX idx_team_members_team_role ON public.team_members (team_id, role);
CREATE INDEX idx_team_members_user_id ON public.team_members (user_id);

CREATE INDEX idx_credit_transactions_team ON public.credit_transactions (team_id, created_at DESC);
CREATE INDEX idx_credit_transactions_user ON public.credit_transactions (user_id, created_at DESC);

CREATE INDEX idx_transfer_records_team ON public.transfer_records (team_id, created_at DESC);
CREATE INDEX idx_transfer_records_from_user ON public.transfer_records (from_user_id, created_at DESC);
CREATE INDEX idx_transfer_records_to_user ON public.transfer_records (to_user_id, created_at DESC);


-- ============================================================
-- Phase 4: Supabase Function — 解散团队退款
-- ============================================================
CREATE OR REPLACE FUNCTION public.dissolve_team_with_refund(p_team_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
SECURITY DEFINER
AS $$
DECLARE
  v_owner_id uuid;
  v_total_credits integer := 0;
BEGIN
  -- 获取 owner_id
  SELECT owner_id INTO v_owner_id
  FROM public.teams
  WHERE id = p_team_id AND deleted_at IS NULL;

  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'Team not found or already deleted';
  END IF;

  -- 只有 owner 可以调用
  IF auth.uid() != v_owner_id THEN
    RAISE EXCEPTION 'Only the team owner can dissolve the team';
  END IF;

  -- 统计所有成员的 credits_balance 总和
  SELECT COALESCE(SUM(credits_balance), 0) INTO v_total_credits
  FROM public.team_members
  WHERE team_id = p_team_id;

  -- 软删除团队
  UPDATE public.teams
  SET deleted_at = now(), updated_at = now()
  WHERE id = p_team_id;

  -- 清空所有成员的 credits_balance
  UPDATE public.team_members
  SET credits_balance = 0
  WHERE team_id = p_team_id;

  -- 写一条 refund 流水给 owner
  IF v_total_credits > 0 THEN
    INSERT INTO public.credit_transactions
      (team_id, user_id, type, amount, balance_after, operator_id, source_type, description)
    VALUES
      (p_team_id, v_owner_id, 'refund', v_total_credits, v_total_credits, v_owner_id, 'recharge',
       '团队解散，积分退款');
  END IF;
END;
$$;
