import { createFileRoute } from '@tanstack/react-router'
import PageHeader from '../components/PageHeader'
import { mockUsageDaily, mockUsageByMember } from '../data/mock'
import { useLanguage } from '../i18n/LanguageContext'

export const Route = createFileRoute('/team/usage')({
  component: TeamUsage,
})

function TeamUsage() {
  const { t } = useLanguage()
  const max = Math.max(...mockUsageDaily.map((d) => d.points))
  const memberMax = Math.max(...mockUsageByMember.map((m) => m.points), 1)
  return (
    <>
      <PageHeader title={t.team_usage} subtitle={t.team_usage_sub} />

      <div className="grid lg:grid-cols-2 gap-6">
        <section className="panel p-6">
          <h3 className="font-display text-lg font-bold mb-4">{t.team_points_by_day}</h3>
          <div className="flex items-end gap-3 h-48">
            {mockUsageDaily.map((d) => (
              <div key={d.day} className="flex-1 flex flex-col items-center gap-2">
                <span className="text-[10px] text-text-muted font-mono">{d.points}</span>
                <div className="w-full rounded-t-md bg-gradient-to-t from-accent to-accent-soft" style={{ height: `${(d.points / max) * 100}%` }} />
                <span className="text-xs text-text-muted">{d.day}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="panel p-6">
          <h3 className="font-display text-lg font-bold mb-4">{t.team_points_by_member}</h3>
          <ul className="space-y-3">
            {mockUsageByMember.map((m) => (
              <li key={m.name}>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="text-text-primary">{m.name}</span>
                  <span className="font-mono text-text-secondary">{m.points}</span>
                </div>
                <div className="h-2 bg-bg-elevated rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-accent to-accent-soft" style={{ width: `${(m.points / memberMax) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  )
}
