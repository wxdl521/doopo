import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import PageHeader from '../components/PageHeader'
import { mockNotifications, type Notification } from '../data/mock'
import { Info, CheckCircle2, AlertTriangle } from 'lucide-react'
import { useLanguage } from '../i18n/LanguageContext'

export const Route = createFileRoute('/account/notifications')({
  component: Notifications,
})

const Icon: Record<Notification['kind'], typeof Info> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
}
const tone: Record<Notification['kind'], string> = {
  info: 'text-accent',
  success: 'text-emerald-500',
  warning: 'text-amber-500',
}

function Notifications() {
  const { t } = useLanguage()
  const [items, setItems] = useState(mockNotifications)
  const markAll = () => setItems((p) => p.map((n) => ({ ...n, read: true })))
  return (
    <>
      <PageHeader title={t.account_notifications} actions={<button onClick={markAll} className="btn-ghost">{t.account_mark_all_read}</button>} />
      <ul className="space-y-3">
        {items.map((n) => {
          const I = Icon[n.kind]
          return (
            <li key={n.id} className={`panel p-4 flex gap-3 ${n.read ? 'opacity-70' : ''}`}>
              <I className={`mt-0.5 ${tone[n.kind]}`} size={18} />
              <div className="flex-1">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-semibold">{n.title}</div>
                  <span className="text-xs text-text-muted">{n.ts}</span>
                </div>
                <div className="text-sm text-text-secondary mt-0.5">{n.body}</div>
              </div>
            </li>
          )
        })}
      </ul>
    </>
  )
}
