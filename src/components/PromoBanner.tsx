import { Gift, X, Zap } from 'lucide-react'
import { useLanguage } from '../i18n/LanguageContext'

export default function PromoBanner({ onClose }: { onClose: () => void }) {
  const { t } = useLanguage()
  return (
    <div className="relative z-20 flex items-center justify-center gap-3 px-4 py-2.5
                    bg-gradient-to-r from-purple-900/40 via-bg-soft to-amber-900/30
                    border-b border-border text-sm">
      <Gift size={16} className="text-accent" />
      <span className="text-text-secondary">
        {t.promo_text}{' '}
        <span className="gradient-text font-semibold">{t.promo_bonus}</span>
      </span>
      <button className="ml-2 px-3 py-1 rounded-full text-xs font-semibold
                         bg-gradient-to-r from-fuchsia-500 to-orange-400 text-white
                         hover:opacity-90 transition">
        <span className="flex items-center gap-1"><Zap size={12} /> {t.promo_upgrade}</span>
      </button>
      <button className="px-3 py-1 rounded-full text-xs font-semibold
                         border border-accent/60 text-accent hover:bg-accent-dim transition">
        {t.promo_topup}
      </button>
      <button
        onClick={onClose}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
        aria-label={t.promo_close}
      >
        <X size={16} />
      </button>
    </div>
  )
}
