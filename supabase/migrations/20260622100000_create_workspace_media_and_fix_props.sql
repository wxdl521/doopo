-- ====================================================================
--  2026/06/22: 综合修复
--  1. 创建 workspace-media public bucket（如已存在则跳过）
--  2. 设置 RLS 策略（用户只能读写自己 userId/ 路径）
--  3. 修复 props 表: id UUID → TEXT, 新增 episode_index 列
--  4. 添加 proper grant 权限
-- ====================================================================

-- ============ 1. workspace-media bucket ============
INSERT INTO storage.buckets (id, name, public)
VALUES ('workspace-media', 'workspace-media', true)
ON CONFLICT (id) DO NOTHING;

-- RLS: 每个用户只能读写自己 userId/ 开头的路径
DROP POLICY IF EXISTS workspace_media_all_own ON storage.objects;
CREATE POLICY workspace_media_all_own ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'workspace-media' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'workspace-media' AND (storage.foldername(name))[1] = auth.uid()::text);

-- 旧策略清理（如果有的话）
DROP POLICY IF EXISTS workspace_media_read_own ON storage.objects;
DROP POLICY IF EXISTS workspace_media_write_own ON storage.objects;
DROP POLICY IF EXISTS workspace_media_update_own ON storage.objects;
DROP POLICY IF EXISTS workspace_media_delete_own ON storage.objects;

-- ============ 2. 修复 props 表 ============
-- 问题: id 列是 UUID 类型,但代码生成的是文本 id(如 "prop-abc123"),导致 500 错误
-- 修复: 改为 TEXT 类型,和 characters / scenes 表保持一致
-- 同时新增 episode_index 列(GenProp.episodeIndex 需要)

DROP TRIGGER IF EXISTS props_set_updated_at ON public.props;
DROP POLICY IF EXISTS "Users manage own props" ON public.props;
DROP POLICY IF EXISTS props_all_own ON public.props;

DROP TABLE IF EXISTS public.props;

CREATE TABLE public.props (
  id TEXT NOT NULL PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  movement_description TEXT,
  episode_index INTEGER NOT NULL DEFAULT 1,
  key_moments TEXT[] DEFAULT '{}'::TEXT[],
  palette TEXT[] DEFAULT '{}'::TEXT[],
  cover_url TEXT,
  images JSONB DEFAULT '[]'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.props TO authenticated;
GRANT ALL ON public.props TO service_role;

ALTER TABLE public.props ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own props" ON public.props
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER props_set_updated_at
  BEFORE UPDATE ON public.props
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
