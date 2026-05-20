import { Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useServerFn } from '@tanstack/react-start'
import HeroPromptInput from '../components/HeroPromptInput'
import QuickActionChips from '../components/QuickActionChips'
import { NewProjectCard, ProjectCard, type ProjectMeta } from '../components/ProjectCard'
import ShowcaseGrid from '../components/ShowcaseGrid'
import { useLanguage } from '../i18n/LanguageContext'
import CommunityCard, { type CommunityCardItem } from '../components/community/CommunityCard'
import { listCommunityPosts } from '../lib/community.functions'

const recent: ProjectMeta[] = [
  {
    id: '1',
    title: 'Lighthouse Reverie',
    thumbnail: 'from-indigo-700 via-violet-800 to-slate-950',
    status: 'rendering',
    updated: '2 min ago',
  },
  {
    id: '2',
    title: 'Founder Story Pitch',
    thumbnail: 'from-amber-500 via-rose-700 to-zinc-950',
    status: 'ready',
    updated: 'yesterday',
  },
  {
    id: '3',
    title: 'Cyberpunk Cafe MV',
    thumbnail: 'from-fuchsia-600 via-purple-800 to-indigo-950',
    status: 'draft',
    updated: '3 days ago',
  },
]

export default function Home() {
  const { t } = useLanguage()
  const list = useServerFn(listCommunityPosts)
  const [community, setCommunity] = useState<CommunityCardItem[]>([])
  useEffect(() => {
    list({ data: { sort: 'hot', limit: 6 } })
      .then((d) => setCommunity(d as CommunityCardItem[]))
      .catch(() => {})
  }, [list])

  return (
    <div className="space-y-16 animate-fade-in">
      {/* Hero */}
      <section className="pt-6">
        <div className="text-center mb-8 space-y-3">
          <h1 className="font-display text-4xl md:text-5xl font-bold tracking-tight">
            {t.hero_title_line1}{' '}
            <span className="gradient-text">{t.hero_title_line2}</span>
          </h1>
          <p className="text-text-secondary max-w-2xl mx-auto">
            {t.hero_subtitle}
          </p>
        </div>

        <div className="max-w-4xl mx-auto">
          <HeroPromptInput />
          <div className="mt-6">
            <QuickActionChips />
          </div>
        </div>
      </section>

      {/* Recent Projects */}
      <section>
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-display text-2xl font-bold">{t.home_recent_projects}</h2>
          <Link to="/projects" className="text-sm text-accent hover:underline">
            {t.home_view_all}
          </Link>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          <NewProjectCard />
          {recent.map((p) => (
            <ProjectCard key={p.id} project={p} />
          ))}
        </div>
      </section>

      {/* Showcase */}
      <section>
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-display text-2xl font-bold">社区精选</h2>
          <Link to="/community" className="text-sm text-accent hover:underline">查看全部</Link>
        </div>
        {community.length === 0 ? (
          <div className="panel p-8 text-center text-text-muted text-sm">
            还没有社区作品。前往
            <Link to="/scripts" className="text-accent mx-1">剧本库</Link>
            分享你的第一个作品。
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 mb-12">
            {community.map((it) => <CommunityCard key={it.id} item={it} />)}
          </div>
        )}

        <div className="flex items-center justify-between mb-5">
          <h2 className="font-display text-2xl font-bold">{t.home_showcase}</h2>
          <Link to="/showcase" className="text-sm text-accent hover:underline">
            {t.home_explore}
          </Link>
        </div>
        <ShowcaseGrid initial="Featured" limit={6} />
      </section>
    </div>
  )
}
