import { Bot, Film, Music, ShoppingBag } from 'lucide-react'

const actions = [
  { label: 'Story Video', icon: Film, hue: 'from-rose-500/30 to-orange-500/20' },
  { label: 'Music MV', icon: Music, hue: 'from-fuchsia-500/30 to-violet-500/20' },
  { label: 'Product Promo', icon: ShoppingBag, hue: 'from-amber-500/30 to-yellow-500/20' },
  { label: 'Digital Human Ad', icon: Bot, hue: 'from-cyan-500/30 to-blue-500/20' },
]

export default function QuickActionChips({
  onPick,
}: {
  onPick?: (label: string) => void
}) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-2.5 md:gap-3">
      {actions.map(({ label, icon: Icon, hue }) => (
        <button
          key={label}
          onClick={() => onPick?.(label)}
          className={`group relative chip overflow-hidden`}
        >
          <span
            className={`absolute inset-0 bg-gradient-to-r ${hue} opacity-0
                        group-hover:opacity-100 transition-opacity`}
          />
          <Icon size={14} className="relative text-accent/90" />
          <span className="relative">{label}</span>
        </button>
      ))}
    </div>
  )
}
