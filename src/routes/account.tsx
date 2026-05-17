import { createFileRoute, Outlet } from '@tanstack/react-router'
import { User, CreditCard, FolderOpen, Award, Bell } from 'lucide-react'
import SectionSidebar from '../components/SectionSidebar'
import { useLanguage } from '../i18n/LanguageContext'

export const Route = createFileRoute('/account')({
  head: () => ({ meta: [{ title: 'Account — Doopoo' }] }),
  component: AccountLayout,
})

function AccountLayout() {
  const { t } = useLanguage()
  const items = [
    { to: '/account', label: t.account_overview, icon: User },
    { to: '/account/subscription', label: t.account_subscription, icon: CreditCard },
    { to: '/account/assets', label: t.account_assets, icon: FolderOpen },
    { to: '/account/rewards', label: t.account_rewards, icon: Award },
    { to: '/account/notifications', label: t.account_notifications, icon: Bell },
  ]
  return (
    <div className="animate-fade-in flex flex-col md:flex-row gap-6">
      <SectionSidebar title={t.account_title} items={items} />
      <div className="flex-1 min-w-0">
        <Outlet />
      </div>
    </div>
  )
}
