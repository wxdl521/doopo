import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import Logo from "../components/Logo";
import PasswordInput from "../components/PasswordInput";
import { useLanguage } from "../i18n/LanguageContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>) => ({
    // 登录成功后的回跳目标；仅接受站内路径，防开放重定向。
    redirect:
      typeof search.redirect === "string" && search.redirect.startsWith("/")
        ? search.redirect
        : undefined,
  }),
  head: () => ({ meta: [{ title: "Sign in — Doopoo" }] }),
  component: Login,
});

function Login() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { redirect } = Route.useSearch();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  useEffect(() => {
    try {
      const p = sessionStorage.getItem("pendingActivationEmail");
      if (p) {
        setPendingEmail(p);
        setEmail(p);
        sessionStorage.removeItem("pendingActivationEmail");
      }
    } catch {
      /* storage unavailable */
    }
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      toast.error(error.message || "登录失败");
      return;
    }
    toast.success("登录成功");
    navigate({ href: redirect ?? "/home" });
  };
  return (
    <div className="min-h-[70vh] flex items-center justify-center animate-fade-in">
      <div className="panel p-8 w-full max-w-md">
        <div className="flex justify-center mb-6">
          <Logo />
        </div>
        <h1 className="font-display text-2xl font-bold text-center mb-1">{t.auth_signin_title}</h1>
        <p className="text-sm text-text-muted text-center mb-6">{t.auth_signin_sub}</p>
        {pendingEmail && (
          <div className="mb-4 p-3 rounded-lg border border-accent/40 bg-accent-dim text-sm text-text-secondary">
            <div className="font-medium text-text-primary mb-1">请先激活账户</div>
            我们已向 <span className="text-accent">{pendingEmail}</span>{" "}
            发送了激活邮件，请前往邮箱点击链接完成激活后再登录。
          </div>
        )}
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="text-xs text-text-muted">{t.common_email}</label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              required
              className="mt-1 w-full px-3 py-2 rounded-lg bg-bg-elevated border border-border focus:outline-none focus:border-accent/60"
            />
          </div>
          <div>
            <label className="text-xs text-text-muted">{t.common_password}</label>
            <PasswordInput
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <div className="text-right -mt-2">
            <Link to="/forgot-password" className="text-xs text-accent hover:underline">
              忘记密码？
            </Link>
          </div>
          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full justify-center disabled:opacity-60"
          >
            {loading ? "登录中…" : t.auth_signin_btn}
          </button>
        </form>
        <div className="text-center text-sm text-text-muted mt-6">
          {t.auth_no_account}{" "}
          <Link to="/register" search={{ ref: undefined }} className="text-accent hover:underline">
            {t.auth_to_signup}
          </Link>
        </div>
      </div>
    </div>
  );
}
