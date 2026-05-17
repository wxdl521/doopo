import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { ArrowLeft, Lock, Unlock, Download, Network } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import { mockCharacters, mockScripts, type CharacterItem } from '../data/mock'
import { useLanguage } from '../i18n/LanguageContext'

export const Route = createFileRoute('/characters/$characterId')({
  head: ({ params }) => ({ meta: [{ title: `Character ${params.characterId} — Doopoo` }] }),
  loader: ({ params }): CharacterItem => {
    const c = mockCharacters.find((x) => x.id === params.characterId)
    if (!c) throw notFound()
    return c
  },
  notFoundComponent: CharNotFound,
  errorComponent: ({ error, reset }) => (
    <div className="p-10 text-center text-text-muted">{error.message}<button onClick={reset} className="ml-2 text-accent">Retry</button></div>
  ),
  component: CharacterDetail,
})

function CharNotFound() {
  const { t } = useLanguage()
  return <div className="p-10 text-center text-text-muted">{t.ui_char_not_found}</div>
}

function CharacterDetail() {
  const { t } = useLanguage()
  const c = Route.useLoaderData() as CharacterItem
  const views: { key: keyof typeof c.views; label: string }[] = [
    { key: 'front', label: t.char_view_front },
    { key: 'side', label: t.char_view_side },
    { key: 'back', label: t.char_view_back },
    { key: 'expression', label: t.char_view_expression },
    { key: 'accessory', label: t.char_view_accessory },
  ]
  const bibleLabel: Record<string, string> = {
    hair: t.chd_bible_hair, eyes: t.chd_bible_eyes, outfit: t.chd_bible_outfit,
    accessory: t.chd_bible_accessory, personality: t.chd_bible_personality,
  }
  const relScripts = mockScripts.filter((s) => c.relatedScriptIds.includes(s.id))
  return (
    <div className="animate-fade-in">
      <Link to="/characters" className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-accent mb-4"><ArrowLeft size={14} /> {t.chd_back}</Link>
      <PageHeader
        title={c.name}
        subtitle={`${c.role} · ${c.style}`}
        actions={
          <>
            <Link to="/characters/relations" className="btn-ghost"><Network size={14} /> {t.chd_relations}</Link>
            <button className="btn-ghost"><Download size={14} /> {t.chd_pack}</button>
            <button className={c.locked ? 'btn-primary' : 'btn-ghost'}>
              {c.locked ? <><Lock size={14} /> {t.chd_locked}</> : <><Unlock size={14} /> {t.chd_lock}</>}
            </button>
          </>
        }
      />

      <section className="mb-8">
        <h3 className="font-display font-bold mb-3">{t.chd_turnaround}</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {views.map((v) => (
            <div key={v.key} className="card overflow-hidden">
              <div className="aspect-square" style={{ background: c.views[v.key] }} />
              <div className="px-3 py-2 text-sm font-semibold text-center">{v.label}</div>
            </div>
          ))}
        </div>
      </section>

      <div className="grid lg:grid-cols-3 gap-6">
        <section className="panel p-5 lg:col-span-2">
          <h3 className="font-display font-bold mb-3">{t.chd_bible}</h3>
          <dl className="grid sm:grid-cols-2 gap-4 text-sm">
            {Object.entries(c.bible).map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs uppercase tracking-wide text-text-muted mb-1">{bibleLabel[k] ?? k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>

          <h4 className="font-display font-bold mt-6 mb-2">{t.chd_expressions}</h4>
          <div className="flex flex-wrap gap-2">
            {c.expressions.map((e) => <span key={e} className="chip !py-1.5 !px-3 text-xs">{e}</span>)}
          </div>

          <h4 className="font-display font-bold mt-5 mb-2">{t.chd_poses}</h4>
          <div className="flex flex-wrap gap-2">
            {c.poses.map((e) => <span key={e} className="chip !py-1.5 !px-3 text-xs">{e}</span>)}
          </div>
        </section>

        <aside className="space-y-6">
          <div className="panel p-5">
            <h3 className="font-display font-bold mb-3">{t.chd_palette}</h3>
            <div className="flex gap-2">
              {c.palette.map((color) => (
                <div key={color} className="flex-1 aspect-square rounded-lg border border-border" style={{ background: color }} title={color} />
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-1 text-[10px] font-mono text-text-muted">
              {c.palette.map((cc) => <span key={cc}>{cc}</span>)}
            </div>
          </div>

          <div className="panel p-5">
            <h3 className="font-display font-bold mb-3">{t.chd_used_in}</h3>
            {relScripts.length ? (
              <ul className="space-y-2 text-sm">
                {relScripts.map((s) => (
                  <li key={s.id}>
                    <Link to="/scripts/$scriptId" params={{ scriptId: s.id }} className="text-accent hover:underline">{s.title}</Link>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-sm text-text-muted">{t.chd_no_script}</div>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}
