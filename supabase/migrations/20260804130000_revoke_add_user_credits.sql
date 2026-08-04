-- 安全修复：撤销登录用户直接调用 add_user_credits 的权限。
-- 原授权（20260703000001）允许任何登录用户 rpc 自充任意积分，使积分体系失效。
-- 充值应走支付回调 / 管理员发放（admin_grant_credits）。
-- 影响：rechargeCredits 前端入口将返回错误，直到接入支付回调。

REVOKE EXECUTE ON FUNCTION public.add_user_credits(integer) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.add_user_credits(numeric) FROM authenticated;
