import { createFileRoute } from '@tanstack/react-router'
import { Fragment, useState, useEffect } from 'react'
import { useServerFn } from '@tanstack/react-start'
import WorkspaceTopbar, { type WorkspaceTab } from '../components/workspace/WorkspaceTopbar'
import ZopiaChatPanel from '../components/workspace/ZopiaChatPanel'
import { useLanguage } from '../i18n/LanguageContext'
import { useAuth } from '../hooks/useAuth'
import { saveCharacters, saveScenes } from '../lib/assetsStorage'
import {
  generateOutline, generateScript, generateCharacters, generateStoryboard, generateTimeline,
  type Outline, type GenScene, type GenCharacter, type StoryboardPanel, type TimelineData, type TimelineTrack, type TimelineClip,
} from '../data/workspaceGenerators'
import { generateStageAi } from '../lib/aiGenerate.functions'
import { generateImage, repaintCharacterImage } from '../lib/openrouterImage.functions'
import { getProject, type ProjectConfigRow } from '../lib/projects.functions'
import { Maximize2, FileText, Camera, Clock, Users, X, Loader2 } from 'lucide-react'
import CharacterPortrait from '../components/workspace/CharacterPortrait'
import CharacterStage from '../components/workspace/CharacterStage'
import { toast } from 'sonner'

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
  const { user } = useAuth()
  const [tab, setTab] = useState<WorkspaceTab>('canvas')
  const [episode, setEpisode] = useState(1)
  const [collapsed, setCollapsed] = useState(false)
  const [data, setData] = useState<WorkspaceData>(emptyData)
  const [flash, setFlash] = useState<WorkspaceTab | null>(null)
  const [previewChar, setPreviewChar] = useState<GenCharacter | null>(null)
  const callAi = useServerFn(generateStageAi)
  const callImage = useServerFn(generateImage)
const callRepaint = useServerFn(repaintCharacterImage)
  const loadProject = useServerFn(getProject)
  const [project, setProject] = useState<ProjectConfigRow | null>(null)
  const [charImages, setCharImages] = useState<Record<string, string[]>>({})
  const [panelImages, setPanelImages] = useState<Record<string, string>>({})
  const [busyChar, setBusyChar] = useState<string | null>(null)
  const [busyPanel, setBusyPanel] = useState<string | null>(null)
  const [generatingMultiView, setGeneratingMultiView] = useState<string | null>(null)
