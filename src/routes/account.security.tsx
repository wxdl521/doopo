import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import PageHeader from '../components/PageHeader'
import { supabase } from '@/integrations/supabase/client'
import { toast } from 'sonner'
import { ShieldCheck, KeyRound, History } from 'lucide-react'

export const Route = createFileRoute('/account/security')({
  head: () => ({ meta: [{ title: '账户安全 — Doopoo' }] }),
  component: Security,
})

type AuditRow = {
  id: string
  action: 'reset_requested' | 'reset_completed' | 'password_changed'
  created_at: string
  user_agent: string | null
  ip_address: string | null
  metadata: Record<string, unknown> | null
}

const actionLabel: Record<AuditRow['action'], string> = {
  reset_requested: '请求重置邮件',
  reset_completed: '通过邮件完成重置',
  password_changed: '修改密码',
}

function Security() {
  const [email, setEmail] = useState('')
  const [userId, setUserId] = useState<string | null>(null)
  const [oldPwd, setOldPwd] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [loading, setLoading] = useState(false)
  const [logs, setLogs] = useState<AuditRow[]>([])
  const [logsLoading, setLogsLoading] = useState(true)

  const loadLogs = async (uid: string) => {
    setLogsLoading(true)
    const { data, error } = await supabase
      .from('password_audit_log')
      .select('id, action, created_at, user_agent, ip_address, metadata')
      .eq('user_id', uid)
      .order('created_at', { ascending: false })
      .limit(20)
    setLogsLoading(false)
    if (error) {
      toast.error('加载操作日志失败')
      return
    }
    setLogs((data ?? []) as AuditRow[])
  }

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        setEmail(data.user.email ?? '')
        setUserId(data.user.id)
        loadLogs(data.user.id)
      }
    })
  }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email || !userId) {
      toast.error('请先登录')
      return
    }
    if (newPwd.length < 6) { toast.error('新密码至少 6 位'); return }
    if (newPwd !== confirmPwd) { toast.error('两次输入的新密码不一致'); return }
    if (newPwd === oldPwd) { toast.error('新密码不能与旧密码相同'); return }

    setLoading(true)
    // 1) 验证旧密码：使用旧密码重新登录一次
    const { error: verifyErr } = await supabase.auth.signInWithPassword({
      email,
      password: oldPwd,
    })
    if (verifyErr) {
      setLoading(false)
      toast.error('旧密码不正确')
      return
    }
    // 2) 更新密码
    const { error: updateErr } = await supabase.auth.updateUser({ password: newPwd })
    if (updateErr) {
      setLoading(false)
      toast.error(updateErr.message || '修改失败')
      return
    }
    // 3) 记录审计日志
    await supabase.from('password_audit_log').insert({
      user_id: userId,
      action: 'password_changed',
      user_agent: navigator.userAgent,
      metadata: { via: 'account_security_page' },
    })
    setLoading(false)
    setOldPwd(''); setNewPwd(''); setConfirmPwd('')
    toast.success('密码已更新')
    loadLogs(userId)
  }

  return (
    <>
      <PageHeader title="账户安全" subtitle="修改你的登录密码，并查看历史密码操作记录" />

      <div className="panel p-6 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <KeyRound size={18} className="text-accent" />
          <h3 className="font-display text-lg font-bold">修改密码</h3>
        </div>
        <form onSubmit={submit} className="space-y-4 max-w-md">
          <div>
            <label className="text-xs text-text-muted">当前邮箱</label>
            <input value={email} disabled
              className="mt-1 w-full px-3 py-2 rounded-lg bg-bg-elevated border border-border opacity-70" />
          </div>
          <div>
            <label className="text-xs text-text-muted">旧密码</label>
            <input value={oldPwd} onChange={(e) => setOldPwd(e.target.value)} type="password" required
              className="mt-1 w-full px-3 py-2 rounded-lg bg-bg-elevated border border-border focus:outline-none focus:border-accent/60" />
          </div>
          <div>
            <label className="text-xs text-text-muted">新密码（至少 6 位）</label>
            <input value={newPwd} onChange={(e) => setNewPwd(e.target.value)} type="password" required minLength={6}
              className="mt-1 w-full px-3 py-2 rounded-lg bg-bg-elevated border border-border focus:outline-none focus:border-accent/60" />
          </div>
          <div>
            <label className="text-xs text-text-muted">确认新密码</label>
            <input value={confirmPwd} onChange={(e) => setConfirmPwd(e.target.value)} type="password" required minLength={6}
              className="mt-1 w-full px-3 py-2 rounded-lg bg-bg-elevated border border-border focus:outline-none focus:border-accent/60" />
          </div>
          <button type="submit" disabled={loading} className="btn-primary justify-center disabled:opacity-60">
            <ShieldCheck size={16} className="mr-1" />
            {loading ? '提交中…' : '保存新密码'}
          </button>
        </form>
      </div>

      <div className="panel p-6">
        <div className="flex items-center gap-2 mb-4">
          <History size={18} className="text-accent" />
          <h3 className="font-display text-lg font-bold">密码操作日志</h3>
        </div>
        {logsLoading ? (
          <div className="text-sm text-text-muted">加载中…</div>
        ) : logs.length === 0 ? (
          <div className="text-sm text-text-muted">暂无记录</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-text-muted border-b border-border">
                  <th className="py-2 pr-4">时间</th>
                  <th className="py-2 pr-4">操作</th>
                  <th className="py-2 pr-4">客户端</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((row) => (
                  <tr key={row.id} className="border-b border-border/60">
                    <td className="py-2 pr-4 whitespace-nowrap">{new Date(row.created_at).toLocaleString()}</td>
                    <td className="py-2 pr-4">{actionLabel[row.action] ?? row.action}</td>
                    <td className="py-2 pr-4 text-text-muted truncate max-w-[360px]" title={row.user_agent ?? ''}>
                      {row.user_agent ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}