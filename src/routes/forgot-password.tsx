import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import Logo from "../components/Logo";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({ meta: [{ title: "忘记密码 — Doopoo" }] }),
  component: ForgotPassword,
});

function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    if (error) {
      toast.error(error.message || "发送失败");
      return;
    }
    setSent(true);
    toast.success("重置邮件已发送，请查收");
  };

  return (
    <div className="min-h-[70vh] flex items-center justify-center animate-fade-in">
      <div className="panel p-8 w-full max-w-md">
        <div className="flex justify-center mb-6">
          <Logo />
        </div>
        <h1 className="font-display text-2xl font-bold text-center mb-1">忘记密码</h1>
        <p className="text-sm text-text-muted text-center mb-6">
          输入你的邮箱，我们会发送一封包含重置链接的邮件。
        </p>
        {sent ? (
          <div className="space-y-4">
            <div className="p-3 rounded-lg border border-accent/40 bg-accent-dim text-sm text-text-secondary">
              已向 <span className="text-accent">{email}</span> 发送重置链接，链接 1 小时内有效。
              请前往邮箱点击链接，按提示设置新密码。
            </div>
            <button
              onClick={() => setSent(false)}
              className="w-full px-4 py-2 rounded-lg border border-border hover:border-accent/60 text-sm"
            >
              重新发送
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="text-xs text-text-muted">邮箱</label>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                required
                className="mt-1 w-full px-3 py-2 rounded-lg bg-bg-elevated border border-border focus:outline-none focus:border-accent/60"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full justify-center disabled:opacity-60"
            >
              {loading ? "发送中…" : "发送重置邮件"}
            </button>
          </form>
        )}
        <div className="text-center text-sm text-text-muted mt-6">
          想起密码了？
          <Link to="/login" search={{ redirect: undefined }} className="text-accent hover:underline">
            返回登录
          </Link>
        </div>
      </div>
    </div>
  );
}
