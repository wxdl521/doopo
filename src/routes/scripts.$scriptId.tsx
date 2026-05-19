import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { ArrowLeft, Download, GitBranch, FileText, Sparkles, Activity, Zap, MessageCircle } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import { mockScripts, type ScriptItem } from '../data/mock'
import { useLanguage } from '../i18n/LanguageContext'
import { findScript, type SavedScript } from '../lib/scriptStorage'

export const Route = createFileRoute('/scripts/$scriptId')({
  head: ({ params }) => ({ meta: [{ title: `Script ${params.scriptId} — Doopoo` }] }),
  // Loader is isomorphic; we only resolve mock items here. Local saved scripts
  // are fetched client-side after hydration.
  loader: ({ params }): ScriptItem | null => {
    return mockScripts.find((s) => s.id === params.scriptId) ?? null
  },
  notFoundComponent: ScriptNotFound,
  errorComponent: ({ error, reset }) => (
    <div className="p-10 text-center text-text-muted">
      {error.message}<button onClick={reset} className="ml-2 text-accent">Retry</button>
    </div>
  ),
  component: ScriptDetail,
})

function ScriptNotFound() {
  const { t } = useLanguage()
  return <div className="p-10 text-center text-text-muted">{t.ui_script_not_found}</div>
}

function ScriptDetail() {
  const { t } = useLanguage()
  const params = Route.useParams()
  const mock = Route.useLoaderData() as ScriptItem | null
  const [saved, setSaved] = useState<SavedScript | null>(null)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    setSaved(findScript(params.scriptId))
    setHydrated(true)
  }, [params.scriptId])

  if (!hydrated && !mock) {
    return <div className="p-10 text-center text-text-muted">…</div>
  }

  if (hydrated && saved) return <SavedScriptView s={saved} t={t} />
  if (mock) return <MockScriptView s={mock} t={t} />
  if (hydrated && !saved && !mock) {
    throw notFound()
  }
  return <div className="p-10 text-center text-text-muted">…</div>
}

// ============= Saved (structured) view =============