const [repaintingChar, setRepaintingChar] = useState<string | null>(null)
  const [selectedViewCount, setSelectedViewCount] = useState<string>('3')
  const [autoGen, setAutoGen] = useState(true)
  void setAutoGen
  const workspaceId = Route.useParams().workspaceId
  useEffect(() => {
    let cancelled = false
    loadProject({ data: { id: workspaceId } })
      .then((r) => { if (!cancelled && r.project) setProject(r.project) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [workspaceId, loadProject])

  async function genCharImage(c: GenCharacter) {
    if (busyChar) return
    setBusyChar(c.id)
    try {
      const paletteLine = c.palette?.length
        ? `signature color palette (must appear in clothing / lighting / accessories): ${c.palette.join(', ')}`
        : ''
      const prompt = [
        `Character reference sheet of "${c.name}" — ${c.roleLabel}, age ${c.age}.`,
        `Appearance (strictly follow): ${c.look}.`,
        c.personality && `Personality vibe to convey through expression and posture: ${c.personality}.`,
        c.debutShot && `Inspired by debut shot: ${c.debutShot}.`,
        paletteLine,
        'Full-body, front view, neutral studio background, consistent character design, faithful to the description above, cinematic lighting, high detail, no text, no watermark.',
      ].filter(Boolean).join(' ')
      const res = await callImage({ data: { prompt, model: project?.sceneModel } })
      if (res.url) {
        setCharImages((m) => ({ ...m, [c.id]: [res.url, '', '', ''] }))
        toast.success(`已生成 ${c.name} 主图`)
      } else {
        toast.error(res.error || '生成失败')
      }
    } catch (e) {
      toast.error('生成失败')
    } finally {
      setBusyChar(null)
    }
  }

  async function genCharMultiView(c: GenCharacter) {
    if (generatingMultiView) return
    setGeneratingMultiView(c.id)
    try {
      const paletteLine = c.palette?.length
        ? `signature color palette (must appear in clothing / lighting / accessories): ${c.palette.join(', ')}`
        : ''
      let viewsConfig: { key: string; label: string; prompt: string }[]
      if (selectedViewCount === '3') {
        viewsConfig = [
          { key: 'front', label: '正面', prompt: 'Full-body, front view, neutral studio background, consistent character design, same person, cinematic lighting, high detail, no text, no watermark.' },
          { key: 'side', label: '侧面', prompt: 'Full-body, side profile view, neutral studio background, consistent character design, same person, cinematic lighting, high detail, no text, no watermark.' },
          { key: 'back', label: '背面', prompt: 'Full-body, back view, neutral studio background, consistent character design, same person, cinematic lighting, high detail, no text, no watermark.' },
        ]
      } else if (selectedViewCount === '5') {
        viewsConfig = [
          { key: 'front', label: '正面', prompt: 'Full-body, front view, neutral studio background, consistent character design, same person, cinematic lighting, high detail, no text, no watermark.' },
          { key: 'side', label: '侧面', prompt: 'Full-body, side profile view, neutral studio background, consistent character design, same person, cinematic lighting, high detail, no text, no watermark.' },
          { key: 'back', label: '背面', prompt: 'Full-body, back view, neutral studio background, consistent character design, same person, cinematic lighting, high detail, no text, no watermark.' },
          { key: 'three-quarter', label: '四分之三侧', prompt: 'Full-body, three-quarter view, neutral studio background, consistent character design, same person, cinematic lighting, high detail, no text, no watermark.' },
          { key: 'expression', label: '表情', prompt: 'Close-up on face, expression detail, neutral studio background, consistent character design, same person, showing facial expression and emotion, cinematic lighting, high detail, no text, no watermark.' },
        ]
      } else {
        viewsConfig = [
          { key: 'front', label: '正面', prompt: 'Full-body, front view, neutral studio background, consistent character design, same person, cinematic lighting, high detail, no text, no watermark.' },
          { key: 'side', label: '侧面', prompt: 'Full-body, side profile view, neutral studio background, consistent character design, same person, cinematic lighting, high detail, no text, no watermark.' },
          { key: 'back', label: '背面', prompt: 'Full-body, back view, neutral studio background, consistent character design, same person, cinematic lighting, high detail, no text, no watermark.' },
          { key: 'expression', label: '表情', prompt: 'Close-up on face, expression detail, neutral studio background, consistent character design, same person, showing facial expression and emotion, cinematic lighting, high detail, no text, no watermark.' },
          { key: 'outfit', label: '服装', prompt: 'Full-body, front view showing outfit details, neutral studio background, consistent character design, same person, detailed costume design, high detail, no text, no watermark.' },
          { key: 'detail', label: '细节', prompt: 'Close-up on hands and accessories, neutral studio background, consistent character design, same person, detailed props and accessories, high detail, no text, no watermark.' },
        ]
      }
      const newUrls: string[] = []
      for (let i = 0; i < viewsConfig.length; i++) {
        const v = viewsConfig[i]
        setBusyChar(`${c.id}-${v.key}`)
        const prompt = [
          `Character reference sheet of "${c.name}" — ${c.roleLabel}, age ${c.age}.`,
          `Appearance (strictly follow): ${c.look}.`,
          c.personality && `Personality vibe to convey through expression and posture: ${c.personality}.`,
          c.debutShot && `Inspired by debut shot: ${c.debutShot}.`,
          paletteLine,
          v.prompt,
        ].filter(Boolean).join(' ')
        const res = await callImage({ data: { prompt, model: project?.sceneModel } })
        if (res.url) {
          newUrls[i] = res.url
        }
        setBusyChar(null)
      }
      if (newUrls.some((u) => u)) {
        setCharImages((m) => ({ ...m, [c.id]: newUrls }))
        toast.success(`已生成 ${c.name} 多视图`)
      }
    } finally {
      setGeneratingMultiView(null)
    }
  }

  async function genPanelImage(p: StoryboardPanel) {
    if (busyPanel) return
    setBusyPanel(p.id)
    try {
      const scene = data.scenes.find((s) => s.id === p.sceneId)
      const prompt = [
        scene?.slug && `Scene: ${scene.slug}`,
        `Shot ${p.shot}: ${p.camera}`,
        p.action, p.emotion && `mood: ${p.emotion}`,
        'cinematic storyboard panel, dramatic composition, film still',
      ].filter(Boolean).join('. ')
      const res = await callImage({ data: { prompt, model: project?.storyboardModel } })
      if (res.url) {
        setPanelImages((m) => ({ ...m, [p.id]: res.url }))
      } else {
        toast.error(res.error || '生成失败')
      }
    } catch {
      toast.error('生成失败')
    } finally {
      setBusyPanel(null)
    }
  }

async function repaintCharImage(charId: string, styleIndex: number) {
    if (repaintingChar) return
    const urls = charImages[charId]
    if (!urls || !urls.length || !urls[0]) return
    setRepaintingChar(charId)
    try {
      const res = await callRepaint({ data: { imageUrl: urls[0], styleIndex } })
      if (res.url) {
        const newUrls = [...urls]
        newUrls[0] = res.url
        setCharImages((m) => ({ ...m, [charId]: newUrls }))
        toast.success('风格重绘完成')
      } else {
        toast.error(res.error || '重绘失败')
      }
    } catch {
      toast.error('重绘失败')
    } finally {
      setRepaintingChar(null)
    }
  }

  // Auto-generate real images for newly produced characters / storyboard panels
  // using the project's configured model. Sequential to avoid rate limits.
  useEffect(() => {
    if (!autoGen) return
    const pending = data.characters.filter((c) => !charImages[c.id] || !charImages[c.id][0])
    if (!pending.length || busyChar) return
    void (async () => {
      for (const c of pending) {
        // eslint-disable-next-line no-await-in-loop
        await genCharImage(c)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.characters, autoGen])

  useEffect(() => {
    if (!autoGen) return
    const pending = data.storyboard.filter((p) => !panelImages[p.id])
    if (!pending.length || busyPanel) return
    void (async () => {
      for (const p of pending) {
        // eslint-disable-next-line no-await-in-loop
        await genPanelImage(p)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.storyboard, autoGen])
  const [initialChatInput, setInitialChatInput] = useState<string>('')
  useEffect(() => {
    try {
      const v = sessionStorage.getItem('workspace_prefill')
      if (v) {
        setInitialChatInput(v)
        sessionStorage.removeItem('workspace_prefill')
      }
    } catch {}
  }, [])

  async function handleSaveAssets() {
    if (!user) {
      toast.error('请先登录')
      return
    }
    if (data.characters.length > 0) {
      const { error: charErr } = await saveCharacters(data.characters, user.id)
      if (charErr) {
        toast.error('保存角色失败')
        return
      }
    }
    if (data.scenes.length > 0) {
      const { error: sceneErr } = await saveScenes(data.scenes, user.id)
      if (sceneErr) {
        toast.error('保存场景失败')
        return
      }
    }
    toast.success('已保存到资产库')
  }

  async function tryAi(stage: 'canvas' | 'script' | 'character' | 'storyboard' | 'timeline', userPrompt: string, currentData: WorkspaceData): Promise<Partial<WorkspaceData> | null> {
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
        case 'timeline': {
          const tracks: TimelineTrack[] = (p.tracks ?? []).map((t: any) => ({
            kind: t.kind as 'video' | 'audio' | 'subtitle',
            label: t.label ?? '',
            clips: (t.clips ?? []).map((c: any, i: number): TimelineClip => ({
              id: `tl-${t.kind}-${i}-${Date.now()}`,
              startSec: typeof c.startSec === 'number' ? c.startSec : 0,
              durationSec: typeof c.durationSec === 'number' ? c.durationSec : 3,
              label: c.label ?? '',
              panelId: c.panelIndex ? currentData.storyboard.find((pan) => pan.index === c.panelIndex)?.id : undefined,
            })),
          }))
          const transitionsAt: number[] = Array.isArray(p.transitionsAt) ? p.transitionsAt : []
          const totalSec = tracks[0]?.clips.reduce((sum, c) => sum + (c.durationSec ?? 0), 0) ?? 0
          return { timeline: { totalSec, tracks, transitionsAt } }
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
    // Extract view count from prompt (e.g. "视角数量: 三视图" or "Views: 3-view sheet")
    if (stage === 'character' && userPrompt) {
      const viewMatch = userPrompt.match(/视角数量[：:]\s*(三视图|五视图|三视图\+表情\+服装)/i) ||
        userPrompt.match(/Views[：:]\s*(3-view sheet|5-view sheet|3-view \+ expressions \+ outfits)/i)
      if (viewMatch) {
        const viewMap: Record<string, string> = {
          '三视图': '3', '五视图': '5', '三视图+表情+服装': 'full',
          '3-view sheet': '3', '5-view sheet': '5', '3-view + expressions + outfits': 'full',
        }
        const matched = viewMatch[1] || viewMatch[2]
        setSelectedViewCount(viewMap[matched] ?? '3')
      }
    }
    const snapshot = data
    if (meaningful && (stage === 'canvas' || stage === 'script' || stage === 'character' || stage === 'storyboard' || stage === 'timeline')) {
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
          const timelineAi = aiPatch?.timeline ?? null
          return { ...d, scenes, storyboard: panels, timeline: timelineAi ?? generateTimeline(panels) }
        }
        default:
          return d
      }
    })
    setFlash(stage)
    setTimeout(() => setFlash((f) => (f === stage ? null : f)), 1500)
  }

  async function saveAssets() {
    if (!user) {
      toast.error('请先登录')
      return
    }
    if (data.characters.length > 0) {
      const { error: charErr } = await saveCharacters(data.characters, user.id)
      if (charErr) {
        toast.error('保存角色失败')
        return
      }
    }
    if (data.scenes.length > 0) {
      const { error: sceneErr } = await saveScenes(data.scenes, user.id)
      if (sceneErr) {
        toast.error('保存场景失败')
        return
      }
    }
    toast.success('已保存到资产库')
  }

  return (
    <div className="h-screen flex flex-col bg-bg overflow-hidden">
      <WorkspaceTopbar tab={tab} onTabChange={setTab} episode={episode} onEpisodeChange={setEpisode} onSaveAssets={handleSaveAssets} />
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
          initialInput={initialChatInput}
          onSaveAssets={saveAssets}
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
<h2 className="font-display text-xl font-bold">{data.outline?.logline ? `${data.outline.logline} · 第${episode}集` : `第${episode}集`}</h2>
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
            id={c.id}
            className="snap-start h-[calc(100vh-3rem)] flex flex-col px-6 py-5"
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mb-4 shrink-0 min-w-0">
              <span
                className="w-1 h-7 rounded-full shrink-0"
                style={{ background: c.palette[0] ?? 'var(--accent)' }}
                aria-hidden
              />
              <h2 className="font-display text-xl font-bold tracking-tight truncate">{c.name}</h2>
              {(() => {
                const [primary, ...rest] = c.roleLabel.split('·').map((s) => s.trim()).filter(Boolean)
                const archetype = rest.join(' · ')
                return (
                  <>
                    <span className={`shrink-0 text-[11px] px-2 py-0.5 rounded-full border ${ROLE_TONE[c.role]}`}>
                      {primary || ROLE_LABEL_FALLBACK[c.role]}
                    </span>
                    {archetype && (
                      <span className="shrink-0 text-[11px] px-2 py-0.5 rounded-full border border-border bg-bg-elevated/60 text-text-secondary truncate max-w-[180px]">
                        {archetype}
                      </span>
                    )}
                  </>
                )
              })()}
              <span className="shrink-0 text-[11px] px-2 py-0.5 rounded-full border border-border bg-bg-elevated/60 text-text-muted">
                {c.age} 岁
              </span>
              {c.mbti && (
                <span className="shrink-0 text-[11px] font-mono px-2 py-0.5 rounded-full border border-border bg-bg-elevated/60 text-text-secondary">
                  {c.mbti}
                </span>
              )}
              {c.keyProp && (
                <span className="shrink-0 text-[11px] px-2 py-0.5 rounded-full border border-border bg-bg-elevated/60 text-text-muted">
                  道具 · {c.keyProp}
                </span>
              )}
              <span className="ml-auto shrink-0 text-xs text-text-muted tabular-nums hidden sm:inline">
                {idx + 1} / {sorted.length} · 上下滑动切换
              </span>
              <span className="ml-auto shrink-0 text-xs text-text-muted tabular-nums sm:hidden">
                {idx + 1}/{sorted.length}
              </span>
            </div>

            {/* ≥md: 档案在左(小) + 主图在右(大)；<md: 单列堆叠 */}
            <div className="flex-1 min-h-0 flex flex-col md:grid md:grid-cols-[240px_1fr] md:items-start gap-4 md:gap-5">
              <CharacterDossier character={c} cast={sorted} />
              <div className="relative flex-1 min-h-0">
                {(busyChar?.startsWith(c.id) || generatingMultiView === c.id) ? (
                  <div className="relative rounded-2xl overflow-hidden border border-border bg-bg-elevated/30 flex items-center justify-center" style={{ height: 'calc(100vh - 200px)', maxHeight: 600 }}>
                    <div className="flex flex-col items-center gap-3">
                      <Loader2 size={32} className="animate-spin text-accent" />
                      <span className="text-sm text-text-muted">AI 生成中，请稍候…</span>
                    </div>
                  </div>
                ) : charImages[c.id] && charImages[c.id][0] ? (
                  <div className="relative flex flex-col h-full" style={{ height: 'calc(100vh - 200px)', maxHeight: 600 }}>
                    <div className="flex-1 rounded-2xl overflow-hidden border border-border bg-bg-elevated/30 relative">
                      <img src={charImages[c.id][0]} alt={`${c.name} 正面`} className="w-full h-full object-contain" />
                      {repaintingChar === c.id && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                          <Loader2 size={24} className="animate-spin text-white" />
                        </div>
                      )}
                      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5">
                        {[0, 1, 2, 3, 4, 5].map((idx) => (
                          <button
                            key={idx}
                            onClick={() => repaintCharImage(c.id, idx)}
                            disabled={repaintingChar === c.id}
                            title={`风格 ${idx + 1}`}
                            className="w-8 h-8 rounded-full bg-black/60 border border-white/20 text-white text-xs hover:bg-black/80 disabled:opacity-40 transition"
                          >
                            {idx + 1}
                          </button>
                        ))}
                      </div>
                    </div>
                    {generatingMultiView === c.id ? (
                      <div className="mt-2 py-2 rounded-lg bg-accent/70 text-white text-sm font-semibold flex items-center justify-center gap-2">
                        <Loader2 size={14} className="animate-spin" /> 生成中…
                      </div>
                    ) : charImages[c.id].length > 1 && charImages[c.id].slice(1).some((u) => u) ? (
                      <>
                        <div className="grid grid-cols-2 gap-1 mt-1 flex-1 overflow-hidden rounded-lg border border-border">
                          {charImages[c.id].slice(1).map((url, vi) => {
                            const labels = selectedViewCount === '5'
                              ? ['侧面', '背面', '四分之三侧', '表情']
                              : selectedViewCount === 'full'
                                ? ['表情', '服装', '细节']
                                : ['侧面', '背面']
                            return url ? (
                              <div key={vi} className="relative overflow-hidden bg-bg-elevated/30 rounded">
                                <img src={url} alt={labels[vi]} className="w-full h-full object-contain" />
                                <span className="absolute bottom-0.5 left-0.5 text-[9px] px-1 py-0.5 rounded bg-black/60 text-white">{labels[vi]}</span>
                              </div>
                            ) : (
                              <div key={vi} className="relative bg-bg-elevated/30 flex items-center justify-center rounded">
                                <Loader2 size={12} className="animate-spin text-text-muted" />
                              </div>
                            )
                          })}
                        </div>
                        <button
                          onClick={() => genCharMultiView(c)}
                          disabled={generatingMultiView === c.id}
                          className="mt-2 w-full py-2 rounded-lg bg-accent text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition"
                        >
                          重新生成多视图
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => genCharMultiView(c)}
                        disabled={generatingMultiView === c.id}
                        className="mt-2 w-full py-2 rounded-lg bg-accent text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition"
                      >
                        生成{selectedViewCount === '3' ? '三视图' : selectedViewCount === '5' ? '五视图' : '全视图'}
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="relative rounded-2xl overflow-hidden border border-border bg-bg-elevated/30 flex items-center justify-center" style={{ height: 'calc(100vh - 200px)', maxHeight: 600 }}>
                    <div className="flex flex-col items-center gap-3">
                      <Loader2 size={32} className="animate-spin text-accent" />
                      <span className="text-sm text-text-muted">AI 生成中，请稍候…</span>
                    </div>
                  </div>
                )}
              </div>
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

  function ClampText({ text, label, maxLines = 3, threshold = 80 }: { text: string; label: string; maxLines?: number; threshold?: number }) {
    const [expanded, setExpanded] = useState(false)
    const clampable = text.length > threshold
    if (!clampable) return <span>{text}</span>
    return (
      <div>
        <p
          className={expanded ? '' : 'overflow-hidden'}
          style={expanded ? undefined : { display: '-webkit-box', WebkitLineClamp: maxLines, WebkitBoxOrient: 'vertical' as const }}
        >
          {text}
        </p>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label={`${expanded ? '收起' : '展开'} ${label}`}
          className="mt-1 text-[11px] text-text-muted hover:text-text-primary transition underline-offset-2 hover:underline"
        >
          {expanded ? '收起' : '展开全部'}
        </button>
      </div>
    )
  }

  function CharacterDossier({ character, cast }: { character: GenCharacter; cast: GenCharacter[] }) {
    const rows: { label: string; value: string }[] = [
      { label: '外形', value: character.look },
      { label: '性格', value: character.personality },
      { label: '动机', value: character.motivation },
      { label: '首场', value: character.debutShot },
    ]
    const nameOf = (id: string) => cast.find((x) => x.id === id)?.name ?? id
    const roleOf = (id: string) => cast.find((x) => x.id === id)?.role ?? 'supporting'
    const jumpTo = (id: string) => {
      const el = document.getElementById(id)
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
    return (
      <div className="w-full md:max-h-[600px] md:overflow-y-auto rounded-2xl border border-border bg-bg-elevated/40 px-5 py-4">
        <div className="flex items-baseline justify-between mb-2">
          <h3 className="text-xs tracking-[0.18em] uppercase text-text-muted">角色档案</h3>
          <span className="text-[10px] text-text-muted">Character Bible</span>
        </div>
        <dl className="divide-y divide-border/60">
          {rows.map((r) => (
            <div key={r.label} className="flex gap-3 py-2.5">
              <dt className="text-xs text-text-muted shrink-0 w-10 pt-0.5 tracking-wide">{r.label}</dt>
              <dd className="text-sm text-text-secondary leading-relaxed flex-1 min-w-0 break-words">
                <ClampText text={r.value} label={r.label} />
              </dd>
            </div>
          ))}
        </dl>
        {character.relations && character.relations.length > 0 && (
          <div className="mt-3 pt-3 border-t border-border/60">
            <div className="flex items-baseline justify-between mb-2">
              <h4 className="text-xs tracking-[0.18em] uppercase text-text-muted">关系网</h4>
              <span className="text-[10px] text-text-muted">点击姓名跳转</span>
            </div>
            <ul role="list" className="space-y-2">
              {character.relations.map((r) => {
                const targetRole = roleOf(r.targetId)
                return (
                  <li key={r.targetId} className="flex items-start gap-2 text-sm">
                    <span className="text-text-muted shrink-0 pt-0.5" aria-hidden>↔</span>
                    <button
                      type="button"
                      onClick={() => jumpTo(r.targetId)}
                      aria-label={`跳转到角色 ${nameOf(r.targetId)}`}
                      className={`shrink-0 text-[11px] px-2 py-0.5 rounded-full border transition hover:opacity-80 ${ROLE_TONE[targetRole]}`}
                    >
                      {nameOf(r.targetId)}
                    </button>
                    <span className="shrink-0 text-[11px] px-1.5 py-0.5 rounded border border-border bg-bg-elevated/60 text-text-muted">
                      {r.label}
                    </span>
                    <span className="text-text-secondary text-[13px] leading-relaxed min-w-0 break-words">{r.summary}</span>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </div>
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
                    <div className="aspect-video relative overflow-hidden" style={{ background: p.gradient }}>
                      {panelImages[p.id] && (
                        <img src={panelImages[p.id]} alt={p.action} className="absolute inset-0 w-full h-full object-cover" />
                      )}
                      <span className="absolute top-1.5 left-1.5 text-[10px] font-mono text-white/80">#{p.index} {p.shot}</span>
                      <span className="absolute bottom-1.5 right-1.5 text-[10px] font-mono text-white/70">{p.durationSec}s</span>
                      {busyPanel === p.id && (
                        <div className="absolute top-1.5 right-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-black/60 text-white text-[10px]">
                          <Loader2 size={10} className="animate-spin" />
                          生成中
                        </div>
                      )}
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
