import { createFileRoute, Outlet } from '@tanstack/react-router'
import { LayoutDashboard, Users, BarChart3, ShieldCheck, ClipboardList } from 'lucide-react'
import SectionSidebar from '../components/SectionSidebar'
import { useLanguage } from '../i18n/LanguageContext'

export const Route = createFileRoute('/team')({
  head: () => ({ meta: [{ title: 'Team — Doopoo' }, { name: 'description', content: 'Team workspace: members, usage, approvals, audit logs.' }] }),
  component: TeamLayout,
})

function TeamLayout() {
  const { t } = useLanguage()
  const items = [
    { to: '/team', label: t.team_overview, icon: LayoutDashboard },
    { to: '/team/members', label: t.team_members, icon: Users },
    { to: '/team/usage', label: t.team_usage, icon: BarChart3 },
    { to: '/team/approvals', label: t.team_approvals, icon: ShieldCheck },
    { to: '/team/logs', label: t.team_audit_log, icon: ClipboardList },
  ]
  return (
    <div className="animate-fade-in flex flex-col md:flex-row gap-6">
      <SectionSidebar title={t.team_center} items={items} />
      <div className="flex-1 min-w-0">
        <Outlet />
      </div>
    </div>
  )
}