function SavedScriptView({ s, t }: { s: SavedScript; t: ReturnType<typeof useLanguage>['t'] }) {
  return (
    <div className="animate-fade-in">
      <Link to="/scripts" className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-accent mb-4">
        <ArrowLeft size={14} /> {t.scd_back}
      </Link>
      <PageHeader
        title={s.title}
        subtitle={s.logline || s.plot}
        actions={
          <>
            <button className="btn-ghost" disabled><Download size={14} /> {t.scd_pdf}</button>
            <button className="btn-ghost" disabled><Download size={14} /> {t.scd_json}</button>
          </>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6 text-sm">
        <Stat label={t.scd_type} value={s.type} />
        <Stat label={t.scd_genre} value={s.genre} />
        <Stat label={t.script_tone} value={s.tone} />
        <Stat label={t.scd_scenes} value={String(s.scenes?.length ?? 0)} />
      </div>

      {s.quality && (
        <div className="panel p-4 mb-6">
          <div className="flex items-center gap-2 mb-3 font-display font-bold text-sm">
            <Sparkles size={14} className="text-accent" /> {t.script_quality_title}
          </div>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <QualityBar icon={<Activity size={12} />} label={t.script_quality_pacing} value={s.quality.pacing} />
            <QualityBar icon={<Zap size={12} />} label={t.script_quality_conflict} value={s.quality.conflict} />
            <QualityBar icon={<MessageCircle size={12} />} label={t.script_quality_dialogue} value={s.quality.dialogueDensity} />
          </div>
          {s.quality.suggestions.length > 0 && (
            <div className="text-xs text-text-secondary space-y-1">
              <div className="text-text-muted">{t.script_quality_suggestions}</div>
              {s.quality.suggestions.map((sg, i) => <div key={i}>· {sg}</div>)}
            </div>
          )}
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-6">
        {(s.synopsisText || s.episodesText?.length || s.charactersText) && (
          <section className="panel p-5 lg:col-span-3 space-y-5">
            {s.synopsisText && (
              <AgentTextBlock title="📖 故事梗概 / 一句话剧情" text={s.synopsisText} />
            )}
            {s.episodesText?.map((ep) => (
              <AgentTextBlock
                key={ep.epIndex}
                title={`🎬 第 ${ep.epIndex} 集分镜脚本`}
                text={ep.text}
              />
            ))}
            {s.charactersText && (
              <AgentTextBlock title="👥 角色卡" text={s.charactersText} />
            )}
          </section>
        )}

        <section className="panel p-5 lg:col-span-2">
          <div className="flex items-center gap-2 mb-4 font-display font-bold">
            <FileText size={16} className="text-accent" /> {t.scd_scenes}
          </div>
          {!s.scenes?.length ? (
            <div className="text-text-muted text-sm">{t.scd_no_scenes}</div>
          ) : (
            <ol className="space-y-5">
              {s.scenes.map((sc) => (
                <li key={sc.index} className="border-l-2 border-accent/40 pl-4">
                  <div className="text-xs text-text-muted font-mono mb-1">SC{sc.index} · {sc.timeOfDay}</div>
                  <div className="font-semibold">{sc.slug}</div>
                  <div className="text-sm text-text-secondary mt-1 leading-relaxed">{sc.action}</div>
                  {sc.beats?.length > 0 && (
                    <ul className="mt-2 text-xs text-text-muted space-y-0.5">
                      {sc.beats.map((b, i) => <li key={i}>· {b}</li>)}
                    </ul>
                  )}
                  <div className="mt-2 space-y-1">
                    {sc.dialogue.map((d, i) => (
                      <div key={i} className="text-sm">
                        <span className="font-mono text-xs text-accent">{d.role}</span>
                        {d.parenthetical && <span className="text-xs text-text-muted ml-1">({d.parenthetical})</span>}
                        <span className="text-text-primary">：{d.line}</span>
                      </div>
                    ))}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        <aside className="panel p-5 space-y-4">
          {s.characters && s.characters.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3 font-display font-bold">
                <GitBranch size={16} className="text-accent" /> {t.script_step_characters}
              </div>
              <ul className="space-y-3">
                {s.characters.map((c, i) => (
                  <li key={i} className="border border-border rounded-lg p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-semibold text-sm">{c.name}</div>
                        <div className="text-xs text-text-muted">{c.roleLabel}</div>
                      </div>
                      <div className="flex gap-1">
                        {c.palette.map((hex, pi) => (
                          <span key={pi} className="w-3 h-3 rounded-full border border-border"
                            style={{ background: hex }} />
                        ))}
                      </div>
                    </div>
                    <div className="text-xs text-text-secondary mt-1.5">{c.motivation}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {s.acts && s.acts.length > 0 && (
            <div>
              <div className="font-display font-bold text-sm mb-2">{t.script_step_outline}</div>
              <ol className="space-y-2 text-xs">
                {s.acts.map((a, i) => (
                  <li key={i} className="border border-border rounded-lg p-2">
                    <div className="font-semibold text-text-primary">{t.script_act_label} {i + 1} · {a.title}</div>
                    <ul className="mt-1 text-text-secondary space-y-0.5">
                      {a.beats.map((b, bi) => <li key={bi}>· {b}</li>)}
                    </ul>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}

function AgentTextBlock({ title, text }: { title: string; text: string }) {
  return (
    <div>
      <div className="font-display font-bold text-sm mb-2 text-accent">{title}</div>
      <div className="whitespace-pre-wrap break-words text-sm leading-7 text-text-primary bg-bg-base/40 border border-border rounded-lg p-4 max-h-[640px] overflow-y-auto">
        {text}
      </div>
    </div>
  )
}

function QualityBar({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div>
      <div className="flex items-center gap-1 text-xs text-text-muted mb-1">
        {icon}<span>{label}</span>
        <span className="ml-auto text-text-primary font-mono">{value}</span>
      </div>
      <div className="h-1.5 rounded-full bg-bg-elevated overflow-hidden">
        <div className="h-full bg-gradient-to-r from-accent to-accent/60" style={{ width: `${value}%` }} />
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel p-3">
      <div className="text-xs text-text-muted">{label}</div>
      <div className="font-semibold capitalize">{value}</div>
    </div>
  )
}

// ============= Legacy mock view (kept for built-in demo scripts) =============

function MockScriptView({ s, t }: { s: ScriptItem; t: ReturnType<typeof useLanguage>['t'] }) {
  return (
    <div className="animate-fade-in">
      <Link to="/scripts" className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-accent mb-4"><ArrowLeft size={14} /> {t.scd_back}</Link>
      <PageHeader
        title={s.title}
        subtitle={s.summary}
        actions={
          <>
            <button className="btn-ghost"><Download size={14} /> {t.scd_pdf}</button>
            <button className="btn-ghost"><Download size={14} /> {t.scd_fountain}</button>
            <button className="btn-ghost"><Download size={14} /> {t.scd_json}</button>
          </>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-8 text-sm">
        <div className="panel p-3"><div className="text-xs text-text-muted">{t.scd_type}</div><div className="font-semibold capitalize">{s.type}</div></div>
        <div className="panel p-3"><div className="text-xs text-text-muted">{t.scd_genre}</div><div className="font-semibold">{s.genre}</div></div>
        <div className="panel p-3"><div className="text-xs text-text-muted">{t.scd_duration}</div><div className="font-semibold">{s.durationSec}s · {s.episodes} {t.scd_episode_suffix}</div></div>
        <div className="panel p-3"><div className="text-xs text-text-muted">{t.scd_dialogue_density}</div><div className="font-semibold">{s.dialogueDensity}%</div></div>
        <div className="panel p-3"><div className="text-xs text-text-muted">{t.scd_conflict_density}</div><div className="font-semibold">{s.conflictDensity}%</div></div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <section className="panel p-5 lg:col-span-2">
          <div className="flex items-center gap-2 mb-4 font-display font-bold"><FileText size={16} className="text-accent" /> {t.scd_scenes}</div>
          {s.scenes.length === 0 ? (
            <div className="text-text-muted text-sm">{t.scd_no_scenes}</div>
          ) : (
            <ol className="space-y-5">
              {s.scenes.map((sc) => (
                <li key={sc.id} className="border-l-2 border-accent/40 pl-4">
                  <div className="text-xs text-text-muted font-mono mb-1">{t.scd_scene} {sc.index} · {sc.timeOfDay}</div>
                  <div className="font-semibold">{sc.title}</div>
                  <div className="text-sm text-text-secondary mt-1 italic">{sc.action}</div>
                  <div className="mt-2 space-y-1">
                    {sc.dialogue.map((d, i) => (
                      <div key={i} className="text-sm">
                        <span className="font-mono text-xs text-accent">{d.role}: </span>
                        <span>{d.line}</span>
                      </div>
                    ))}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        <aside className="panel p-5">
          <div className="flex items-center gap-2 mb-4 font-display font-bold"><GitBranch size={16} className="text-accent" /> {t.scd_versions}</div>
          <ul className="space-y-3">
            {s.versions.map((v, i) => (
              <li key={v.id} className="border border-border rounded-lg p-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-semibold">{v.label}</span>
                  {i === 0 && <span className="text-[10px] px-2 py-0.5 rounded-full bg-accent-dim text-accent">{t.scd_latest}</span>}
                </div>
                <div className="text-xs text-text-muted mt-0.5">{v.createdAt} · {v.author}</div>
                <div className="text-xs text-text-secondary mt-1">{v.note}</div>
                <div className="mt-2 flex gap-2">
                  <button className="text-xs text-accent hover:underline">{t.scd_view}</button>
                  <button className="text-xs text-text-muted hover:text-accent">{t.scd_compare}</button>
                </div>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  )
}
