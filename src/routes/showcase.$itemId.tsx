import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { ArrowLeft, Heart, Share2 } from 'lucide-react'
import { useState } from 'react'
import { mockShowcaseDetails, type ShowcaseDetail } from '../data/mock'
import { showcase, type ShowcaseItem } from '../data/showcase'
import { useLanguage } from '../i18n/LanguageContext'

type LoaderData = { meta: ShowcaseItem; detail: ShowcaseDetail }

export const Route = createFileRoute('/showcase/$itemId')({
  head: ({ params }) => ({ meta: [{ title: `Showcase ${params.itemId} — Doopoo` }] }),
  loader: ({ params }): LoaderData => {
    const meta = showcase.find((s) => s.id === params.itemId)
    if (!meta) throw notFound()
    const detail: ShowcaseDetail = mockShowcaseDetails[params.itemId] ?? {
      id: params.itemId,
      title: meta.title,
      author: 'Community',
      description: meta.subtitle ?? 'A community Doopoo creation.',
      likes: 200,
      comments: [],
    }
    return { meta, detail }
  },
  notFoundComponent: ShowcaseNotFound,
  errorComponent: ({ error, reset }) => (
    <div className="p-10 text-center text-text-muted">{error.message}<button onClick={reset} className="ml-2 text-accent">Retry</button></div>
  ),
  component: ShowcaseDetailPage,
})

function ShowcaseNotFound() {
  const { t } = useLanguage()
  return <div className="p-10 text-center text-text-muted">{t.ui_showcase_not_found}</div>
}

function ShowcaseDetailPage() {
  const { t } = useLanguage()
  const { meta, detail } = Route.useLoaderData() as LoaderData
  const [likes, setLikes] = useState(detail.likes)
  const [liked, setLiked] = useState(false)
  return (
    <div className="animate-fade-in">
      <Link to="/showcase" className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-accent mb-4"><ArrowLeft size={14} /> {t.shd_back}</Link>
      <div className={`rounded-2xl overflow-hidden bg-gradient-to-br ${meta.gradient} aspect-video mb-6`} />
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h1 className="font-display text-3xl font-bold">{detail.title}</h1>
          <div className="text-sm text-text-muted mt-1">{t.shd_by}{detail.author} · {meta.category}{meta.duration && ` · ${meta.duration}`}</div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => { setLiked((l) => !l); setLikes((n) => n + (liked ? -1 : 1)) }} className={`btn-ghost ${liked ? '!text-rose-500' : ''}`}>
            <Heart size={14} fill={liked ? 'currentColor' : 'none'} /> {likes}
          </button>
          <button className="btn-ghost"><Share2 size={14} /> {t.shd_share}</button>
        </div>
      </div>
      <p className="text-text-secondary mb-8 max-w-3xl">{detail.description}</p>

      <h3 className="font-display font-bold mb-3">{t.shd_comments}</h3>
      <ul className="space-y-3 max-w-3xl">
        {detail.comments.length === 0 && <li className="text-sm text-text-muted">{t.shd_no_comments}</li>}
        {detail.comments.map((c) => (
          <li key={c.id} className="panel p-4">
            <div className="flex items-center justify-between text-sm"><span className="font-semibold">{c.author}</span><span className="text-xs text-text-muted">{c.ts}</span></div>
            <div className="text-sm text-text-secondary mt-1">{c.body}</div>
          </li>
        ))}
      </ul>
    </div>
  )
}
