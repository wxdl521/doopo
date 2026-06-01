
-- Add workspace data persistence columns to projects table
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS workspace_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS completed_stages text[] NOT NULL DEFAULT '{}';
