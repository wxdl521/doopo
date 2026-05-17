import { createFileRoute } from '@tanstack/react-router'
import PageHeader from '../components/PageHeader'
import StatCard from '../components/StatCard'
import { Coins, Award, FolderOpen, Bell } from 'lucide-react'
import { mockRewards, mockNotifications, mockProjectDetails } from '../data/mock'
import { useLanguage } from '../i18n/LanguageContext'

export const Route = createFileRoute('/account/')({
  component: AccountOverview,
})

function AccountOverview() {
  const { t } = useLanguage()
  const points = mockRewards.reduce((s, r) => s + r.points, 0)
  const unread = mockNotifications.filter((n) => !n.read).length
  return (
    <>
      <PageHeader title={`${t.account_hi}Lin Wu`} subtitle={t.account_owner_sub} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard icon={Coins} label={t.account_points_balance} value={points} hint={t.account_points_rollover} />
        <StatCard icon={Award} label={t.account_level} value={t.account_level_value} hint={t.account_level_to_next} tone="success" />
        <StatCard icon={FolderOpen} label={t.account_my_projects} value={mockProjectDetails.length} />
        <StatCard icon={Bell} label={t.account_unread} value={unread} tone={unread ? 'warning' : 'default'} />
      </div>
      <div className="panel p-6">
        <h3 className="font-display text-lg font-bold mb-3">{t.account_profile}</h3>
        <div className="grid sm:grid-cols-2 gap-4 text-sm">
          <div><div className="text-text-muted text-xs mb-1">{t.account_display_name}</div><div>Lin Wu</div></div>
          <div><div className="text-text-muted text-xs mb-1">{t.common_email}</div><div>lin@studio.com</div></div>
          <div><div className="text-text-muted text-xs mb-1">{t.account_workspace}</div><div>Aurora Studio</div></div>
          <div><div className="text-text-muted text-xs mb-1">{t.account_plan}</div><div>Studio</div></div>
        </div>
      </div>
    </>
  )
}
