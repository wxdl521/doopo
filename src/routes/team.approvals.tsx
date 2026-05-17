import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import PageHeader from '../components/PageHeader'
import { mockApprovals, type ApprovalRequest } from '../data/mock'
import { useLanguage } from '../i18n/LanguageContext'

export const Route = createFileRoute('/team/approvals')({
  component: TeamApprovals,
})

const tones: Record<ApprovalRequest['status'], string> = {
  pending: 'text-amber-500 bg-amber-500/10 border-amber-500/30',
  approved: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/30',
  rejected: 'text-rose-500 bg-rose-500/10 border-rose-500/30',
}

function TeamApprovals() {
  const { t } = useLanguage()
  const [items, setItems] = useState(mockApprovals)
  const [filter, setFilter] = useState<'all' | ApprovalRequest['status']>('all')
  const list = filter === 'all' ? items : items.filter((i) => i.status === filter)

  const decide = (id: string, status: 'approved' | 'rejected') =>
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, status } : i)))

  const filterLabel: Record<string, string> = {
    all: t.common_all,
    pending: t.common_pending,
    approved: t.common_approved,
    rejected: t.common_rejected,
  }
  const typeLabel: Record<ApprovalRequest['type'], string> = {
    export: t.team_approval_type_export,
    share: t.team_approval_type_share,
    delete: t.team_approval_type_delete,
  }
  const statusLabel: Record<ApprovalRequest['status'], string> = {
    pending: t.common_pending, approved: t.common_approved, rejected: t.common_rejected,
  }

  return (
    <>
      <PageHeader title={t.team_approvals} subtitle={t.team_approvals_sub} />
      <div className="flex gap-2 mb-4">
        {(['all', 'pending', 'approved', 'rejected'] as const).map((s) => (
          <button key={s} onClick={() => setFilter(s)} className={`chip ${filter === s ? 'chip-active' : ''}`}>{filterLabel[s]}</button>
        ))}
      </div>
      <section className="panel overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-bg-elevated/60 text-text-muted">
            <tr>
              <th className="text-left px-4 py-3 font-medium">{t.team_col_requester}</th>
              <th className="text-left px-4 py-3 font-medium">{t.common_type}</th>
              <th className="text-left px-4 py-3 font-medium">{t.team_col_target}</th>
              <th className="text-left px-4 py-3 font-medium">{t.team_col_requested}</th>
              <th className="text-left px-4 py-3 font-medium">{t.common_status}</th>
              <th className="text-right px-4 py-3 font-medium">{t.common_actions}</th>
            </tr>
          </thead>
          <tbody>
            {list.map((a) => (
              <tr key={a.id} className="border-t border-border">
                <td className="px-4 py-3 text-text-primary">{a.requester}</td>
                <td className="px-4 py-3 text-text-secondary">{typeLabel[a.type]}</td>
                <td className="px-4 py-3">{a.target}</td>
                <td className="px-4 py-3 text-text-muted">{a.requestedAt}</td>
                <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs border ${tones[a.status]}`}>{statusLabel[a.status]}</span></td>
                <td className="px-4 py-3 text-right">
                  {a.status === 'pending' ? (
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => decide(a.id, 'rejected')} className="btn-ghost !py-1 !px-3 text-xs">{t.team_reject}</button>
                      <button onClick={() => decide(a.id, 'approved')} className="btn-primary !py-1 !px-3 text-xs">{t.team_approve}</button>
                    </div>
                  ) : (
                    <span className="text-text-muted text-xs">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  )
}
