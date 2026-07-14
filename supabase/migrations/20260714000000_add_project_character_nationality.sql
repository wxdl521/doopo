-- 由管理员在 Supabase SQL Editor / migration 流程中执行。
-- 为已有项目补上默认角色国籍，保证旧项目和新项目行为一致。
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS character_nationality text NOT NULL DEFAULT '中国';

UPDATE public.projects
SET character_nationality = '中国'
WHERE character_nationality IS NULL OR btrim(character_nationality) = '';
