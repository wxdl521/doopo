import { createFileRoute } from '@tanstack/react-router'
import { Fragment, useState, type ReactNode } from 'react'
import { useServerFn } from '@tanstack/react-start'
import WorkspaceTopbar, { type WorkspaceTab } from '../components/workspace/WorkspaceTopbar'
import ZopiaChatPanel from '../components/workspace/ZopiaChatPanel'
import { useLanguage } from '../i18n/LanguageContext'
import {
  generateOutline, generateScript, generateCharacters, generateStoryboard, generateTimeline,
  type Outline, type GenScene, type GenCharacter, type StoryboardPanel, type TimelineData,
} from '../data/workspaceGenerators'
import { generateStageAi } from '../lib/aiGenerate.functions'
import { Maximize2, FileText, Camera, Clock, Users, X } from 'lucide-react'
import CharacterPortrait from '../components/workspace/CharacterPortrait'

export const Route = createFileRoute('/workspace/$workspaceId')({
  head: ({ params }) => ({ meta: [{ title: `Workspace ${params.workspaceId} — Doopoo` }] }),
  component: WorkspacePage,
})

type WorkspaceData = {
  outline: Outline | null
  scenes: GenScene[]
  characters: GenCharacter[]
  storyboard: StoryboardPanel[]
  timeline: TimelineData | null
}

const emptyData: WorkspaceData = {
  outline: null,
  scenes: [],
  characters: [],
  storyboard: [],
  timeline: null,
}

const ROLE_TONE: Record<GenCharacter['role'], string> = {
  lead: 'bg-accent/20 text-accent border-accent/40',
  supporting: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  villain: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
}

const ROLE_LABEL_FALLBACK: Record<GenCharacter['role'], string> = {
  lead: '主角', supporting: '配角', villain: '反派',
}

const sbGradient = (i: number) => {
  const palette = [
    'linear-gradient(135deg, #1e3a5f, #0f172a)',
    'linear-gradient(135deg, #7c2d12, #1e1b4b)',
    'linear-gradient(135deg, #0ea5e9, #1e293b)',
    'linear-gradient(135deg, #ec4899, #1e1b4b)',
    'linear-gradient(135deg, #fbbf24, #1e293b)',
    'linear-gradient(135deg, #10b981, #0f172a)',
  ]
  return palette[i % palette.length]
}

