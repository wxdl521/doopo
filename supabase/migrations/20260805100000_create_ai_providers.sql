-- 供应商管理：public.ai_providers + public.ai_provider_models
--
-- 后台「供应商管理」（/admin/providers，位于「模型定价」之上）的数据底座：
--   - ai_providers：供应商登记（名称 / 接口地址 / 密钥密文 / 内置 Secret 名）
--   - ai_provider_models：供应商下挂载的模型（上架 / 启用 / 能力声明 / 排序）
--
-- 安全模型：
--   - RLS：两表仅 is_credit_admin() 可读写（该函数由
--     20260717000000_add_credit_admin_rpc.sql 创建，本迁移直接复用，不重复定义）。
--   - 用户端不直连表：只经服务端函数 listListedModels（supabaseAdmin / service role）
--     读取「已上架 + 启用」的脱敏目录（不含 base_url / 密钥密文）。
--   - api_key_cipher 为 AES-256-GCM 密文（v1:<iv_b64>:<ct_b64>，密钥来自服务端
--     PROVIDER_KEY_ENC_SECRET），任何返回前端的结构只带 api_key_hint（****尾4位）。
--   - 内置供应商（kind='builtin'）不存密钥，env_key_name 沿用现有 Secret 名，
--     运行时仍读现有 process.env / Cloudflare Secrets。
--
-- 种子数据（全部 listed + enabled）：
--   - 31 个内置供应商，env_key_name 与各 *.functions.ts 读取的 Secret 一致
--   - 图像模型与 src/lib/imageModels.ts 完全一致；视频模型与
--     src/lib/videoGenerate.functions.ts 的模型清单/label 完全一致
--   - 内置供应商的 model_id 一律存「现有路由 id 全量」（如 pixflow/gpt-image-2、
--     qwen-image-2.0、kuaizi-lizhen-pro），保证与既有路由前缀完全一致；
--     动态供应商（kind='openai_compatible'）的 model_id 存上游裸模型名，
--     路由 key = <code>/<model_id>。
--   - 价目档位与 src/lib/creditsCost.ts 及 20260802220000_create_model_pricing.sql
--     的种子对齐（WHERE NOT EXISTS 防重复插入）。

CREATE TABLE public.ai_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'openai_compatible' CHECK (kind IN ('openai_compatible', 'builtin')),
  base_url text,
  api_key_cipher text,
  api_key_hint text,
  env_key_name text,
  enabled boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 路由前缀唯一（小写归一由服务端 upsert 保证；此处再兜一层表达式唯一索引）
CREATE UNIQUE INDEX ai_providers_code_key ON public.ai_providers (lower(code));

CREATE TABLE public.ai_provider_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.ai_providers (id) ON DELETE CASCADE,
  model_id text NOT NULL,
  label text NOT NULL,
  kind text NOT NULL DEFAULT 'image' CHECK (kind IN ('image', 'video', 'text')),
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  listed boolean NOT NULL DEFAULT true,
  enabled boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false,
  sort_order int NOT NULL DEFAULT 0,
  note text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX ai_provider_models_provider_model_key
  ON public.ai_provider_models (provider_id, model_id);
CREATE INDEX idx_ai_provider_models_listed
  ON public.ai_provider_models (kind, listed, enabled, sort_order);

-- ============ RLS（仅 is_credit_admin 可读写） ============
ALTER TABLE public.ai_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_provider_models ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_providers_select ON public.ai_providers
  FOR SELECT TO authenticated USING (public.is_credit_admin());
CREATE POLICY ai_providers_insert ON public.ai_providers
  FOR INSERT TO authenticated WITH CHECK (public.is_credit_admin());
CREATE POLICY ai_providers_update ON public.ai_providers
  FOR UPDATE TO authenticated
  USING (public.is_credit_admin()) WITH CHECK (public.is_credit_admin());
CREATE POLICY ai_providers_delete ON public.ai_providers
  FOR DELETE TO authenticated USING (public.is_credit_admin());

CREATE POLICY ai_provider_models_select ON public.ai_provider_models
  FOR SELECT TO authenticated USING (public.is_credit_admin());
CREATE POLICY ai_provider_models_insert ON public.ai_provider_models
  FOR INSERT TO authenticated WITH CHECK (public.is_credit_admin());
CREATE POLICY ai_provider_models_update ON public.ai_provider_models
  FOR UPDATE TO authenticated
  USING (public.is_credit_admin()) WITH CHECK (public.is_credit_admin());
CREATE POLICY ai_provider_models_delete ON public.ai_provider_models
  FOR DELETE TO authenticated USING (public.is_credit_admin());

-- ============ GRANT ============
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_providers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_provider_models TO authenticated;
GRANT ALL ON public.ai_providers TO service_role;
GRANT ALL ON public.ai_provider_models TO service_role;

