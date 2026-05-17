import { createFileRoute } from '@tanstack/react-router'
import { Plus, KeyRound } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import { mockAdminModels, type AdminModel } from '../data/mock'
import { useLanguage } from '../i18n/LanguageContext'

export const Route = createFileRoute('/admin/models')({
  component: AdminModels,
})

const modalityTone: Record<AdminModel['modality'], string> = {
  text: 'bg-blue-500/10 text-blue-500 border-blue-500/30',
  image: 'bg-fuchsia-500/10 text-fuchsia-500 border-fuchsia-500/30',
  video: 'bg-amber-500/10 text-amber-500 border-amber-500/30',
  audio: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30',
}

const statusTone: Record<AdminModel['status'], string> = {
  online: 'text-emerald-500',
  degraded: 'text-amber-500',
  offline: 'text-rose-500',
}

function AdminModels() {
  const { t } = useLanguage()
  const modalityLabel: Record<AdminModel['modality'], string> = {
    text: t.admin_modality_text, image: t.admin_modality_image, video: t.admin_modality_video, audio: t.admin_modality_audio,
  }
  const statusLabel: Record<AdminModel['status'], string> = {
    online: t.common_online, degraded: t.common_degraded, offline: t.common_offline,
  }
  return (
    <>
      <PageHeader
        title={t.admin_models_title}
        subtitle={t.admin_models_sub}
        actions={<button className="btn-primary"><Plus size={14} /> {t.admin_add_provider}</button>}
      />
      <section className="panel overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-bg-elevated/60 text-text-muted">
            <tr>
              <th className="text-left px-4 py-3 font-medium">{t.admin_col_model}</th>
              <th className="text-left px-4 py-3 font-medium">{t.admin_col_provider}</th>
              <th className="text-left px-4 py-3 font-medium">{t.admin_col_modality}</th>
              <th className="text-left px-4 py-3 font-medium">{t.common_status}</th>
              <th className="text-right px-4 py-3 font-medium">{t.admin_col_latency}</th>
              <th className="text-right px-4 py-3 font-medium">{t.admin_col_price}</th>
              <th className="text-left px-4 py-3 font-medium">{t.admin_col_api_key}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {mockAdminModels.map((m) => (
              <tr key={m.id} className="border-t border-border">
                <td className="px-4 py-3 font-mono text-xs">{m.name}</td>
                <td className="px-4 py-3">{m.provider}</td>
                <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs border ${modalityTone[m.modality]}`}>{modalityLabel[m.modality]}</span></td>
                <td className={`px-4 py-3 ${statusTone[m.status]}`}>{statusLabel[m.status]}</td>
                <td className="px-4 py-3 text-right font-mono">{m.status === 'offline' ? '—' : `${m.latencyMs} ms`}</td>
                <td className="px-4 py-3 text-right font-mono">${m.pricePerCall.toFixed(3)}</td>
                <td className="px-4 py-3 font-mono text-xs flex items-center gap-1"><KeyRound size={12} className="text-text-muted" /> {m.apiKeyMasked}</td>
                <td className="px-4 py-3 text-right"><button className="btn-ghost !py-1 !px-3 text-xs">{t.common_edit}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  )
}
