import { Download, Upload, Plus, FolderOpen, Image as ImageIcon, Music2, Video, FileText } from 'lucide-react'
import { useState } from 'react'
import { useLanguage } from '../i18n/LanguageContext'

type BaseItem = {
  id: string
  title: string
  type: 'characters' | 'locations' | 'props' | 'audio' | 'storyboards'
  count: number
  gradient: string
}

const bases: BaseItem[] = [
  { id: 'cast', title: 'Recurring Cast', type: 'characters', count: 12, gradient: 'from-rose-500/40 via-fuchsia-700/30 to-zinc-900' },
  { id: 'locations', title: 'Hometown Locations', type: 'locations', count: 8, gradient: 'from-amber-500/40 via-orange-700/30 to-zinc-900' },
  { id: 'props', title: 'Sci-fi Props', type: 'props', count: 23, gradient: 'from-cyan-500/40 via-blue-700/30 to-slate-900' },
  { id: 'audio', title: 'Brand Sound Pack', type: 'audio', count: 17, gradient: 'from-purple-500/40 via-violet-700/30 to-slate-900' },
  { id: 'storyboards', title: 'Storyboard Drafts', type: 'storyboards', count: 5, gradient: 'from-emerald-500/40 via-teal-700/30 to-slate-900' },
]

const typeIcons = {
  characters: ImageIcon,
  locations: FolderOpen,
  props: ImageIcon,
  audio: Music2,
  storyboards: Video,
} as const

export default function Bases() {
  const { t } = useLanguage()
  const [filter, setFilter] = useState<'All' | BaseItem['type']>('All')
  const list = filter === 'All' ? bases : bases.filter((b) => b.type === filter)

  const typeLabels: Record<'All' | BaseItem['type'], string> = {
    All: t.bases_type_all,
    characters: t.bases_type_characters,
    locations: t.bases_type_locations,
    props: t.bases_type_props,
    audio: t.bases_type_audio,
    storyboards: t.bases_type_storyboards,
  }

  return (
    <div className="animate-fade-in">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-8">
        <div>
          <h1 className="font-display text-3xl md:text-4xl font-bold">{t.bases_title}</h1>
          <p className="text-text-secondary mt-1 max-w-xl">{t.bases_subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-ghost"><Upload size={14} /> {t.bases_import}</button>
          <button className="btn-primary"><Plus size={14} /> {t.bases_new}</button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-6">
        {(['All', 'characters', 'locations', 'props', 'audio', 'storyboards'] as const).map((k) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={`chip ${filter === k ? 'chip-active' : ''}`}
          >
            {typeLabels[k]}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        <button className="corner-frame card flex flex-col items-center justify-center
                           aspect-[16/10] hover:bg-accent-dim/30 group">
          <span className="c-tr" /><span className="c-bl" />
          <div className="w-14 h-14 rounded-full bg-bg-elevated border border-border
                          flex items-center justify-center group-hover:border-accent
                          group-hover:text-accent transition">
            <Plus size={26} />
          </div>
          <span className="mt-3 font-semibold text-text-primary">{t.bases_new}</span>
          <span className="text-xs text-text-muted mt-1">{t.bases_new_desc}</span>
        </button>

        {list.map((b) => {
          const Icon = typeIcons[b.type]
          return (
            <article key={b.id} className="card group cursor-pointer">
              <div className={`relative aspect-[16/10] bg-gradient-to-br ${b.gradient}`}>
                <div className="absolute inset-0 opacity-30 mix-blend-overlay"
                  style={{
                    backgroundImage:
                      'linear-gradient(0deg, rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px)',
                    backgroundSize: '20px 20px',
                  }} />
                <div className="absolute top-3 left-3 w-9 h-9 rounded-lg bg-black/40 backdrop-blur
                                flex items-center justify-center text-white">
                  <Icon size={18} />
                </div>
                <div className="absolute bottom-3 right-3 px-2 py-0.5 rounded-md text-[11px]
                                bg-black/50 backdrop-blur text-white/90 font-mono">
                  {b.count} {t.bases_items_suffix}
                </div>
              </div>
              <div className="px-4 py-3 flex items-center justify-between">
                <div>
                  <h4 className="font-semibold text-text-primary">{b.title}</h4>
                  <p className="text-xs text-text-muted mt-0.5">{typeLabels[b.type]}</p>
                </div>
                <button
                  onClick={(e) => e.stopPropagation()}
                  className="text-text-muted hover:text-accent transition"
                  title="Export"
                >
                  <Download size={16} />
                </button>
              </div>
            </article>
          )
        })}
      </div>

      <section className="mt-16 panel p-8">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-accent-dim flex items-center justify-center text-accent">
            <FileText size={20} />
          </div>
          <div className="flex-1">
            <h3 className="font-display text-xl font-bold">{t.bases_what_title}</h3>
            <p className="text-text-secondary mt-1 leading-relaxed">{t.bases_what_body}</p>
          </div>
        </div>
      </section>
    </div>
  )
}
