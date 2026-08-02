-- 视频转绘工作台：执行模式与制作规格列（需求「四、持久化与双向联动」）
-- v1 工作台状态在 localStorage（restyleStorage.ts），此处仅为 restyle_projects 备好同名列，
-- 供 v2 / 后续服务端持久化使用；不跑 db:push，按项目约定生产手动执行。

ALTER TABLE public.restyle_projects
  ADD COLUMN IF NOT EXISTS execution_mode text,
  ADD COLUMN IF NOT EXISTS auto_budget numeric,
  ADD COLUMN IF NOT EXISTS asset_image_source text,
  ADD COLUMN IF NOT EXISTS voice_source text,
  ADD COLUMN IF NOT EXISTS manual_gates jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS aspect text;

-- 取值约束（与 src/components/restyle/restyleExecution.ts 保持一致）
ALTER TABLE public.restyle_projects
  ADD CONSTRAINT restyle_projects_execution_mode_check
    CHECK (execution_mode IS NULL OR execution_mode IN ('auto', 'guided', 'custom')),
  ADD CONSTRAINT restyle_projects_asset_image_source_check
    CHECK (asset_image_source IS NULL OR asset_image_source IN ('system', 'upload', 'mixed')),
  ADD CONSTRAINT restyle_projects_voice_source_check
    CHECK (voice_source IS NULL OR voice_source IN ('auto', 'voice_pick', 'upload')),
  ADD CONSTRAINT restyle_projects_aspect_check
    CHECK (aspect IS NULL OR aspect IN ('16:9', '4:3', '3:4', '9:16'));