-- ============ 种子：内置供应商 ============
-- id 用固定 UUID，便于 ai_provider_models 种子引用与重复执行（ON CONFLICT 幂等）。
INSERT INTO public.ai_providers (id, code, name, kind, base_url, env_key_name, enabled, sort_order) VALUES
  ('aa100000-0000-4000-8000-000000000001', 'ark',         '火山方舟 ARK',          'builtin', 'https://ark.cn-beijing.volces.com/api/v3', 'ARK_API_KEY',           true, 1),
  ('aa100000-0000-4000-8000-000000000002', 'pixflow',     'Pixflow',               'builtin', 'https://api.pixflow.im',                   'PIXFLOW_API_KEY',        true, 2),
  ('aa100000-0000-4000-8000-000000000003', 'claude360',   'Claude360',             'builtin', 'https://claude360.xyz',                    'CLAUDE360_API_KEY',      true, 3),
  ('aa100000-0000-4000-8000-000000000004', 'revora',      'Revora',                'builtin', 'https://revora.vip',                       'REVORA_VIDEO_API_KEY',   true, 4),
  ('aa100000-0000-4000-8000-000000000005', 'tokenflash',  'Tokenflash',            'builtin', 'https://tokenflash.cn',                    'TOKENFLASH_API_KEY',     true, 5),
  ('aa100000-0000-4000-8000-000000000006', 'onetoken',    'OneToken',              'builtin', 'https://api.onetoken.one',                 'ONETOKEN_API_KEY',       true, 6),
  ('aa100000-0000-4000-8000-000000000007', 'aigcfamily',  'AIGCFamily',            'builtin', 'https://api1.aigcfamily.top',              'AIGCFAMILY_API_KEY',     true, 7),
  ('aa100000-0000-4000-8000-000000000008', 'shuci',       '数安词源',              'builtin', 'http://token.ds.cyberpeace.cn',            'SHUANCIYUAN_API_KEY',    true, 8),
  ('aa100000-0000-4000-8000-000000000009', 'aitokenvibe', 'AI Tokenvibe',          'builtin', NULL,                                       'AITOKENVIBE',            true, 9),
  ('aa100000-0000-4000-8000-000000000010', 'thhtcloud',   '天鸿智算',              'builtin', NULL,                                       'THHTCLOUD_API_KEY',      true, 10),
  ('aa100000-0000-4000-8000-000000000011', 'ailinzi',     'ailinzi',               'builtin', NULL,                                       'AILINZI_API_KEY',        true, 11),
  ('aa100000-0000-4000-8000-000000000012', 'agentearth',  'AgentEarth',            'builtin', 'https://maas.agentearth.ai',               'AGENTEARTH_API_KEY',     true, 12),
  ('aa100000-0000-4000-8000-000000000013', 'nagora',      'nagora.ai',             'builtin', NULL,                                       'NAGORA_API_KEY',         true, 13),
  ('aa100000-0000-4000-8000-000000000014', 'meridian',    'MeridianAI',            'builtin', 'https://www.meridiangolf.xyz',             'MERIDIAN_API_KEY',       true, 14),
  ('aa100000-0000-4000-8000-000000000015', 'confluo',     '汇流 Confluo',          'builtin', 'https://models.iystd.com',                 'CONFLUO_API_KEY',        true, 15),
  ('aa100000-0000-4000-8000-000000000016', 'lingmeng',    '灵梦 Lingmeng',         'builtin', NULL,                                       'LINGMENG_API_KEY',       true, 16),
  ('aa100000-0000-4000-8000-000000000017', 'vapeur',      'vapeur.ai',             'builtin', 'https://api.vapeur.ai',                    'VAPEUR_API_KEY',         true, 17),
  ('aa100000-0000-4000-8000-000000000018', 'azure2',      'Azure OpenAI 终结点',   'builtin', NULL,                                       'AZURE2_API_KEY',         true, 18),
  ('aa100000-0000-4000-8000-000000000019', 'azure0716',   'Azure0716',             'builtin', NULL,                                       'AZURE0716_API_KEY',      true, 19),
  ('aa100000-0000-4000-8000-000000000020', 'dashscope',   '阿里百炼 DashScope',    'builtin', 'https://dashscope.aliyuncs.com',           'DASHSCOPE_API_KEY',      true, 20),
  ('aa100000-0000-4000-8000-000000000021', 'topenrouter', 'TopenRouter',           'builtin', 'https://tp-api.chinadatapay.com',          'TOPENROUTER_API_KEY',    true, 21),
  ('aa100000-0000-4000-8000-000000000022', 'hongmeng',    '弘梦',                  'builtin', 'https://ai.kunagent.com',                  'HONGMENG_API_KEY',       true, 22),
  ('aa100000-0000-4000-8000-000000000023', 'sdreal',      'SD Real Max',           'builtin', 'https://service-inference.ai',             'SD_REAL_MAX_API_KEY',    true, 23),
  ('aa100000-0000-4000-8000-000000000024', 'keyiyun',     '客易云',                'builtin', NULL,                                       'KEYYIYUN_API_KEY',       true, 24),
  ('aa100000-0000-4000-8000-000000000025', 'ycore',       '爻核云',                'builtin', NULL,                                       'YCORE_API_KEY',          true, 25),
  ('aa100000-0000-4000-8000-000000000026', 'neiwen',      '内文',                  'builtin', NULL,                                       'NEIWEN_API_KEY',         true, 26),
  ('aa100000-0000-4000-8000-000000000027', 'kling',       '可灵 Kling AI',         'builtin', NULL,                                       'KLING_API_KEY',          true, 27),
  ('aa100000-0000-4000-8000-000000000028', 'kuaizi',      '筷子科技 丽帧',         'builtin', 'https://aiopenapi.kuaizi.cn',              'KUAIZI_API_KEY',         true, 28),
  ('aa100000-0000-4000-8000-000000000029', 'toapis',      'ToAPIs',                'builtin', 'https://toapis.com',                       'TOAPIS_API_KEY',         true, 29),
  ('aa100000-0000-4000-8000-000000000030', 'k99',         'k99.tw',                'builtin', 'https://k99.tw',                           'K99_API_KEY',            true, 30),
  ('aa100000-0000-4000-8000-000000000031', 'jimeng',      '即梦 Jimeng',           'builtin', NULL,                                       'JIMENG_ACCESS_KEY',      true, 31)
