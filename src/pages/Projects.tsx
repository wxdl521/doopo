import { Filter, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { NewProjectCard, ProjectCard, type ProjectMeta } from '../components/ProjectCard'
import { useLanguage } from '../i18n/LanguageContext'

const all: ProjectMeta[] = [
  { id: '1', title: 'Lighthouse Reverie', thumbnail: 'from-indigo-700 via-violet-800 to-slate-950', status: 'rendering', updated: '2 min ago' },
  { id: '2', title: 'Founder Story Pitch', thumbnail: 'from-amber-500 via-rose-700 to-zinc-950', status: 'ready', updated: 'yesterday' },
  { id: '3', title: 'Cyberpunk Cafe MV', thumbnail: 'from-fuchsia-600 via-purple-800 to-indigo-950', status: 'draft', updated: '3 days ago' },
  { id: '4', title: 'Mountain Cabin Ad', thumbnail: 'from-emerald-600 via-teal-800 to-slate-950', status: 'ready', updated: 'last week' },
  { id: '5', title: 'Aurora Lullaby', thumbnail: 'from-sky-500 via-indigo-600 to-violet-900', status: 'draft', updated: 'last week' },
  { id: '6', title: 'Robot Origin Doc', thumbnail: 'from-amber-500 via-orange-700 to-zinc-900', status: 'ready', updated: '2 weeks ago' },
  { id: '7', title: 'Kelp Forest Promo', thumbnail: 'from-teal-500 via-cyan-700 to-slate-900', status: 'rendering', updated: '3 weeks ago' },
  { id: '8', title: 'Late Night Train', thumbnail: 'from-rose-700 via-blue-800 to-indigo-950', status: 'draft', updated: 'last month' },
]

const TAB_KEYS = ['All', 'Rendering', 'Drafts', 'Ready'] as const
type TabKey = typeof TAB_KEYS[number]

export default function Projects() {
  const { t } = useLanguage()
  const tabLabels: Record<TabKey, string> = {
    All: t.projects_tab_all,
    Rendering: t.projects_tab_rendering,
    Drafts: t.projects_tab_drafts,
    Ready: t.projects_tab_ready,
  }
  const [tab, setTab] = useState<TabKey>('All')
  const [q, setQ] = useState('')

  const list = useMemo(() => {
    return all.filter((p) => {
      if (tab === 'Rendering' && p.status !== 'rendering') return false
      if (tab === 'Drafts' && p.status !== 'draft') return false
      if (tab === 'Ready' && p.status !== 'ready') return false
      if (q && !p.title.toLowerCase().includes(q.toLowerCase())) return false
      return true
    })
  }, [tab, q])

  return (
    <div className="animate-fade-in">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-6">
        <div>
          <h1 className="font-display text-3xl md:text-4xl font-bold">{t.projects_title}</h1>
          <p className="text-text-secondary mt-1">{t.projects_subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t.projects_search}
              className="pl-9 pr-3 py-2 rounded-full bg-bg-elevated border border-border
                         text-sm text-text-primary placeholder:text-text-muted
                         focus:outline-none focus:border-accent/60 focus:shadow-glow w-56"
            />
          </div>
          <button className="btn-ghost"><Filter size={14} /> {t.projects_filter}</button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-6">
        {TAB_KEYS.map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`chip ${tab === k ? 'chip-active' : ''}`}
          >
            {tabLabels[k]}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
        <NewProjectCard />
        {list.map((p) => (
          <ProjectCard key={p.id} project={p} />
        ))}
      </div>
    </div>
  )
}
