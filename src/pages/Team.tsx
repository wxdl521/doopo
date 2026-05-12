import { Link, Outlet, useLocation } from '@tanstack/react-router'
import { Users, ClipboardList, ShieldCheck } from 'lucide-react'
import { useLanguage } from '../i18n/LanguageContext'

export default function TeamLayout() {
  const { lang } = useLanguage()
  const zh = lang === 'zh'
  const loc = useLocation()

  const tabs = [
    { to: '/team',           label: zh ? '成员与权限' : 'Members',   icon: Users,         end: true },
    { to: '/team/approvals', label: zh ? '资产审批'   : 'Approvals', icon: ShieldCheck },
    { to: '/team/logs',      label: zh ? '操作日志'   : 'Audit logs',icon: ClipboardList },
  ]

  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <h1 className="font-display text-3xl md:text-4xl font-bold">{zh ? '团队工作区' : 'Team workspace'}</h1>
        <p className="text-text-secondary mt-1 max-w-2xl">{zh ? '集中管理成员、权限、资产审批与操作审计。' : 'Centralized members, permissions, approvals and audit.'}</p>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-border pb-px">
        {tabs.map(t => {
          const Icon = t.icon
          const active = t.end ? loc.pathname === t.to : loc.pathname.startsWith(t.to)
          return (
            <Link
              key={t.to}
              to={t.to}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-t-lg text-sm transition border-b-2 -mb-px ${
                active
                  ? 'border-accent text-accent bg-accent-dim'
                  : 'border-transparent text-text-secondary hover:text-text-primary'
              }`}
            >
              <Icon size={14} /> {t.label}
            </Link>
          )
        })}
      </div>

      <Outlet />
    </div>
  )
}