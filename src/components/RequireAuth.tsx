// ====================================================================
// 登录守卫：未登录访问受保护页面时跳 /login 并带 redirect 回跳参数，
// 登录成功后按该参数跳回原页面（见 routes/login.tsx）。加载中或未登录
// 时不渲染子树，避免受保护内容闪现。
// ====================================================================

import { useEffect } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useAuth } from "../hooks/useAuth";

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  useEffect(() => {
    if (loading || isAuthenticated) return;
    void navigate({ to: "/login", search: { redirect: pathname }, replace: true });
  }, [loading, isAuthenticated, navigate, pathname]);

  if (loading || !isAuthenticated) return null;
  return <>{children}</>;
}
