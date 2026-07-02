import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import Logo from "../components/Logo";
import { useLanguage } from "../i18n/LanguageContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/register")({
  head: () => ({ meta: [{ title: "Create account — Doopoo" }] }),
  component: Register,
});

function Register() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    accountType: "personal" as "personal" | "team",
  });
  const [loading, setLoading] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email: form.email,
      password: form.password,
      options: {
        emailRedirectTo: `${window.location.origin}/scripts`,
        data: { name: form.name, account_type: form.accountType },
      },
    });
    setLoading(false);
    if (error) {
      toast.error(error.message || "注册失败");
      return;
    }
    if (data.session) {
      toast.success("注册成功");
      navigate({ to: "/scripts" });
    } else {
      try {
        sessionStorage.setItem("pendingActivationEmail", form.email);
      } catch {}
      toast.success(`激活邮件已发送至 ${form.email}，请前往邮箱完成激活后再登录`, {
        duration: 6000,
      });
      navigate({ to: "/login" });
    }
  };
  const typeLabel: Record<"personal" | "team", string> = {
    personal: t.auth_account_personal,
    team: t.auth_account_team,
  };
  return (
    <div className="min-h-[70vh] flex items-center justify-center animate-fade-in">
      <div className="panel p-8 w-full max-w-md">
        <div className="flex justify-center mb-6">
          <Logo />
        </div>
        <h1 className="font-display text-2xl font-bold text-center mb-1">{t.auth_signup_title}</h1>
        <p className="text-sm text-text-muted text-center mb-6">{t.auth_signup_sub}</p>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            {(["personal", "team"] as const).map((tp) => (
              <button
                key={tp}
                type="button"
                onClick={() => setForm({ ...form, accountType: tp })}
                className={`px-3 py-2 rounded-lg border text-sm ${form.accountType === tp ? "border-accent text-accent bg-accent-dim" : "border-border text-text-secondary"}`}
              >
                {typeLabel[tp]}
              </button>
            ))}
          </div>
          <div>
            <label className="text-xs text-text-muted">
              {form.accountType === "team" ? t.auth_company_name : t.common_name}
            </label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              className="mt-1 w-full px-3 py-2 rounded-lg bg-bg-elevated border border-border focus:outline-none focus:border-accent/60"
            />
          </div>
          <div>
            <label className="text-xs text-text-muted">{t.common_email}</label>
            <input
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              type="email"
              required
              className="mt-1 w-full px-3 py-2 rounded-lg bg-bg-elevated border border-border focus:outline-none focus:border-accent/60"
            />
          </div>
          <div>
            <label className="text-xs text-text-muted">{t.common_password}</label>
            <input
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              type="password"
              required
              minLength={6}
              className="mt-1 w-full px-3 py-2 rounded-lg bg-bg-elevated border border-border focus:outline-none focus:border-accent/60"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full justify-center disabled:opacity-60"
          >
            {loading ? "注册中…" : t.auth_signup_btn}
          </button>
        </form>
        <div className="text-center text-sm text-text-muted mt-6">
          {t.auth_have_account}{" "}
          <Link to="/login" className="text-accent hover:underline">
            {t.auth_to_signin}
          </Link>
        </div>
      </div>
    </div>
  );
}
