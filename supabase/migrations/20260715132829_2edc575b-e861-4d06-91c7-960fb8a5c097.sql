CREATE TABLE public.generation_error_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('image','video')),
  provider text NOT NULL,
  model text,
  status integer,
  duration_ms integer,
  request_payload jsonb,
  response_body text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.generation_error_logs TO authenticated;
GRANT ALL ON public.generation_error_logs TO service_role;

ALTER TABLE public.generation_error_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own error logs"
  ON public.generation_error_logs
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX generation_error_logs_user_created_idx
  ON public.generation_error_logs (user_id, created_at DESC);

CREATE INDEX generation_error_logs_kind_created_idx
  ON public.generation_error_logs (kind, created_at DESC);