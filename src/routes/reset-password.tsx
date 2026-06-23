import { createFileRoute, useNavigate, Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import Logo from '../components/Logo'
import { supabase } from '@/integrations/supabase/client'
import { toast } from 'sonner'

export const Route = createFileRoute('/reset-password')({
  head: () => ({ meta: [{ title: '重置密码 — Doopoo' }] }),
  component: ResetPassword,
})

function ResetPassword() {
  const navigate = useNavigate()
  const [ready, setReady] = useState(false)
  const [recovery, setRecovery] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    // Supabase puts type=recovery in the URL hash on email link click.
    const hash = typeof window !== 'undefined' ? window.location.hash : ''
    const isRecovery = hash.includes('type=recovery')
    setRecovery(isRecovery)

    // Listen for PASSWORD_RECOVERY event to know session is ready.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') setReady(true)
    })
    // Also resolve current session in case event already fired
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password.length < 6) { toast.error('密码至少 6 位'); return }
    if (password !== confirm) { toast.error('两次输入的密码不一致'); return }
    setLoading(true)
    const { data: userRes } = await supabase.auth.getUser()
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      setLoading(false)
      toast.error(error.message || '重置失败')
      return
    }
    if (userRes.user) {
      await supabase.from('password_audit_log').insert({
        user_id: userRes.user.id,
        action: 'reset_completed',
        user_agent: navigator.userAgent,
        metadata: { via: 'email_link' },
      })
    }
    setLoading(false)
    toast.success('密码已重置，请使用新密码登录')
    await supabase.auth.signOut()
    navigate({ to: '/login' })
  }

  return (
    <div className="min-h-[70vh] flex items-center justify-center animate-fade-in">
      <div className="panel p-8 w-full max-w-md">
        <div className="flex justify-center mb-6"><Logo /></div>
        <h1 className="font-display text-2xl font-bold text-center mb-1">设置新密码</h1>
        <p className="text-sm text-text-muted text-center mb-6">
          请输入并确认你的新密码。
        </p>
        {!recovery && !ready && (
          <div className="mb-4 p-3 rounded-lg border border-warning/40 bg-warning/10 text-sm text-text-secondary">
            未检测到有效的重置链接。请回到邮件，点击其中的链接打开本页面。
          </div>
        )}
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="text-xs text-text-muted">新密码</label>
            <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" required minLength={6}
              className="mt-1 w-full px-3 py-2 rounded-lg bg-bg-elevated border border-border focus:outline-none focus:border-accent/60" />
          </div>
          <div>
            <label className="text-xs text-text-muted">确认密码</label>
            <input value={confirm} onChange={(e) => setConfirm(e.target.value)} type="password" required minLength={6}
              className="mt-1 w-full px-3 py-2 rounded-lg bg-bg-elevated border border-border focus:outline-none focus:border-accent/60" />
          </div>
          <button type="submit" disabled={loading || !ready} className="btn-primary w-full justify-center disabled:opacity-60">
            {loading ? '提交中…' : '重置密码'}
          </button>
        </form>
        <div className="text-center text-sm text-text-muted mt-6">
          <Link to="/login" className="text-accent hover:underline">返回登录</Link>
        </div>
      </div>
    </div>
  )
}