ON CONFLICT (lower(code)) DO NOTHING;

-- ============ 种子：图像模型（与 src/lib/imageModels.ts 一致） ============
-- capabilities 强制声明 edits_protocol（json|multipart）与 auth_header（bearer|x-api-key），
-- 动态适配器按声明组请求；内置模型仅作展示与登记，不影响现有分发链。
INSERT INTO public.ai_provider_models (provider_id, model_id, label, kind, capabilities, listed, enabled, is_default, sort_order, note) VALUES
  -- ARK · Seedream（默认主力）
  ('aa100000-0000-4000-8000-000000000001', 'doubao-seedream-5-0-260128', 'Doubao Seedream 5.0 🌱', 'image', '{"t2i":true,"i2i":true,"max_reference_images":10,"edits_protocol":"json","auth_header":"bearer"}', true, true, true, 1, '[ARK 火山方舟] 默认 · T2I/I2I/多图融合'),
  -- Pixflow · Gemini Native
  ('aa100000-0000-4000-8000-000000000002', 'pixflow/gemini-3.1-pro-preview', 'Gemini 3.1 Pro Preview', 'image', '{"t2i":true,"i2i":true,"max_reference_images":10,"edits_protocol":"json","auth_header":"bearer"}', true, true, false, 1, '[Pixflow·Gemini] 高质量 · 文本/多模态'),
  ('aa100000-0000-4000-8000-000000000002', 'pixflow/gemini-3-flash', 'Gemini 3 Flash', 'image', '{"t2i":true,"i2i":true,"max_reference_images":10,"edits_protocol":"json","auth_header":"bearer"}', true, true, false, 2, '[Pixflow·Gemini] 快速 · 文本/多模态'),
  ('aa100000-0000-4000-8000-000000000002', 'pixflow/gemini-3.5-flash', 'Gemini 3.5 Flash', 'image', '{"t2i":true,"i2i":true,"max_reference_images":10,"edits_protocol":"json","auth_header":"bearer"}', true, true, false, 3, '[Pixflow·Gemini] 新版 Flash'),
  ('aa100000-0000-4000-8000-000000000002', 'pixflow/gemini-3.1-flash-image', 'Gemini 3.1 Flash Image', 'image', '{"t2i":true,"i2i":true,"max_reference_images":10,"edits_protocol":"json","auth_header":"bearer"}', true, true, false, 4, '[Pixflow·Gemini] 图像 · T2I/I2I'),
  -- Pixflow · OpenAI 兼容
  ('aa100000-0000-4000-8000-000000000002', 'pixflow/gpt-image-2', 'GPT Image 2', 'image', '{"t2i":true,"i2i":true,"max_reference_images":10,"edits_protocol":"multipart","auth_header":"bearer"}', true, true, false, 5, '[Pixflow·OpenAI] Image2 · T2I/I2I'),
  -- Claude360
  ('aa100000-0000-4000-8000-000000000003', 'claude360/gpt-image-2', 'GPT Image 2', 'image', '{"t2i":true,"i2i":true,"max_reference_images":10,"edits_protocol":"multipart","auth_header":"bearer"}', true, true, false, 1, '[Claude360·OpenAI] Image2 · T2I/I2I'),
  -- Revora
  ('aa100000-0000-4000-8000-000000000004', 'revora/gpt-image-2-high', 'GPT Image 2 High', 'image', '{"t2i":true,"i2i":true,"max_reference_images":10,"edits_protocol":"multipart","auth_header":"bearer"}', true, true, false, 1, '[Revora·OpenAI] 高质量 · T2I/I2I'),
  ('aa100000-0000-4000-8000-000000000004', 'revora/gpt-image-2-medium', 'GPT Image 2 Medium', 'image', '{"t2i":true,"i2i":true,"max_reference_images":10,"edits_protocol":"multipart","auth_header":"bearer"}', true, true, false, 2, '[Revora·OpenAI] 均衡 · T2I/I2I'),
  ('aa100000-0000-4000-8000-000000000004', 'revora/gpt-image-2-low', 'GPT Image 2 Low', 'image', '{"t2i":true,"i2i":true,"max_reference_images":10,"edits_protocol":"multipart","auth_header":"bearer"}', true, true, false, 3, '[Revora·OpenAI] 快速 · T2I/I2I'),
  -- Tokenflash
  ('aa100000-0000-4000-8000-000000000005', 'tokenflash/gpt-image-2', 'GPT Image 2', 'image', '{"t2i":true,"i2i":true,"max_reference_images":10,"edits_protocol":"multipart","auth_header":"bearer"}', true, true, false, 1, '[Tokenflash·OpenAI] Image2 · T2I/I2I · 推荐'),
  -- OneToken
  ('aa100000-0000-4000-8000-000000000006', 'onetoken/gpt-image-2', 'GPT Image 2 (OneToken)', 'image', '{"t2i":true,"i2i":true,"max_reference_images":1,"edits_protocol":"multipart","auth_header":"bearer"}', true, true, false, 1, '[OneToken·OpenAI] Image2 · T2I'),
  -- AIGCFamily
  ('aa100000-0000-4000-8000-000000000007', 'aigcfamily/gpt-image-2', 'aigcfamily-image2', 'image', '{"t2i":true,"i2i":false,"max_reference_images":0,"edits_protocol":"multipart","auth_header":"bearer"}', true, true, false, 1, '[AIGCFamily·OpenAI] Image2 · 仅 T2I'),
  ('aa100000-0000-4000-8000-000000000007', 'aigcfamily/imagen-3.0-generate-001', 'AIGC-imagen3', 'image', '{"t2i":true,"i2i":false,"max_reference_images":0,"edits_protocol":"multipart","auth_header":"bearer"}', true, true, false, 2, '[AIGCFamily·OpenAI] Imagen3 · 仅 T2I'),
  -- 数安词源
  ('aa100000-0000-4000-8000-000000000008', 'shuci/gpt-image-2', '数安词源-image2', 'image', '{"t2i":true,"i2i":true,"max_reference_images":10,"edits_protocol":"multipart","auth_header":"bearer"}', true, true, false, 1, '[数安词源·OpenAI] Image2 · T2I/I2I'),
  -- AI Tokenvibe
  ('aa100000-0000-4000-8000-000000000009', 'aitokenvibe/gpt-image-2', 'GPT Image 2', 'image', '{"t2i":true,"i2i":true,"max_reference_images":10,"edits_protocol":"multipart","auth_header":"bearer"}', true, true, false, 1, '[AI Tokenvibe·OpenAI] Image2 · T2I/I2I'),
  -- 天鸿智算
  ('aa100000-0000-4000-8000-000000000010', 'thhtcloud/gpt-image-2', 'GPT Image 2', 'image', '{"t2i":true,"i2i":true,"max_reference_images":10,"edits_protocol":"multipart","auth_header":"bearer"}', true, true, false, 1, '[天鸿智算·OpenAI] Image2 · T2I/I2I'),
  -- ailinzi
  ('aa100000-0000-4000-8000-000000000011', 'ailinzi/gpt-image-2', 'GPT Image 2', 'image', '{"t2i":true,"i2i":true,"max_reference_images":10,"edits_protocol":"multipart","auth_header":"bearer"}', true, true, false, 1, '[ailinzi·OpenAI] Image2 · T2I/I2I'),
  ('aa100000-0000-4000-8000-000000000011', 'ailinzi/gpt-image-2-all', 'GPT Image 2 All', 'image', '{"t2i":true,"i2i":false,"max_reference_images":0,"edits_protocol":"multipart","auth_header":"bearer"}', true, true, false, 2, '[ailinzi·OpenAI] Image2 All · T2I'),
  -- AgentEarth
  ('aa100000-0000-4000-8000-000000000012', 'agentearth/image2', 'AgentEarth Image2 (4K)', 'image', '{"t2i":true,"i2i":true,"max_reference_images":10,"edits_protocol":"multipart","auth_header":"bearer"}', true, true, false, 1, '[AgentEarth·OpenAI] GPT Image 2 · T2I/I2I'),
  -- nagora.ai（Azure 渠道，api-key 认证头）
  ('aa100000-0000-4000-8000-000000000013', 'nagora/gpt-image-2', 'GPT Image 2', 'image', '{"t2i":true,"i2i":true,"max_reference_images":10,"edits_protocol":"multipart","auth_header":"x-api-key"}', true, true, false, 1, '[nagora·Azure 渠道] Image2 · T2I/I2I'),
  -- MeridianAI
  ('aa100000-0000-4000-8000-000000000014', 'meridian/gpt-image-2', 'GPT Image 2', 'image', '{"t2i":true,"i2i":true,"max_reference_images":10,"edits_protocol":"multipart","auth_header":"bearer"}', true, true, false, 1, '[MeridianAI·OpenAI] Image2 · T2I/I2I'),
  -- 汇流 Confluo
  ('aa100000-0000-4000-8000-000000000015', 'confluo/gpt-image-2', 'GPT Image 2', 'image', '{"t2i":true,"i2i":true,"max_reference_images":10,"edits_protocol":"multipart","auth_header":"bearer"}', true, true, false, 1, '[汇流·OpenAI] Image2 · T2I/I2I'),
  -- 灵梦 Lingmeng
  ('aa100000-0000-4000-8000-000000000016', 'lingmeng/gpt-image-2', 'GPT Image 2', 'image', '{"t2i":true,"i2i":true,"max_reference_images":10,"edits_protocol":"multipart","auth_header":"bearer"}', true, true, false, 1, '[灵梦·OpenAI] Image2 · T2I/I2I'),
  -- vapeur.ai
  ('aa100000-0000-4000-8000-000000000017', 'vapeur/gpt-image-2', 'GPT Image 2', 'image', '{"t2i":true,"i2i":true,"max_reference_images":10,"edits_protocol":"multipart","auth_header":"bearer"}', true, true, false, 1, '[vapeur·OpenAI] Image2 · T2I/I2I'),
  -- Azure OpenAI 终结点（api-key 认证头）
  ('aa100000-0000-4000-8000-000000000018', 'azure2/gpt-image-2', 'Azure-gpt-image-2', 'image', '{"t2i":true,"i2i":true,"max_reference_images":10,"edits_protocol":"multipart","auth_header":"x-api-key"}', true, true, false, 1, '[Azure OpenAI 终结点] gpt-image-2 · T2I/I2I'),
  ('aa100000-0000-4000-8000-000000000019', 'azure0716/gpt-image-2', 'Azure0716-gpt-image-2', 'image', '{"t2i":true,"i2i":true,"max_reference_images":10,"edits_protocol":"multipart","auth_header":"x-api-key"}', true, true, false, 1, '[Azure0716 · Azure OpenAI] gpt-image-2 · T2I/I2I'),
  -- DashScope 通义千问 / 万相
  ('aa100000-0000-4000-8000-000000000020', 'qwen-image-2.0', 'Qwen Image 2.0', 'image', '{"t2i":true,"i2i":false,"max_reference_images":0,"edits_protocol":"json","auth_header":"bearer"}', true, true, false, 1, '[DashScope] 通义千问 · T2I 稳定'),
  ('aa100000-0000-4000-8000-000000000020', 'qwen-image-2.0-pro', 'Qwen Image 2.0 Pro', 'image', '{"t2i":false,"i2i":true,"max_reference_images":3,"edits_protocol":"json","auth_header":"bearer"}', true, true, false, 2, '[DashScope] 通义千问 · I2I 专用'),
  ('aa100000-0000-4000-8000-000000000020', 'qwen-image-plus', 'Qwen Image Plus', 'image', '{"t2i":true,"i2i":false,"max_reference_images":0,"edits_protocol":"json","auth_header":"bearer"}', true, true, false, 3, '[DashScope] 通义千问 · 高清'),
  ('aa100000-0000-4000-8000-000000000020', 'qwen-image', 'Qwen Image', 'image', '{"t2i":true,"i2i":false,"max_reference_images":0,"edits_protocol":"json","auth_header":"bearer"}', true, true, false, 4, '[DashScope] 通义千问 · 基础'),
  ('aa100000-0000-4000-8000-000000000020', 'wan2.6-t2i', '万相 2.6 文生图', 'image', '{"t2i":true,"i2i":false,"max_reference_images":0,"edits_protocol":"json","auth_header":"bearer"}', true, true, false, 5, '[DashScope] Wan · 推荐'),
  ('aa100000-0000-4000-8000-000000000020', 'wan2.5-t2i-preview', '万相 2.5 文生图 Preview', 'image', '{"t2i":true,"i2i":false,"max_reference_images":0,"edits_protocol":"json","auth_header":"bearer"}', true, true, false, 6, '[DashScope] Wan · 自由尺寸'),
  ('aa100000-0000-4000-8000-000000000020', 'wan2.2-t2i-flash', '万相 2.2 文生图 Flash', 'image', '{"t2i":true,"i2i":false,"max_reference_images":0,"edits_protocol":"json","auth_header":"bearer"}', true, true, false, 7, '[DashScope] Wan · 快速'),
  ('aa100000-0000-4000-8000-000000000020', 'wan2.2-t2i-plus', '万相 2.2 文生图 Plus', 'image', '{"t2i":true,"i2i":false,"max_reference_images":0,"edits_protocol":"json","auth_header":"bearer"}', true, true, false, 8, '[DashScope] Wan · 高质量'),
  ('aa100000-0000-4000-8000-000000000020', 'wanx2.1-t2i-turbo', '万相 2.1 极速版', 'image', '{"t2i":true,"i2i":false,"max_reference_images":0,"edits_protocol":"json","auth_header":"bearer"}', true, true, false, 9, '[DashScope] Wanx · 极速'),
  ('aa100000-0000-4000-8000-000000000020', 'wanx2.1-t2i-plus', '万相 2.1 专业版', 'image', '{"t2i":true,"i2i":false,"max_reference_images":0,"edits_protocol":"json","auth_header":"bearer"}', true, true, false, 10, '[DashScope] Wanx · 专业')
