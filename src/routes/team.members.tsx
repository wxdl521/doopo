import { createFileRoute } from '@tanstack/react-router'
import { Plus, Mail, MoreHorizontal } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import { mockTeamMembers } from '../data/mock'
import { useLanguage } from '../i18n/LanguageContext'
import type { Translations } from '../i18n/zh'

export const Route = createFileRoute('/team/members')({
  component: TeamMembers,
})

function permList(t: Translations) {
  return [
    { perm: t.team_perm_create, admin: true, editor: true, viewer: false },
    { perm: t.team_perm_gen_script, admin: true, editor: true, viewer: false },
    { perm: t.team_perm_gen_char, admin: true, editor: true, viewer: false },
    { perm: t.team_perm_download, admin: true, editor: false, viewer: false },
    { perm: t.team_perm_screenshot, admin: true, editor: false, viewer: false },
    { perm: t.team_perm_share, admin: true, editor: 'approval' as const, viewer: false },
    { perm: t.team_perm_delete, admin: true, editor: false, viewer: false },
    { perm: t.team_perm_manage, admin: true, editor: false, viewer: false },
    { perm: t.team_perm_view_usage, admin: true, editor: false, viewer: false },
    { perm: t.team_perm_view_logs, admin: true, editor: false, viewer: false },
  ]
}

function cell(v: boolean | 'approval', label: string) {
  if (v === true) return <span className="text-emerald-500 font-semibold">✓</span>
  if (v === 'approval') return <span className="text-amber-500 text-xs">{label}</span>
  return <span className="text-text-muted">—</span>
}

const roleStyles: Record<string, string> = {
  owner: 'bg-fuchsia-500/15 text-fuchsia-500 border-fuchsia-500/30',
  admin: 'bg-accent-dim text-accent border-accent/30',
  editor: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30',
  viewer: 'bg-bg-elevated text-text-secondary border-border',
}

const statusStyles: Record<string, string> = {
  active: 'text-emerald-500',
  invited: 'text-amber-500',
  suspended: 'text-rose-500',
}

function TeamMembers() {
  const { t } = useLanguage()
  const roleLabel: Record<string, string> = {
    owner: t.team_role_owner, admin: t.team_role_admin, editor: t.team_role_editor, viewer: t.team_role_viewer,
  }
  const statusLabel: Record<string, string> = {
    active: t.common_active, invited: t.common_invited, suspended: t.common_suspended,
  }
  return (
    <>
      <PageHeader
        title={t.team_members_title}
        subtitle={t.team_members_sub}
        actions={
          <>
            <button className="btn-ghost"><Mail size={14} /> {t.team_bulk_invite}</button>
            <button className="btn-primary"><Plus size={14} /> {t.team_invite}</button>
          </>
        }
      />

      <section className="panel overflow-hidden mb-8">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-bg-elevated/60 text-text-muted">
              <tr>
                <th className="text-left px-4 py-3 font-medium">{t.common_name}</th>
                <th className="text-left px-4 py-3 font-medium">{t.team_col_role}</th>
                <th className="text-left px-4 py-3 font-medium">{t.common_status}</th>
                <th className="text-left px-4 py-3 font-medium">{t.team_col_joined}</th>
                <th className="text-left px-4 py-3 font-medium">{t.team_col_last_active}</th>
                <th className="text-right px-4 py-3 font-medium">{t.team_col_points}</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {mockTeamMembers.map((m) => (
                <tr key={m.id} className="border-t border-border hover:bg-bg-elevated/40">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-text-primary">{m.name}</div>
                    <div className="text-xs text-text-muted">{m.email}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs border ${roleStyles[m.role]}`}>{roleLabel[m.role]}</span>
                  </td>
                  <td className={`px-4 py-3 ${statusStyles[m.status]}`}>{statusLabel[m.status]}</td>
                  <td className="px-4 py-3 text-text-secondary">{m.joined}</td>
                  <td className="px-4 py-3 text-text-secondary">{m.lastActive}</td>
                  <td className="px-4 py-3 text-right font-mono">{m.pointsUsed}</td>
                  <td className="px-2"><button className="text-text-muted hover:text-accent"><MoreHorizontal size={16} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel p-6">
        <h3 className="font-display text-lg font-bold mb-4">{t.team_role_matrix}</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-text-muted">
              <tr>
                <th className="text-left px-3 py-2 font-medium">{t.team_col_role}</th>
                <th className="px-3 py-2 font-medium">{t.team_role_admin}</th>
                <th className="px-3 py-2 font-medium">{t.team_role_editor}</th>
                <th className="px-3 py-2 font-medium">{t.team_role_viewer}</th>
              </tr>
            </thead>
            <tbody>
              {permList(t).map((p) => (
                <tr key={p.perm} className="border-t border-border">
                  <td className="px-3 py-2">{p.perm}</td>
                  <td className="px-3 py-2 text-center">{cell(p.admin, t.team_perm_approval)}</td>
                  <td className="px-3 py-2 text-center">{cell(p.editor, t.team_perm_approval)}</td>
                  <td className="px-3 py-2 text-center">{cell(p.viewer, t.team_perm_approval)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-xs text-text-muted">{t.team_watermark_note}</p>
      </section>
    </>
  )
}
