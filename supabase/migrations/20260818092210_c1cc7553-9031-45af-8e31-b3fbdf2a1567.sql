-- 供应商密钥表：撤销 anon 直连权限（策略已限定管理员，权限层再兜底）
REVOKE ALL ON public.ai_providers FROM anon;
REVOKE ALL ON public.ai_provider_models FROM anon;

-- 生成错误日志：仅服务端写入，用户只读本人
REVOKE ALL ON public.generation_error_logs FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES ON public.generation_error_logs FROM authenticated;
GRANT SELECT ON public.generation_error_logs TO authenticated;
GRANT ALL ON public.generation_error_logs TO service_role;

-- 管理员名单表：无策略即拒绝，权限层同步收紧
REVOKE ALL ON public.admin_users FROM anon;
REVOKE ALL ON public.admin_users FROM authenticated;
GRANT ALL ON public.admin_users TO service_role;