ON CONFLICT (provider_id, model_id) DO NOTHING;

-- ============ 种子：视频模型（与 videoGenerate.functions.ts 模型清单/label 一致） ============
INSERT INTO public.ai_provider_models (provider_id, model_id, label, kind, capabilities, listed, enabled, is_default, sort_order, note) VALUES
  -- ARK Seedance
  ('aa100000-0000-4000-8000-000000000001', 'doubao-seedance-2-0-260128', 'Doubao Seedance 2.0', 'video', '{"resolutions":["480P","720P"],"edits_protocol":"json","auth_header":"bearer"}', true, true, true, 101, '多模态 · 237.6积分/10s'),
  ('aa100000-0000-4000-8000-000000000001', 'doubao-seedance-2-0-fast-260128', 'Doubao Seedance 2.0 Fast (720p)', 'video', '{"resolutions":["480P","720P"],"edits_protocol":"json","auth_header":"bearer"}', true, true, false, 102, '快速版 · 192积分/10s'),
  ('aa100000-0000-4000-8000-000000000001', 'doubao-seedance-1-0-pro-250528', 'Doubao Seedance 1.0 Pro (T2V)', 'video', '{"edits_protocol":"json","auth_header":"bearer"}', true, true, false, 103, NULL),
  ('aa100000-0000-4000-8000-000000000001', 'doubao-seedance-1-0-lite-i2v-250428', 'Doubao Seedance 1.0 Lite (I2V)', 'video', '{"edits_protocol":"json","auth_header":"bearer"}', true, true, false, 104, NULL),
  -- 数安词源
  ('aa100000-0000-4000-8000-000000000008', 'shuci-seedance-2-0', 'Seedance 2.0 (数安词源)', 'video', '{"edits_protocol":"json","auth_header":"bearer"}', true, true, false, 101, NULL),
  ('aa100000-0000-4000-8000-000000000008', 'shuci-seedance-2-0-fast', 'Seedance 2.0 Fast (数安词源)', 'video', '{"edits_protocol":"json","auth_header":"bearer"}', true, true, false, 102, NULL),
  ('aa100000-0000-4000-8000-000000000008', 'shuci-seedance-2-0-mini', 'Seedance 2.0 Mini (数安词源)', 'video', '{"edits_protocol":"json","auth_header":"bearer"}', true, true, false, 103, NULL),
  -- 汇流 Confluo
  ('aa100000-0000-4000-8000-000000000015', 'confluo-doubao-seedance-2-0-260128', 'Seedance 2.0 (汇流)', 'video', '{"edits_protocol":"json","auth_header":"bearer"}', true, true, false, 101, NULL),
  ('aa100000-0000-4000-8000-000000000015', 'confluo-doubao-seedance-2-0-fast-260128', 'Seedance 2.0 Fast (汇流)', 'video', '{"edits_protocol":"json","auth_header":"bearer"}', true, true, false, 102, NULL),
  ('aa100000-0000-4000-8000-000000000015', 'confluo-doubao-seedance-2-0-mini-260615', 'Seedance 2.0 Mini (汇流)', 'video', '{"edits_protocol":"json","auth_header":"bearer"}', true, true, false, 103, NULL),
  -- TopenRouter
  ('aa100000-0000-4000-8000-000000000021', 'topenrouter-doubao-seedance-2-0-260128', 'Seedance 2.0 (TopenRouter)', 'video', '{"resolutions":["480P","720P"],"edits_protocol":"json","auth_header":"bearer"}', true, true, false, 101, NULL),
  ('aa100000-0000-4000-8000-000000000021', 'topenrouter-doubao-seedance-2-0-fast-260128', 'Seedance 2.0 Fast (TopenRouter)', 'video', '{"resolutions":["480P","720P"],"edits_protocol":"json","auth_header":"bearer"}', true, true, false, 102, NULL),
  ('aa100000-0000-4000-8000-000000000021', 'topenrouter-doubao-seedance-2-0-mini-260615', 'Seedance 2.0 Mini (TopenRouter)', 'video', '{"edits_protocol":"json","auth_header":"bearer"}', true, true, false, 103, NULL),
  -- 弘梦
  ('aa100000-0000-4000-8000-000000000022', 'hongmeng-seedance2-fast', 'Seedance 2 Fast (弘梦)', 'video', '{"resolutions":["480P","720P"],"edits_protocol":"json","auth_header":"bearer"}', true, true, false, 101, NULL),
  ('aa100000-0000-4000-8000-000000000022', 'hongmeng-seedance2-mini', 'Seedance 2 Mini (弘梦)', 'video', '{"resolutions":["480P","720P"],"edits_protocol":"json","auth_header":"bearer"}', true, true, false, 102, NULL),
  ('aa100000-0000-4000-8000-000000000022', 'hongmeng-seedance2-pro', 'Seedance 2 Pro (弘梦)', 'video', '{"resolutions":["480P","720P","1080P"],"edits_protocol":"json","auth_header":"bearer"}', true, true, false, 103, NULL),
  -- SD Real Max（Dreamina Seedance 2.0）
  ('aa100000-0000-4000-8000-000000000023', 'dreamina-seedance-2-0-fast-hc', 'Dreamina Seedance 2.0 Fast (SD Real Max)', 'video', '{"resolutions":["480P","720P"],"edits_protocol":"json","auth_header":"bearer"}', true, true, false, 101, NULL),
  ('aa100000-0000-4000-8000-000000000023', 'dreamina-seedance-2-0-hc', 'Dreamina Seedance 2.0 (SD Real Max)', 'video', '{"resolutions":["480P","720P"],"edits_protocol":"json","auth_header":"bearer"}', true, true, false, 102, NULL),
  ('aa100000-0000-4000-8000-000000000023', 'dreamina-seedance-2-0-mini-hc', 'Dreamina Seedance 2.0 Mini (SD Real Max)', 'video', '{"resolutions":["480P","720P"],"edits_protocol":"json","auth_header":"bearer"}', true, true, false, 103, NULL),
  -- 客易云
  ('aa100000-0000-4000-8000-000000000024', 'keyiyun-sd-2-0-fast-discount-720p', 'Seedance 2.0 官方折扣版（客易云 · 720p）', 'video', '{"resolutions":["720P"],"edits_protocol":"json","auth_header":"bearer"}', true, true, false, 101, NULL),
  -- 爻核云
  ('aa100000-0000-4000-8000-000000000025', 'ycore-seedance-2-0', 'Seedance 2.0 (爻核云)', 'video', '{"resolutions":["480P","720P","1080P"],"edits_protocol":"json","auth_header":"bearer"}', true, true, false, 101, NULL),
  ('aa100000-0000-4000-8000-000000000025', 'ycore-seedance-2-0-fast', 'Seedance 2.0 Fast (爻核云)', 'video', '{"resolutions":["480P","720P"],"edits_protocol":"json","auth_header":"bearer"}', true, true, false, 102, NULL),
  ('aa100000-0000-4000-8000-000000000025', 'ycore-seedance-2-0-mini', 'Seedance 2.0 Mini (爻核云)', 'video', '{"resolutions":["480P","720P"],"edits_protocol":"json","auth_header":"bearer"}', true, true, false, 103, NULL),
  -- 内文
  ('aa100000-0000-4000-8000-000000000026', 'neiwen-c-seedance-2-0', 'c/seedance-2.0 (内文)', 'video', '{"resolutions":["480P","720P","1080P"],"edits_protocol":"json","auth_header":"bearer"}', true, true, false, 101, NULL),
  -- 可灵 Kling
  ('aa100000-0000-4000-8000-000000000027', 'kling-v2-6', 'Kling 2.6 · 最高画质 · 5/10s · 原生音频', 'video', '{"edits_protocol":"json","auth_header":"bearer"}', true, true, false, 101, NULL),
  ('aa100000-0000-4000-8000-000000000027', 'kling-v3', 'Kling 3.0 · 旗舰 · 3-15s · 多镜头', 'video', '{"edits_protocol":"json","auth_header":"bearer"}', true, true, false, 102, NULL),
  -- Revora 视频
  ('aa100000-0000-4000-8000-000000000004', 'revora-seedance-2-0', 'Seedance 2.0 (Revora)', 'video', '{"resolutions":["480P","720P","1080P"],"edits_protocol":"json","auth_header":"bearer"}', true, true, false, 101, NULL),
  -- AgentEarth 视频
  ('aa100000-0000-4000-8000-000000000012', 'earth/seedance-2.0', 'Doubao Seedance 2.0 (AgentEarth)', 'video', '{"resolutions":["480P","720P","1080P"],"edits_protocol":"json","auth_header":"bearer"}', true, true, false, 101, NULL),
  ('aa100000-0000-4000-8000-000000000012', 'earth/seedance-2.0-global', 'Doubao Seedance 2.0 Global (AgentEarth)', 'video', '{"resolutions":["480P","720P","1080P"],"edits_protocol":"json","auth_header":"bearer"}', true, true, false, 102, NULL),
  -- 筷子科技 丽帧
  ('aa100000-0000-4000-8000-000000000028', 'kuaizi-lizhen-pro', '丽帧 Pro (1080p · 文/图/多模态)', 'video', '{"resolutions":["480P","720P","1080P"],"edits_protocol":"json","auth_header":"bearer"}', true, true, false, 101, '110.4-593积分/10s'),
  ('aa100000-0000-4000-8000-000000000028', 'kuaizi-lizhen-fast', '丽帧 Fast (720p · 快速)', 'video', '{"resolutions":["480P","720P"],"edits_protocol":"json","auth_header":"bearer"}', true, true, false, 102, '89-192积分/10s'),
  ('aa100000-0000-4000-8000-000000000028', 'kuaizi-lizhen-mini', '丽帧 Mini (轻量)', 'video', '{"resolutions":["480P","720P"],"edits_protocol":"json","auth_header":"bearer"}', true, true, false, 103, '56-120积分/10s'),
  -- ToAPIs
  ('aa100000-0000-4000-8000-000000000029', 'toapis-seedance-2', 'Seedance 2 (ToAPIs · 1080p/4k)', 'video', '{"edits_protocol":"json","auth_header":"bearer"}', true, true, false, 101, NULL),
  ('aa100000-0000-4000-8000-000000000029', 'toapis-seedance-2-fast', 'Seedance 2 Fast (ToAPIs · 720p)', 'video', '{"edits_protocol":"json","auth_header":"bearer"}', true, true, false, 102, NULL),
  ('aa100000-0000-4000-8000-000000000029', 'toapis-seedance-2-mini', 'Seedance 2 Mini (ToAPIs · 多模态参考)', 'video', '{"edits_protocol":"json","auth_header":"bearer"}', true, true, false, 103, NULL),
  -- k99.tw
  ('aa100000-0000-4000-8000-000000000030', 'k99-fast-480p', 'k99 快速 480p', 'video', '{"resolutions":["480P"],"edits_protocol":"json","auth_header":"bearer"}', true, true, false, 101, NULL),
  ('aa100000-0000-4000-8000-000000000030', 'k99-pro-1080p', 'k99 高清 1080p', 'video', '{"resolutions":["1080P"],"edits_protocol":"json","auth_header":"bearer"}', true, true, false, 102, NULL),
  -- 即梦（火山引擎视觉服务）
  ('aa100000-0000-4000-8000-000000000031', 'jimeng-3.0-pro', '即梦 3.0 Pro (文生视频)', 'video', '{"edits_protocol":"json","auth_header":"bearer"}', true, true, false, 101, NULL),
  ('aa100000-0000-4000-8000-000000000031', 'jimeng-3.0-pro-i2v', '即梦 3.0 Pro (图生视频·首帧)', 'video', '{"edits_protocol":"json","auth_header":"bearer"}', true, true, false, 102, NULL),
  -- HappyHorse（DashScope 备用）
  ('aa100000-0000-4000-8000-000000000020', 'happyhorse-1.0-t2v', 'HappyHorse 1.0 (文生视频)', 'video', '{"edits_protocol":"json","auth_header":"bearer"}', true, true, false, 101, NULL),
  ('aa100000-0000-4000-8000-000000000020', 'happyhorse-1.0-i2v', 'HappyHorse 1.0 (图生视频·首帧)', 'video', '{"edits_protocol":"json","auth_header":"bearer"}', true, true, false, 102, NULL),
  ('aa100000-0000-4000-8000-000000000020', 'happyhorse-1.0-r2v', 'HappyHorse 1.0 (参考生视频)', 'video', '{"edits_protocol":"json","auth_header":"bearer"}', true, true, false, 103, NULL)
