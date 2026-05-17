import { createFileRoute } from '@tanstack/react-router'
import { Download, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import PageHeader from '../components/PageHeader'
import { mockAuditLogs } from '../data/mock'
import { useLanguage } from '../i18n/LanguageContext'

export const Route = createFileRoute('/team/logs')({
  component: TeamLogs,
})

function TeamLogs() {
  const { t } = useLanguage()
  const [q, setQ] = useState('')
  const list = useMemo(
    () => mockAuditLogs.filter((l) => !q || `${l.actor} ${l.action} ${l.target}`.toLowerCase().includes(q.toLowerCase())),
    [q],
  )
  return (
    <>
      <PageHeader
        title={t.team_audit_log}
        subtitle={t.team_logs_sub}
        actions={<button className="btn-ghost"><Download size={14} /> {t.team_export_csv}</button>}
      />
      <div className="relative mb-4 max-w-sm">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t.team_search_logs}
          className="pl-9 pr-3 py-2 w-full rounded-full bg-bg-elevated border border-border text-sm focus:outline-none focus:border-accent/60"
        />
      </div>
      <section className="panel overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-bg-elevated/60 text-text-muted">
            <tr>
              <th className="text-left px-4 py-3 font-medium">{t.common_time}</th>
              <th className="text-left px-4 py-3 font-medium">{t.team_col_actor}</th>
              <th className="text-left px-4 py-3 font-medium">{t.team_col_action}</th>
              <th className="text-left px-4 py-3 font-medium">{t.team_col_target}</th>
              <th className="text-left px-4 py-3 font-medium">{t.team_col_ip}</th>
            </tr>
          </thead>
          <tbody>
            {list.map((l) => (
              <tr key={l.id} className="border-t border-border">
                <td className="px-4 py-3 font-mono text-xs text-text-muted">{l.ts}</td>
                <td className="px-4 py-3">{l.actor}</td>
                <td className="px-4 py-3 text-text-secondary">{l.action}</td>
                <td className="px-4 py-3">{l.target}</td>
                <td className="px-4 py-3 font-mono text-xs">{l.ip}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  )
}
