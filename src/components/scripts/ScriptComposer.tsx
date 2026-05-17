import { useState } from 'react'
import { Loader2, Sparkles, ArrowRight, ArrowLeft, RefreshCw, Save, Trash2, Wand2, Check } from 'lucide-react'
import { useServerFn } from '@tanstack/react-start'
import { useNavigate } from '@tanstack/react-router'
import { useLanguage } from '../../i18n/LanguageContext'
import {
  genLogline,
  genOutline,
  genScenes,
  genCharacters,
  rewriteScene,
  type PipelineAct,
  type PipelineScene,
  type PipelineCharacter,
} from '../../lib/scriptPipeline.functions'
import { upsertScript, computeQuality, type SavedScript } from '../../lib/scriptStorage'

type Step = 'setup' | 'logline' | 'outline' | 'scenes' | 'characters' | 'done'

const STEPS: Step[] = ['setup', 'logline', 'outline', 'scenes', 'characters', 'done']

type Props = {
  types: { value: string; key: keyof ReturnType<typeof useLanguage>['t'] }[]
  genres: { value: string; key: keyof ReturnType<typeof useLanguage>['t'] }[]
  tones: { value: string; key: keyof ReturnType<typeof useLanguage>['t'] }[]
  models: { id: string; label: string }[]
  onSaved?: () => void
}

