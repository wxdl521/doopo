import { createFileRoute } from '@tanstack/react-router'
import { Users, Coins, Activity, ShieldCheck } from 'lucide-react'
import StatCard from '../components/StatCard'
import PageHeader from '../components/PageHeader'
import { mockTeamMembers, mockUsageDaily, mockApprovals } from '../data/mock'
import { useLanguage } from '../i18n/LanguageContext'

export const Route = createFileRoute('/team/')({
  component: TeamOverview,
})

function TeamOverview() {
  const { t } = useLanguage()
  const totalPoints = mockUsageDaily.reduce((s, d) => s + d.points, 0)
  const pending = mockApprovals.filter((a) => a.status === 'pending').length
  const max = Math.max(...mockUsageDaily.map((d) => d.points))
  return (
    <>
      <PageHeader title={t.team_overview_title} subtitle={t.team_overview_sub} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard icon={Users} label={t.team_active_members} value={mockTeamMembers.filter((m) => m.status === 'active').length} hint={`${mockTeamMembers.length} ${t.team_total_suffix}`} />
        <StatCard icon={Coins} label={t.team_points_7d} value={totalPoints.toLocaleString()} hint={t.team_points_window} tone="success" />
        <StatCard icon={Activity} label={t.team_renders_7d} value={mockUsageDaily.reduce((s, d) => s + d.renders, 0)} />
        <StatCard icon={ShieldCheck} label={t.team_pending_approvals} value={pending} tone={pending > 0 ? 'warning' : 'default'} />
      </div>

      <section className="panel p-6">
        <h3 className="font-display text-lg font-bold mb-4">{t.team_daily_points}</h3>
        <div className="flex items-end gap-3 h-44">
          {mockUsageDaily.map((d) => (
            <div key={d.day} className="flex-1 flex flex-col items-center gap-2">
              <div className="w-full rounded-t-md bg-gradient-to-t from-accent to-accent-soft" style={{ height: `${(d.points / max) * 100}%` }} />
              <span className="text-xs text-text-muted">{d.day}</span>
            </div>
          ))}
        </div>
      </section>
    </>
  )
}
