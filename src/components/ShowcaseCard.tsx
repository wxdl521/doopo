import { Heart, Play } from 'lucide-react'
import type { ShowcaseItem } from '../data/showcase'

export default function ShowcaseCard({ item }: { item: ShowcaseItem }) {
  return (
    <article className="card group cursor-pointer">
      <div className={`relative aspect-[16/10] bg-gradient-to-br ${item.gradient} overflow-hidden`}>
        {/* Decorative grid texture */}
        <div className="absolute inset-0 opacity-30 mix-blend-overlay"
             style={{
               backgroundImage:
                 'linear-gradient(0deg, rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px)',
               backgroundSize: '24px 24px',
             }} />
        {/* Subtle vignette */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />

        {/* Title overlay */}
        <div className="absolute inset-0 flex flex-col justify-between p-4">
          <div className="flex items-center justify-between">
            {item.badge && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider
                               bg-accent text-bg shadow-glow">
                {item.badge}
              </span>
            )}
            {item.duration && (
              <span className="ml-auto px-2 py-0.5 rounded-md text-[11px] font-mono
                               bg-black/50 backdrop-blur text-white/90">
                {item.duration}
              </span>
            )}
          </div>

          <div>
            <h3 className="font-display text-xl md:text-2xl font-bold text-white drop-shadow">
              {item.title}
            </h3>
            {item.subtitle && (
              <p className="text-sm text-white/80 mt-1 line-clamp-2">{item.subtitle}</p>
            )}
          </div>
        </div>

        {/* Play overlay on hover */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0
                        group-hover:opacity-100 transition-opacity bg-black/40 backdrop-blur-sm">
          <div className="w-14 h-14 rounded-full bg-accent text-bg flex items-center justify-center
                          shadow-glow-lg animate-pulse-glow">
            <Play size={22} fill="currentColor" />
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-xs uppercase tracking-wider text-text-muted">
          {item.category}
        </span>
        <button
          onClick={(e) => e.stopPropagation()}
          className="text-text-muted hover:text-rose-400 transition"
          aria-label="Like"
        >
          <Heart size={16} />
        </button>
      </div>
    </article>
  )
}