export default function ScriptComposer({ types, genres, tones, models, onSaved }: Props) {
  const { t, lang } = useLanguage()
  const navigate = useNavigate()
  const callLogline = useServerFn(genLogline)
  const callOutline = useServerFn(genOutline)
  const callScenes = useServerFn(genScenes)
  const callCharacters = useServerFn(genCharacters)
  const callRewriteScene = useServerFn(rewriteScene)

  // Setup
  const [step, setStep] = useState<Step>('setup')
  const [type, setType] = useState('Short')
  const [genre, setGenre] = useState('Drama')
  const [tone, setTone] = useState('Serious')
  const [model, setModel] = useState(models[0].id)
  const [theme, setTheme] = useState('')
  const [plot, setPlot] = useState('')
  const [sceneCount, setSceneCount] = useState(5)

  // Pipeline state
  const [logline, setLogline] = useState('')
  const [premise, setPremise] = useState('')
  const [themes, setThemes] = useState<string[]>([])
  const [acts, setActs] = useState<PipelineAct[]>([])
  const [scenes, setScenes] = useState<PipelineScene[]>([])
  const [characters, setCharacters] = useState<PipelineCharacter[]>([])

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rewriteFor, setRewriteFor] = useState<number | null>(null)
  const [rewriteInstr, setRewriteInstr] = useState('')

  const errMsg = (e: string) => {
    if (e === 'rate_limit') return t.script_pipeline_rate_limit
    if (e === 'no_credits') return t.script_pipeline_no_credits
    return `${t.script_pipeline_failed}: ${e}`
  }

  const runLogline = async () => {
    if (!theme.trim() || !plot.trim()) return
    setLoading(true); setError(null)
    const res = await callLogline({
      data: { lang, type: type as 'Short', genre, tone, theme, plot, model },
    })
    setLoading(false)
    if (!res.ok) return setError(errMsg(res.error))
    setLogline(res.data.logline)
    setPremise(res.data.premise)
    setThemes(res.data.themes || [])
    setStep('logline')
  }

  const runOutline = async () => {
    setLoading(true); setError(null)
    const res = await callOutline({
      data: { lang, type: type as 'Short', genre, tone, logline, premise, model },
    })
    setLoading(false)
    if (!res.ok) return setError(errMsg(res.error))
    setActs(res.data.acts)
    setStep('outline')
  }

  const runScenes = async () => {
    setLoading(true); setError(null)
    const res = await callScenes({
      data: {
        lang,
        type: type as 'Short',
        genre,
        tone,
        logline,
        acts,
        sceneCount,
        knownCharacters: characters.map((c) => c.name),
        model,
      },
    })
    setLoading(false)
    if (!res.ok) return setError(errMsg(res.error))
    setScenes(res.data.scenes.map((s: PipelineScene, i: number) => ({ ...s, index: i + 1 })))
    setStep('scenes')
  }

  const runCharacters = async () => {
    setLoading(true); setError(null)
    const res = await callCharacters({
      data: { lang, logline, scenes, model },
    })
    setLoading(false)
    if (!res.ok) return setError(errMsg(res.error))
    setCharacters(res.data.characters)
    setStep('characters')
  }

  const runRewrite = async (idx: number) => {
    if (!rewriteInstr.trim()) return
    const scene = scenes[idx]
    setLoading(true); setError(null)
    const res = await callRewriteScene({
      data: { lang, scene, instruction: rewriteInstr, model },
    })
    setLoading(false)
    if (!res.ok) return setError(errMsg(res.error))
    setScenes((prev) => prev.map((s, i) => (i === idx ? { ...res.data.scene, index: s.index } : s)))
    setRewriteFor(null)
    setRewriteInstr('')
  }

  const deleteScene = (idx: number) => {
    setScenes((prev) => prev.filter((_, i) => i !== idx).map((s, i) => ({ ...s, index: i + 1 })))
  }

  const finalize = () => {
    const id = `scr-${Date.now()}`
    const item: SavedScript = {
      id,
      title: theme || logline.slice(0, 30) || 'Untitled',
      plot,
      type,
      genre,
      tone,
      model,
      logline,
      premise,
      themes,
      acts,
      scenes,
      characters,
      quality: computeQuality(scenes),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    upsertScript(item)
    onSaved?.()
    setStep('done')
    return id
  }

  const reset = () => {
    setStep('setup')
    setLogline(''); setPremise(''); setThemes([])
    setActs([]); setScenes([]); setCharacters([])
    setError(null)
  }

  // ============= Stepper =============
  const stepLabels: Record<Step, string> = {
    setup: t.script_step_setup,
    logline: t.script_step_logline,
    outline: t.script_step_outline,
    scenes: t.script_step_scenes,
    characters: t.script_step_characters,
    done: t.script_step_review,
  }
  const stepIdx = STEPS.indexOf(step)

  return (
    <div className="panel p-6 space-y-5">
      <h2 className="font-semibold text-text-primary flex items-center gap-2">
        <Sparkles size={16} className="text-accent" />
        {t.scripts_create_new}
        <span className="text-xs text-text-muted ml-2">{t.script_pipeline_mode}</span>
      </h2>

      {/* Stepper */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {STEPS.map((s, i) => {
          const done = i < stepIdx
          const active = i === stepIdx
          return (
            <div key={s} className="flex items-center gap-1 flex-shrink-0">
              <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs ${
                active ? 'bg-accent text-bg-base font-medium'
                  : done ? 'bg-accent-dim text-accent' : 'bg-bg-elevated text-text-muted'
              }`}>
                {done ? <Check size={11} /> : <span className="font-mono">{i + 1}</span>}
                <span>{stepLabels[s]}</span>
              </div>
              {i < STEPS.length - 1 && <ArrowRight size={11} className="text-text-muted" />}
            </div>
          )
        })}
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 text-red-300 text-sm px-3 py-2">{error}</div>
      )}

      {/* Step body */}
      {step === 'setup' && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <SelectField label={t.script_type} value={type} onChange={setType}
              options={types.map((x) => ({ value: x.value, label: t[x.key] as string }))} />
            <SelectField label={t.script_genre} value={genre} onChange={setGenre}
              options={genres.map((x) => ({ value: x.value, label: t[x.key] as string }))} />
            <SelectField label={t.script_tone} value={tone} onChange={setTone}
              options={tones.map((x) => ({ value: x.value, label: t[x.key] as string }))} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <SelectField label={t.script_model} value={model} onChange={setModel}
              options={models.map((m) => ({ value: m.id, label: m.label }))} />
            <div>
              <label className="text-xs text-text-muted mb-1 block">{t.script_scene_count}</label>
              <input type="number" min={3} max={10} value={sceneCount}
                onChange={(e) => setSceneCount(Math.max(3, Math.min(10, Number(e.target.value) || 5)))}
                className="w-full rounded-lg bg-bg-elevated border border-border text-sm text-text-primary px-3 py-2 focus:outline-none focus:border-accent/50" />
            </div>
          </div>
          <Field label={t.script_theme}>
            <input value={theme} onChange={(e) => setTheme(e.target.value)}
              placeholder={t.script_theme_hint}
              className="w-full rounded-lg bg-bg-elevated border border-border text-sm text-text-primary px-3 py-2 focus:outline-none focus:border-accent/50 placeholder:text-text-muted" />
          </Field>
          <Field label={t.script_plot}>
            <textarea value={plot} onChange={(e) => setPlot(e.target.value)} rows={3}
              placeholder={t.script_plot_hint}
              className="w-full rounded-lg bg-bg-elevated border border-border text-sm text-text-primary p-3 resize-none focus:outline-none focus:border-accent/50 placeholder:text-text-muted" />
          </Field>
          <button onClick={runLogline} disabled={loading || !theme.trim() || !plot.trim()}
            className="w-full btn-primary justify-center disabled:opacity-40">
            {loading ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
            {t.script_step_next} · {stepLabels.logline}
          </button>
        </div>
      )}

      {step === 'logline' && (
        <div className="space-y-3">
          <Field label="Logline">
            <textarea value={logline} onChange={(e) => setLogline(e.target.value)} rows={2}
              className="w-full rounded-lg bg-bg-elevated border border-border text-sm text-text-primary p-3 resize-none focus:outline-none focus:border-accent/50" />
          </Field>
          <Field label={t.script_premise_label}>
            <textarea value={premise} onChange={(e) => setPremise(e.target.value)} rows={3}
              className="w-full rounded-lg bg-bg-elevated border border-border text-sm text-text-primary p-3 resize-none focus:outline-none focus:border-accent/50" />
          </Field>
          {themes.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {themes.map((th, i) => (
                <span key={i} className="chip text-xs">{th}</span>
              ))}
            </div>
          )}
          <StepNav loading={loading} onPrev={() => setStep('setup')}
            onRegen={runLogline} onNext={runOutline} nextLabel={stepLabels.outline} t={t} />
        </div>
      )}

      {step === 'outline' && (
        <div className="space-y-3">
          {acts.map((a, ai) => (
            <div key={ai} className="rounded-lg border border-border bg-bg-elevated/40 p-3 space-y-2">
              <input value={a.title} onChange={(e) => {
                const next = [...acts]; next[ai] = { ...a, title: e.target.value }; setActs(next)
              }} className="w-full bg-transparent font-semibold text-sm text-text-primary focus:outline-none" />
              <ul className="space-y-1">
                {a.beats.map((b, bi) => (
                  <li key={bi} className="flex items-start gap-2 text-sm">
                    <span className="text-text-muted mt-1">·</span>
                    <input value={b} onChange={(e) => {
                      const next = [...acts]; const beats = [...a.beats]
                      beats[bi] = e.target.value; next[ai] = { ...a, beats }
                      setActs(next)
                    }} className="flex-1 bg-transparent text-text-secondary focus:outline-none border-b border-transparent focus:border-border" />
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <StepNav loading={loading} onPrev={() => setStep('logline')}
            onRegen={runOutline} onNext={runScenes} nextLabel={stepLabels.scenes} t={t} />
        </div>
      )}

      {step === 'scenes' && (
        <div className="space-y-3">
          {scenes.map((s, idx) => (
            <div key={idx} className="rounded-lg border border-border bg-bg-elevated/40 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="font-mono text-xs text-accent">SC{s.index} · {s.slug}</div>
                <div className="flex gap-1">
                  <button onClick={() => setRewriteFor(rewriteFor === idx ? null : idx)}
                    className="p-1.5 rounded hover:bg-bg-elevated text-text-muted hover:text-accent" title={t.script_scene_rewrite}>
                    <Wand2 size={13} />
                  </button>
                  <button onClick={() => deleteScene(idx)}
                    className="p-1.5 rounded hover:bg-bg-elevated text-text-muted hover:text-red-400" title={t.script_scene_delete}>
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
              <div className="text-xs text-text-muted">{t.script_scene_action}</div>
              <p className="text-sm text-text-secondary leading-relaxed">{s.action}</p>
              <div className="text-xs text-text-muted">{t.script_scene_beats}</div>
              <ul className="text-xs text-text-secondary space-y-0.5">
                {s.beats.map((b, i) => <li key={i}>· {b}</li>)}
              </ul>
              <div className="text-xs text-text-muted">{t.script_scene_dialogue}</div>
              <div className="space-y-1">
                {s.dialogue.map((d, i) => (
                  <div key={i} className="text-sm">
                    <span className="font-mono text-xs text-accent">{d.role}</span>
                    {d.parenthetical && <span className="text-xs text-text-muted ml-1">({d.parenthetical})</span>}
                    <span className="text-text-primary">：{d.line}</span>
                  </div>
                ))}
              </div>
              {rewriteFor === idx && (
                <div className="flex gap-2 pt-1">
                  <input value={rewriteInstr} onChange={(e) => setRewriteInstr(e.target.value)}
                    placeholder={t.script_scene_rewrite_hint}
                    className="flex-1 rounded-lg bg-bg-base border border-border text-sm text-text-primary px-3 py-1.5 focus:outline-none focus:border-accent/50" />
                  <button onClick={() => runRewrite(idx)} disabled={loading || !rewriteInstr.trim()}
                    className="btn-primary text-xs disabled:opacity-40">
                    {loading ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
                    {t.script_scene_rewrite_apply}
                  </button>
                </div>
              )}
            </div>
          ))}
          <StepNav loading={loading} onPrev={() => setStep('outline')}
            onRegen={runScenes} onNext={runCharacters} nextLabel={stepLabels.characters} t={t} />
        </div>
      )}

      {step === 'characters' && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {characters.map((c, i) => (
              <div key={i} className="rounded-lg border border-border bg-bg-elevated/40 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-semibold text-text-primary">{c.name}</div>
                    <div className="text-xs text-text-muted">{c.roleLabel}</div>
                  </div>
                  <div className="flex gap-1">
                    {c.palette.map((hex, pi) => (
                      <span key={pi} className="w-4 h-4 rounded-full border border-border"
                        style={{ background: hex }} title={hex} />
                    ))}
                  </div>
                </div>
                <div className="text-xs text-text-secondary"><b>外形：</b>{c.look}</div>
                <div className="text-xs text-text-secondary"><b>性格：</b>{c.personality}</div>
                <div className="text-xs text-text-secondary"><b>动机：</b>{c.motivation}</div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <button onClick={() => setStep('scenes')} className="btn-ghost text-xs">
              <ArrowLeft size={13} /> {t.script_step_prev}
            </button>
            <button onClick={runCharacters} disabled={loading} className="btn-ghost text-xs">
              {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              {t.script_step_regenerate}
            </button>
            <button onClick={() => {
              const id = finalize()
              navigate({ to: '/scripts/$scriptId', params: { scriptId: id } })
            }} className="btn-primary text-xs ml-auto">
              <Save size={13} /> {t.script_step_save}
            </button>
          </div>
        </div>
      )}

      {step === 'done' && (
        <div className="text-center py-6 space-y-3">
          <div className="text-accent text-2xl"><Check size={32} className="mx-auto" /></div>
          <p className="text-text-secondary">{t.script_saved}</p>
          <button onClick={reset} className="btn-ghost text-xs">{t.scripts_create_new}</button>
        </div>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-text-muted mb-1 block">{label}</label>
      {children}
    </div>
  )
}

function SelectField({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[]
}) {
  return (
    <div>
      <label className="text-xs text-text-muted mb-1 block">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg bg-bg-elevated border border-border text-sm text-text-primary px-3 py-2 focus:outline-none focus:border-accent/50">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}

function StepNav({ loading, onPrev, onRegen, onNext, nextLabel, t }: {
  loading: boolean; onPrev: () => void; onRegen: () => void; onNext: () => void;
  nextLabel: string; t: ReturnType<typeof useLanguage>['t']
}) {
  return (
    <div className="flex flex-wrap gap-2 pt-1">
      <button onClick={onPrev} className="btn-ghost text-xs">
        <ArrowLeft size={13} /> {t.script_step_prev}
      </button>
      <button onClick={onRegen} disabled={loading} className="btn-ghost text-xs">
        {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
        {t.script_step_regenerate}
      </button>
      <button onClick={onNext} disabled={loading} className="btn-primary text-xs ml-auto disabled:opacity-40">
        {loading ? <Loader2 size={12} className="animate-spin" /> : <ArrowRight size={12} />}
        {t.script_step_next} · {nextLabel}
      </button>
    </div>
  )
}