ON CONFLICT (provider_id, model_id) DO NOTHING;

-- ============ 种子：价目档位 ============
-- 与 src/lib/creditsCost.ts 兜底表及 20260802220000_create_model_pricing.sql 首批价目
-- 完全一致；WHERE NOT EXISTS 保证重复执行 / 已执行过旧迁移的库不会产生重复行。
INSERT INTO public.model_pricing (kind, model_id, label, resolution, credits, is_default, enabled, sort_order)
SELECT * FROM (VALUES
  ('image', 'tokenflash/', 'TokenFlash 生图', NULL::text, 5::numeric, false, true, 1),
  ('image', 'revora/',     'Revora 生图',     NULL,        4,          false, true, 2),
  ('image', 'azure/',      'Azure 生图',      NULL,        9,          false, true, 3),
  ('image', 'azure2/',     'Azure 2 生图',    NULL,        9,          false, true, 4),
  ('image', 'azure3/',     'Azure 3 生图',    NULL,        9,          false, true, 5),
  ('image', 'azure0716/',  'Azure 0716 生图', NULL,        9,          false, true, 6),
  ('video', 'kuaizi-lizhen-fast',              '丽帧 Fast',         '480P',  89,    false, true, 1),
  ('video', 'kuaizi-lizhen-fast',              '丽帧 Fast',         '720P',  192,   false, true, 2),
  ('video', 'kuaizi-lizhen-pro',               '丽帧 Pro',          '480P',  110.4, false, true, 3),
  ('video', 'kuaizi-lizhen-pro',               '丽帧 Pro',          '720P',  118,   false, true, 4),
  ('video', 'kuaizi-lizhen-pro',               '丽帧 Pro',          '1080P', 593,   false, true, 5),
  ('video', 'kuaizi-lizhen-mini',              '丽帧 Mini',         '480P',  56,    false, true, 6),
  ('video', 'kuaizi-lizhen-mini',              '丽帧 Mini',         '720P',  120,   false, true, 7),
  ('video', 'doubao-seedance-2-0-fast-260128', 'Seedance 2.0 Fast', '480P',  192,   false, true, 8),
  ('video', 'doubao-seedance-2-0-fast-260128', 'Seedance 2.0 Fast', '720P',  192,   false, true, 9),
  ('video', 'doubao-seedance-2-0-260128',      'Seedance 2.0',      '480P',  237.6, false, true, 10),
  ('video', 'doubao-seedance-2-0-260128',      'Seedance 2.0',      '720P',  237.6, true,  true, 11)
) AS seed (kind, model_id, label, resolution, credits, is_default, enabled, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM public.model_pricing existing
  WHERE existing.kind = seed.kind
    AND existing.model_id = seed.model_id
    AND coalesce(existing.resolution, '') = coalesce(seed.resolution, '')
);
