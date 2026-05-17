import { createFileRoute, Link } from '@tanstack/react-router'
import PageHeader from '../components/PageHeader'
import { useLanguage } from '../i18n/LanguageContext'

export const Route = createFileRoute('/account/subscription')({
  component: AccountSubscription,
})

const invoices = [
  { id: 'inv-2026-05', period: 'May 2026', amount: 59, status: 'paid' },
  { id: 'inv-2026-04', period: 'Apr 2026', amount: 59, status: 'paid' },
  { id: 'inv-2026-03', period: 'Mar 2026', amount: 59, status: 'paid' },
]

function AccountSubscription() {
  const { t } = useLanguage()
  return (
    <>
      <PageHeader title={t.account_subscription} subtitle={t.account_subscription_sub} />
      <section className="panel p-6 mb-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-wide text-text-muted">{t.account_current_plan}</div>
          <div className="font-display text-2xl font-bold mt-1">Studio · $59 / mo</div>
          <div className="text-sm text-text-secondary mt-1">{t.account_renews_on} 2026-06-01 · 8,400 {t.account_points_per_month}</div>
        </div>
        <div className="flex gap-2">
          <button className="btn-ghost">{t.account_cancel}</button>
          <Link to="/pricing" className="btn-primary">{t.account_upgrade}</Link>
        </div>
      </section>

      <section className="panel p-6 mb-6">
        <h3 className="font-display text-lg font-bold mb-3">{t.account_payment_method}</h3>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-7 rounded bg-gradient-to-r from-zinc-800 to-zinc-600 grid place-items-center text-white text-[10px] font-bold">VISA</div>
            <div className="text-sm">**** 4242 · {t.account_card_expires} 11/28</div>
          </div>
          <button className="btn-ghost !py-1 !px-3 text-xs">{t.account_update}</button>
        </div>
      </section>

      <section className="panel overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-bg-elevated/60 text-text-muted">
            <tr>
              <th className="text-left px-4 py-3 font-medium">{t.admin_col_invoice}</th>
              <th className="text-left px-4 py-3 font-medium">{t.common_period}</th>
              <th className="text-right px-4 py-3 font-medium">{t.common_amount}</th>
              <th className="text-left px-4 py-3 font-medium">{t.common_status}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {invoices.map((i) => (
              <tr key={i.id} className="border-t border-border">
                <td className="px-4 py-3 font-mono text-xs">{i.id}</td>
                <td className="px-4 py-3">{i.period}</td>
                <td className="px-4 py-3 text-right font-mono">${i.amount}</td>
                <td className="px-4 py-3 text-emerald-500">{t.common_paid}</td>
                <td className="px-4 py-3 text-right"><button className="text-accent text-xs hover:underline">{t.common_download}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  )
}
