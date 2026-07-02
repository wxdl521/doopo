import { useLocation, Link } from "@tanstack/react-router";
import { LogIn, UserPlus, Lock } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import type { ReactNode } from "react";

// 公开路径：无需登录即可访问
// 首页（社区精选展示）、社区浏览、登录注册、定价、官方 Showcase
const PUBLIC_PREFIXES = ["/home", "/login", "/register", "/community", "/showcase", "/pricing"];

function isPublicPath(pathname: string) {
  if (pathname === "/") return true;
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export default function AuthGate({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { isAuthenticated, loading } = useAuth();

  if (isPublicPath(location.pathname)) return <>{children}</>;
  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-sm text-text-secondary">
        正在加载…
      </div>
    );
  }
  if (isAuthenticated) return <>{children}</>;

  return (
    <div className="flex items-center justify-center py-16 animate-fade-in">
      <div className="panel max-w-md w-full p-8 text-center border border-accent/30">
        <div className="mx-auto w-12 h-12 rounded-full bg-accent-dim/60 flex items-center justify-center mb-4">
          <Lock size={22} className="text-accent" />
        </div>
        <h2 className="font-display text-2xl font-bold mb-2">需要登录后继续</h2>
        <p className="text-text-secondary text-sm mb-6">
          该功能需要登录账号才能使用。登录后可在多设备同步你的创作、资产与互动记录。
          首页与社区分享内容无需登录即可浏览。
        </p>
        <div className="flex items-center justify-center gap-2">
          <Link to="/login" className="btn-primary inline-flex items-center gap-1.5 text-sm">
            <LogIn size={14} /> 登录
          </Link>
          <Link to="/register" className="btn-secondary inline-flex items-center gap-1.5 text-sm">
            <UserPlus size={14} /> 注册
          </Link>
        </div>
        <div className="mt-6 text-xs text-text-secondary">
          <Link to="/home" className="hover:text-accent">
            ← 返回首页浏览社区精选
          </Link>
        </div>
      </div>
    </div>
  );
}
