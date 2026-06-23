CREATE TABLE public.password_audit_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('reset_requested','reset_completed','password_changed')),
  ip_address TEXT,
  user_agent TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX password_audit_log_user_id_created_at_idx ON public.password_audit_log (user_id, created_at DESC);

GRANT SELECT, INSERT ON public.password_audit_log TO authenticated;
GRANT ALL ON public.password_audit_log TO service_role;

ALTER TABLE public.password_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own password audit log"
  ON public.password_audit_log FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own password audit log"
  ON public.password_audit_log FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);