import { createFileRoute } from '@tanstack/react-router'
import PageHeader from '../components/PageHeader'
import StatCard from '../components/StatCard'
import { DollarSign, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { mockInvoices, type Invoice } from '../data/mock'
import { useLanguage } from '../i18n/LanguageContext'

export const Route = createFileRoute('/admin/billing')({
  component: AdminBilling,
})

const statusTone: Record<Invoice['status'], string> = {
  paid: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/30',
  pending: 'text-amber-500 bg-amber-500/10 border-amber-500/30',
  failed: 'text-rose-500 bg-rose-500/10 border-rose-500/30',
}

function AdminBilling() {
  const { t } = useLanguage()
  const total = mockInvoices.reduce((s, i) => s + i.amount, 0)
  const paid = mockInvoices.filter((i) => i.status === 'paid').reduce((s, i) => s + i.amount, 0)
  const failed = mockInvoices.filter((i) => i.status === 'failed').length
  const statusLabel: Record<Invoice['status'], string> = {
    paid: t.common_paid, pending: t.common_pending, failed: t.common_failed,
  }
  return (
    <>
      <PageHeader title={t.admin_billing_title} subtitle={t.admin_billing_sub} />
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        <StatCard icon={DollarSign} label={t.admin_billed} value={`$${total.toLocaleString()}`} />
        <StatCard icon={CheckCircle2} label={t.admin_collected} value={`$${paid.toLocaleString()}`} tone="success" />
        <StatCard icon={AlertTriangle} label={t.admin_failed} value={failed} tone={failed ? 'danger' : 'default'} />
      </div>
      <section className="panel overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-bg-elevated/60 text-text-muted">
            <tr>
              <th className="text-left px-4 py-3 font-medium">{t.admin_col_invoice}</th>
              <th className="text-left px-4 py-3 font-medium">{t.admin_col_tenant}</th>
              <th className="text-left px-4 py-3 font-medium">{t.common_period}</th>
              <th className="text-right px-4 py-3 font-medium">{t.common_amount}</th>
              <th className="text-left px-4 py-3 font-medium">{t.common_status}</th>
            </tr>
          </thead>
          <tbody>
            {mockInvoices.map((i) => (
              <tr key={i.id} className="border-t border-border">
                <td className="px-4 py-3 font-mono text-xs">{i.id}</td>
                <td className="px-4 py-3">{i.tenant}</td>
                <td className="px-4 py-3 text-text-muted">{i.period}</td>
                <td className="px-4 py-3 text-right font-mono">${i.amount.toLocaleString()}</td>
                <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs border ${statusTone[i.status]}`}>{statusLabel[i.status]}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  )
}