function WorkspacePage() {
  const { t } = useLanguage()
  const [tab, setTab] = useState<WorkspaceTab>('canvas')
  const [episode, setEpisode] = useState(1)
  const [collapsed, setCollapsed] = useState(false)
  const [data, setData] = useState<WorkspaceData>(emptyData)
  const [flash, setFlash] = useState<WorkspaceTab | null>(null)
  const [previewChar, setPreviewChar] = useState<GenCharacter | null>(null)
  const callAi = useServerFn(generateStageAi)

  async function tryAi(stage: 'canvas' | 'script' | 'character' | 'storyboard', userPrompt: string, currentData: WorkspaceData): Promise<Partial<WorkspaceData> | null> {
    try {
      const res = await callAi({
        data: {
          stage,
          userPrompt,
          context: {
            logline: currentData.outline?.logline,
            acts: currentData.outline?.acts,
            scenes: currentData.scenes.map((s) => ({ index: s.index, slug: s.slug, action: s.action, beats: s.beats })),
            characters: currentData.characters.map((c) => ({ name: c.name, roleLabel: c.roleLabel })),
          },
        },
      })
      if (!res.ok) {
        return null
      }
      const p = res.payload
      switch (stage) {
        case 'canvas':
          return { outline: { logline: String(p.logline ?? ''), acts: p.acts ?? [] } }
        case 'script': {
          const scenes: GenScene[] = (p.scenes ?? []).map((s: any, i: number) => ({
            id: `ai-sc-${i + 1}-${Date.now()}`,
            index: s.index ?? i + 1,
            slug: s.slug ?? '',
            location: s.location ?? '',
            timeOfDay: s.timeOfDay ?? 'DAY',
            action: s.action ?? '',
            beats: Array.isArray(s.beats) ? s.beats : [],
            dialogue: Array.isArray(s.dialogue) ? s.dialogue : [],
          }))
          return { scenes }
        }
        case 'character': {
          const characters: GenCharacter[] = (p.characters ?? []).map((c: any, i: number) => {
            const palette: string[] = Array.isArray(c.palette) && c.palette.length ? c.palette : ['#1e293b', '#475569', '#fbbf24']
            return {
              id: `ai-ch-${i + 1}-${Date.now()}`,
              name: c.name ?? `角色${i + 1}`,
              role: (['lead', 'supporting', 'villain'] as const).includes(c.role) ? c.role : 'supporting',
              roleLabel: c.roleLabel ?? ROLE_LABEL_FALLBACK[c.role as GenCharacter['role']] ?? '配角',
              age: typeof c.age === 'number' ? c.age : 18,
              look: c.look ?? '', personality: c.personality ?? '', motivation: c.motivation ?? '', debutShot: c.debutShot ?? '',
              palette,
              swatch: `linear-gradient(135deg, ${palette[0]}, ${palette[palette.length - 1]})`,
            }
          })
          return { characters }
        }
        case 'storyboard': {
          // Map AI panels back to UI shape; pair sceneIndex to existing scene id when possible.
          const sceneById = new Map(currentData.scenes.map((s) => [s.index, s.id]))
          const panels: StoryboardPanel[] = (p.panels ?? []).map((p2: any, i: number) => ({
            id: `ai-pn-${i + 1}-${Date.now()}`,
            index: i + 1,
            sceneId: sceneById.get(p2.sceneIndex) ?? currentData.scenes[0]?.id ?? `sc-${p2.sceneIndex}`,
            shot: ['WS', 'MS', 'CU', 'ECU', 'OTS'].includes(p2.shot) ? p2.shot : 'MS',
            camera: p2.camera ?? '',
            action: p2.action ?? '',
            emotion: p2.emotion ?? '',
            durationSec: typeof p2.durationSec === 'number' ? p2.durationSec : 3,
            gradient: sbGradient(i),
          }))
          return { storyboard: panels }
        }
      }
      return null
    } catch (e) {
      console.error(e)
      return null
    }
  }

  async function produce(stage: WorkspaceTab, userPrompt?: string) {
    let aiPatch: Partial<WorkspaceData> | null = null
    const meaningful = (userPrompt ?? '').trim().length >= 4
    // Snapshot current data so the server call sees consistent context.
    const snapshot = data
    if (meaningful && (stage === 'canvas' || stage === 'script' || stage === 'character' || stage === 'storyboard')) {
      aiPatch = await tryAi(stage, userPrompt!.trim(), snapshot)
    }

    setData((d) => {
      switch (stage) {
        case 'canvas':
          return { ...d, outline: aiPatch?.outline ?? generateOutline() }
        case 'script': {
          const scenes = aiPatch?.scenes ?? generateScript()
          return { ...d, scenes, outline: d.outline ?? generateOutline() }
        }
        case 'character':
          return { ...d, characters: aiPatch?.characters ?? generateCharacters() }
        case 'storyboard': {
          const scenes = d.scenes.length ? d.scenes : generateScript()
          const panels = aiPatch?.storyboard ?? generateStoryboard(scenes)
          return { ...d, scenes, storyboard: panels }
        }
        case 'timeline': {
          const scenes = d.scenes.length ? d.scenes : generateScript()
          const panels = d.storyboard.length ? d.storyboard : generateStoryboard(scenes)
          return { ...d, scenes, storyboard: panels, timeline: generateTimeline(panels) }
        }
        default:
          return d
      }
    })
    setFlash(stage)
    setTimeout(() => setFlash((f) => (f === stage ? null : f)), 1500)
  }

  return (
    <div className="h-screen flex flex-col bg-bg overflow-hidden">
      <WorkspaceTopbar tab={tab} onTabChange={setTab} episode={episode} onEpisodeChange={setEpisode} />
      <div className="flex-1 flex min-h-0">
        <main className="flex-1 min-w-0 overflow-auto p-6">
          {tab === 'canvas' && <CanvasView />}
          {tab === 'script' && <ScriptView />}
          {tab === 'character' && <CharacterView />}
          {tab === 'storyboard' && <StoryboardView />}
          {tab === 'timeline' && <TimelineView />}
        </main>
        <ZopiaChatPanel
          stage={tab}
          onJumpStage={setTab}
          onProduce={produce}
          collapsed={collapsed}
          onToggleCollapsed={() => setCollapsed((v) => !v)}
        />
      </div>
      {previewChar && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setPreviewChar(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="relative bg-bg-surface border border-border rounded-2xl overflow-hidden max-w-2xl w-full flex flex-col sm:flex-row shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setPreviewChar(null)}
              className="absolute top-2 right-2 z-10 p-1.5 rounded-md bg-black/40 hover:bg-black/60 text-white"
              aria-label="关闭"
            >
              <X size={16} />
            </button>
            <div className="sm:w-1/2 aspect-[3/4] sm:aspect-auto">
              <CharacterPortrait character={previewChar} className="w-full h-full block" />
            </div>
            <div className="p-5 sm:w-1/2 space-y-3">
              <div>
                <div className="font-display text-2xl font-bold text-text-primary">{previewChar.name}</div>
                <div className="text-sm text-text-muted mt-0.5">{previewChar.roleLabel} · {previewChar.age} 岁</div>
              </div>
              <dl className="space-y-2 text-sm">
                <div><dt className="text-xs uppercase tracking-wide text-text-muted">外形</dt><dd className="text-text-secondary mt-0.5">{previewChar.look}</dd></div>
                <div><dt className="text-xs uppercase tracking-wide text-text-muted">性格</dt><dd className="text-text-secondary mt-0.5">{previewChar.personality}</dd></div>
                <div><dt className="text-xs uppercase tracking-wide text-text-muted">动机</dt><dd className="text-text-secondary mt-0.5">{previewChar.motivation}</dd></div>
                <div><dt className="text-xs uppercase tracking-wide text-text-muted">首场</dt><dd className="text-text-secondary mt-0.5">{previewChar.debutShot}</dd></div>
              </dl>
              <div className="flex gap-1.5 pt-1">
                {previewChar.palette.map((p) => (
                  <span key={p} className="w-6 h-6 rounded border border-border" style={{ background: p }} title={p} />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )

  function FreshBadge({ stage }: { stage: WorkspaceTab }) {
    void stage
    return null
  }

  function CanvasView() {
    return (
      <div className="relative max-w-4xl mx-auto rounded-2xl border-2 border-dashed border-accent/50 bg-bg-surface p-6 min-h-[500px]">
        <div className="flex items-center justify-between mb-3">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-bg-elevated text-xs border border-border">
            <FileText size={12} /> {t.ws_tab_canvas}
          </span>
          <div className="flex items-center gap-2">
            <FreshBadge stage="canvas" />
            <button className="p-1 rounded-md hover:bg-bg-elevated text-text-muted"><Maximize2 size={14} /></button>
          </div>
        </div>
        {data.outline ? (
          <div className="space-y-5">
            <div>
              <div className="text-xs text-text-muted">Logline</div>
              <p className="text-text-primary mt-1 leading-relaxed">{data.outline.logline}</p>
            </div>
            <div className="space-y-4">
              {data.outline.acts.map((a, i) => (
                <div key={i} className="rounded-xl border border-border bg-bg-elevated/40 p-4">
                  <h4 className="font-semibold text-text-primary mb-2">{a.title}</h4>
                  <ul className="space-y-1.5 text-sm text-text-secondary">
                    {a.beats.map((b, k) => (
                      <li key={k} className="flex gap-2"><span className="text-accent shrink-0">·</span><span>{b}</span></li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-bg-elevated/40 p-6 min-h-[380px]">
            <p className="text-text-muted text-sm">{t.ws_canvas_placeholder}</p>
          </div>
        )}
      </div>
    )
  }

  function ScriptView() {
    if (data.scenes.length === 0) {
      return (
        <div className="max-w-4xl mx-auto panel p-10 text-center">
          <p className="text-text-muted text-sm">{t.ws_script_empty}</p>
        </div>
      )
    }
    return (
      <div className="max-w-4xl mx-auto space-y-4">
        <div className="panel p-5 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-bold">校园恋爱短剧 · 第{episode}集 · 广播室告白</h2>
            <p className="text-text-secondary text-sm mt-1">{data.outline?.logline}</p>
          </div>
          <FreshBadge stage="script" />
        </div>
        {data.scenes.map((sc) => (
          <div key={sc.id} className="panel p-5">
            <div className="text-xs font-mono text-text-muted">SCENE {sc.index} · {sc.timeOfDay}</div>
            <div className="font-semibold mt-1">{sc.slug}</div>
            <p className="text-sm text-text-secondary mt-2 leading-relaxed">{sc.action}</p>
            {sc.beats.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-3">
                {sc.beats.map((b, i) => (
                  <span key={i} className="text-[11px] px-2 py-0.5 rounded-full border border-border bg-bg-elevated text-text-muted">{b}</span>
                ))}
              </div>
            )}
            <div className="mt-3 space-y-1.5">
              {sc.dialogue.map((d, i) => (
                <div key={i} className="text-sm">
                  <span className="text-accent font-semibold">{d.role}: </span>
                  {d.parenthetical && <span className="text-text-muted italic">（{d.parenthetical}）</span>}
                  <span>{d.line}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    )
  }

  function CharacterView() {
    if (data.characters.length === 0) {
      return (
        <div className="max-w-4xl mx-auto panel p-10 text-center">
          <p className="text-text-muted text-sm">{t.ws_character_empty}</p>
        </div>
      )
    }
    // Lead → supporting → villain so the protagonist is shown first.
    const order: Record<GenCharacter['role'], number> = { lead: 0, supporting: 1, villain: 2 }
    const sorted = [...data.characters].sort((a, b) => order[a.role] - order[b.role])
    const views: { key: 'front' | 'side' | 'back' | 'expression'; label: string }[] = [
      { key: 'front', label: '正面' },
      { key: 'side', label: '侧面' },
      { key: 'back', label: '背面' },
      { key: 'expression', label: '表情' },
    ]
    return (
      <div className="-m-6 h-[calc(100vh-3rem)] overflow-y-auto snap-y snap-mandatory">
        {sorted.map((c, idx) => (
          <section
            key={c.id}
            className="snap-start h-[calc(100vh-3rem)] flex flex-col px-6 py-5"
          >
            <div className="flex items-center gap-3 mb-4 shrink-0">
              <Users size={16} className="text-accent" />
              <h2 className="font-display text-lg font-bold">{c.name}</h2>
              <span className={`text-[10px] px-1.5 py-0.5 rounded border ${ROLE_TONE[c.role]}`}>{c.roleLabel}</span>
              <span className="text-xs text-text-muted">{c.age} 岁</span>
              <span className="ml-auto text-xs text-text-muted">{idx + 1} / {sorted.length} · 上下滑动切换</span>
            </div>

            <div className="flex-1 min-h-0 flex items-center justify-center gap-4">
              {/* Left column: 性格 / 外形 */}
              <div className="hidden md:flex flex-col gap-3 w-full max-w-[260px] h-[498px]">
                <Field label="性格" value={c.personality} className="flex-1" />
                <Field label="外形" value={c.look} className="flex-1" />
              </div>

              {/* Center stage */}
              <CharacterStage character={c} views={views} onZoom={() => setPreviewChar(c)} />

              {/* Right column: 动机 / 首场 */}
              <div className="hidden md:flex flex-col gap-3 w-full max-w-[260px] h-[498px]">
                <Field label="动机" value={c.motivation} className="flex-1" />
                <Field label="首场" value={c.debutShot} className="flex-1" />
              </div>
            </div>

            {/* Mobile fallback: stacked bible row */}
            <div className="mt-4 grid grid-cols-2 gap-3 shrink-0 md:hidden">
              <Field label="外形" value={c.look} />
              <Field label="性格" value={c.personality} />
              <Field label="动机" value={c.motivation} />
              <Field label="首场" value={c.debutShot} />
            </div>

            <div className="flex items-center gap-2 mt-3 shrink-0">
              <span className="text-xs text-text-muted">配色</span>
              {c.palette.map((p) => (
                <span key={p} className="w-5 h-5 rounded border border-border" style={{ background: p }} title={p} />
              ))}
            </div>
          </section>
        ))}
      </div>
    )
  }

  function Field({ label, value, className }: { label: string; value: string; className?: string }) {
    return (
      <div className={`rounded-xl border border-border bg-bg-elevated/40 px-4 py-3 overflow-hidden ${className ?? ''}`}>
        <div className="text-xs tracking-wide text-text-muted">{label}</div>
        <div className="text-sm text-text-secondary mt-1.5 leading-relaxed">{value}</div>
      </div>
    )
  }

  function CharacterStage({
    character,
    views,
    onZoom,
  }: {
    character: GenCharacter
    views: { key: 'front' | 'side' | 'back' | 'expression'; label: string }[]
    onZoom: () => void
  }) {
    const [mode, setMode] = useState<'main' | 'multi'>('main')
    return (
      <div className="flex-1 min-h-0 flex flex-col items-center">
        <div
          className="rounded-2xl border border-border bg-gradient-to-b from-bg-elevated/30 to-bg-surface/60 overflow-hidden relative shrink-0"
          style={{ width: 372, height: 498 }}
        >
          {mode === 'main' ? (
            <div className="relative w-full h-full">
              <CharacterPortrait character={character} view="front" className="w-full h-full block" />
            </div>
          ) : (
            <div className="grid grid-cols-2 grid-rows-2 gap-2 p-2 w-full h-full">
              {views.map((v) => (
                <div
                  key={v.key}
                  className="relative rounded-xl overflow-hidden border border-border bg-bg-elevated/30"
                >
                  <CharacterPortrait character={character} view={v.key} className="w-full h-full block" />
                  <span className="absolute bottom-0 inset-x-0 px-2 py-1 text-[11px] text-white/90 bg-gradient-to-t from-black/70 to-transparent text-center">
                    {v.label}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        {/* Bottom thumbnail switcher: main view vs multi-view, matching the reference */}
        <div className="mt-3 flex items-center gap-3 shrink-0 w-full" style={{ maxWidth: 372 }}>
          <ViewThumb
            active={mode === 'main'}
            onClick={() => setMode('main')}
            label="主视图"
          >
            <CharacterPortrait character={character} view="front" className="w-full h-full block" />
          </ViewThumb>
          <ViewThumb
            active={mode === 'multi'}
            onClick={() => setMode('multi')}
            label="多视图"
          >
            <div className="grid grid-cols-2 grid-rows-2 w-full h-full gap-px bg-border">
              {views.map((v) => (
                <div key={v.key} className="relative overflow-hidden">
                  <CharacterPortrait character={character} view={v.key} className="w-full h-full block" />
                </div>
              ))}
            </div>
          </ViewThumb>
          <div className="ml-auto text-xs text-text-muted">点击缩略图切换主视图 / 多视图</div>
        </div>
      </div>
    )
  }

  function ViewThumb({
    active,
    onClick,
    label,
    children,
  }: {
    active: boolean
    onClick: () => void
    label: string
    children: ReactNode
  }) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`relative w-20 h-24 rounded-lg overflow-hidden border-2 transition-all ${
          active ? 'border-accent shadow-[0_0_0_3px_rgba(251,191,36,0.15)]' : 'border-border hover:border-text-muted'
        }`}
        aria-pressed={active}
      >
        {children}
        <span className={`absolute bottom-0 inset-x-0 text-[10px] py-0.5 text-center font-medium ${
          active ? 'bg-accent text-black' : 'bg-black/60 text-white/90'
        }`}>
          {label}
        </span>
      </button>
    )
  }

  function StoryboardView() {
    if (data.storyboard.length === 0) {
      return (
        <div className="max-w-4xl mx-auto panel p-10 text-center">
          <p className="text-text-muted text-sm">{t.ws_storyboard_empty}</p>
        </div>
      )
    }
    // Group by scene
    const groups = new Map<string, StoryboardPanel[]>()
    data.storyboard.forEach((p) => {
      const arr = groups.get(p.sceneId) ?? []
      arr.push(p)
      groups.set(p.sceneId, arr)
    })
    return (
      <div className="max-w-5xl mx-auto space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-bold inline-flex items-center gap-2"><Camera size={16} /> {t.ws_tab_storyboard} · {data.storyboard.length}</h2>
          <FreshBadge stage="storyboard" />
        </div>
        {Array.from(groups.entries()).map(([sceneId, panels]) => {
          const scene = data.scenes.find((s) => s.id === sceneId)
          return (
            <div key={sceneId} className="space-y-2">
              {scene && <div className="text-xs font-mono text-text-muted">SCENE {scene.index} · {scene.slug}</div>}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {panels.map((p) => (
                  <div key={p.id} className="card overflow-hidden">
                    <div className="aspect-video relative" style={{ background: p.gradient }}>
                      <span className="absolute top-1.5 left-1.5 text-[10px] font-mono text-white/80">#{p.index} {p.shot}</span>
                      <span className="absolute bottom-1.5 right-1.5 text-[10px] font-mono text-white/70">{p.durationSec}s</span>
                    </div>
                    <div className="p-2 text-xs space-y-0.5">
                      <div className="text-text-primary line-clamp-2">{p.action}</div>
                      <div className="text-text-muted">{p.camera}</div>
                      <div className="text-accent">{p.emotion}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  function TimelineView() {
    if (!data.timeline) {
      return (
        <div className="max-w-4xl mx-auto panel p-10 text-center">
          <p className="text-text-muted text-sm">{t.ws_timeline_empty}</p>
        </div>
      )
    }
    const tl = data.timeline
    const TRACK_TONES: Record<string, string> = {
      video: 'from-accent to-accent-mint',
      audio: 'from-amber-400 to-rose-500',
      subtitle: 'from-emerald-400 to-cyan-500',
    }
    return (
      <div className="space-y-3 max-w-5xl mx-auto">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-bold inline-flex items-center gap-2"><Clock size={16} /> {t.ws_tab_timeline} · {tl.totalSec.toFixed(0)}s</h2>
          <FreshBadge stage="timeline" />
        </div>
        {/* Ruler */}
        <div className="relative h-5 px-1 text-[10px] font-mono text-text-muted">
          {Array.from({ length: Math.ceil(tl.totalSec / 10) + 1 }).map((_, i) => (
            <span key={i} className="absolute -translate-x-1/2" style={{ left: `${(i * 10 / tl.totalSec) * 100}%` }}>{i * 10}s</span>
          ))}
        </div>
        {tl.tracks.map((tr) => (
          <div key={tr.kind} className="panel p-3">
            <div className="text-xs text-text-muted mb-2">{tr.label}</div>
            <div className="relative h-10 bg-bg-elevated/40 rounded">
              {tr.clips.map((c) => (
                <div
                  key={c.id}
                  className={`absolute top-0 bottom-0 rounded bg-gradient-to-r ${TRACK_TONES[tr.kind]} text-[10px] font-mono text-white/90 px-1.5 flex items-center overflow-hidden`}
                  style={{ left: `${(c.startSec / tl.totalSec) * 100}%`, width: `${(c.durationSec / tl.totalSec) * 100}%` }}
                  title={`${c.label} (${c.startSec.toFixed(1)}s → ${(c.startSec + c.durationSec).toFixed(1)}s)`}
                >
                  <span className="truncate">{c.label}</span>
                </div>
              ))}
              {tr.kind === 'video' && tl.transitionsAt.map((sec, i) => (
                <Fragment key={i}>
                  <div
                    className="absolute top-0 bottom-0 w-0.5 bg-accent"
                    style={{ left: `${(sec / tl.totalSec) * 100}%` }}
                    title={`transition @ ${sec.toFixed(1)}s`}
                  />
                </Fragment>
              ))}
            </div>
          </div>
        ))}
      </div>
    )
  }
}
