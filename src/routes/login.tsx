import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import Logo from '../components/Logo'
import { useLanguage } from '../i18n/LanguageContext'
import { supabase } from '@/integrations/supabase/client'
import { toast } from 'sonner'

export const Route = createFileRoute('/login')({
  head: () => ({ meta: [{ title: 'Sign in — Doopoo' }] }),
  component: Login,
})

function Login() {
  const { t } = useLanguage()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (error) {
      toast.error(error.message || '登录失败')
      return
    }
    toast.success('登录成功')
    navigate({ to: '/scripts' })
  }
  return (
    <div className="min-h-[70vh] flex items-center justify-center animate-fade-in">
      <div className="panel p-8 w-full max-w-md">
        <div className="flex justify-center mb-6"><Logo /></div>
        <h1 className="font-display text-2xl font-bold text-center mb-1">{t.auth_signin_title}</h1>
        <p className="text-sm text-text-muted text-center mb-6">{t.auth_signin_sub}</p>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="text-xs text-text-muted">{t.common_email}</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required className="mt-1 w-full px-3 py-2 rounded-lg bg-bg-elevated border border-border focus:outline-none focus:border-accent/60" />
          </div>
          <div>
            <label className="text-xs text-text-muted">{t.common_password}</label>
            <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" required className="mt-1 w-full px-3 py-2 rounded-lg bg-bg-elevated border border-border focus:outline-none focus:border-accent/60" />
          </div>
          <button type="submit" disabled={loading} className="btn-primary w-full justify-center disabled:opacity-60">
            {loading ? '登录中…' : t.auth_signin_btn}
          </button>
        </form>
        <div className="text-center text-sm text-text-muted mt-6">
          {t.auth_no_account} <Link to="/register" className="text-accent hover:underline">{t.auth_to_signup}</Link>
        </div>
      </div>
    </div>
  )
}
