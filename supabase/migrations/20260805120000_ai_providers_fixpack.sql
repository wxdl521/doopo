-- 供应商管理修正包（20260805 审计后）：
-- 1. 补齐 vapeur 两个视频模型种子（与 videoGenerate 清单一致）
-- 2. 回填 12 家内置供应商的 base_url（测试连接需要；运行时仍读代码默认/env）
-- 3. 补 azure/azure3 供应商行（价目表里有价目但供应商表缺失）

-- 1. 缺失视频模型种子
INSERT INTO public.ai_provider_models (provider_id, model_id, label, kind, capabilities, listed, enabled, is_default, sort_order, note)
SELECT p.id, v.model_id, v.label, 'video', '{}'::jsonb, true, true, false, 900, '修正包补齐'
FROM public.ai_providers p
JOIN (VALUES
  ('vapeur-doubao-seedance-2-0-260128', 'Seedance 2.0 (Vapeur)'),
  ('vapeur-doubao-seedance-2-0-fast-260128', 'Seedance 2.0 Fast (Vapeur)')
) AS v(model_id, label) ON p.code = 'vapeur'
WHERE NOT EXISTS (
  SELECT 1 FROM public.ai_provider_models m
  WHERE m.provider_id = p.id AND m.model_id = v.model_id
);

-- 2. 回填 base_url（仅当前为 NULL 的行，不覆盖人工配置）
UPDATE public.ai_providers SET base_url = v.url
FROM (VALUES
  ('aitokenvibe', 'https://api.aitokenvibe.com'),
  ('thhtcloud',   'https://api.thhtcloud.com'),
  ('ailinzi',     'https://ailinzi666.com'),
  ('nagora',      'https://api.nagora.ai'),
  ('lingmeng',    'https://1189.xin'),
  ('kling',       'https://api-beijing.klingai.com'),
  ('ycore',       'https://yaonic.ai/v1'),
  ('neiwen',      'https://api.neiwen.cn'),
  ('jimeng',      'https://visual.volcengineapi.com'),
  ('azure2',      'https://ywkjpolandcentral.cognitiveservices.azure.com'),
  ('azure0716',   'https://ywkjpolandcentral.cognitiveservices.azure.com')
) AS v(code, url)
WHERE ai_providers.code = v.code AND ai_providers.base_url IS NULL;
-- 注：keyiyun 的 base_url 由 KEYYIYUN_BASE_URL env 配置，代码无默认值，保持 NULL。

-- 3. 补 azure / azure3 供应商行（seedream 分发链存在这两前缀，价目表有对应价目）
INSERT INTO public.ai_providers (code, name, kind, base_url, api_key_cipher, api_key_hint, env_key_name, enabled, sort_order)
SELECT v.code, v.name, 'builtin', v.url, NULL, NULL, v.envkey, true, 950
FROM (VALUES
  ('azure',  'Azure OpenAI（ywkjpolandcentral）', 'https://ywkjpolandcentral.cognitiveservices.azure.com', 'AZURE_API_KEY'),
  ('azure3', 'Azure OpenAI services.ai 资源', 'https://services.ai.azure.com', 'AZURE3_API_KEY')
) AS v(code, name, url, envkey)
WHERE NOT EXISTS (SELECT 1 FROM public.ai_providers p WHERE p.code = v.code);
