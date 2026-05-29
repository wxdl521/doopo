import { createFileRoute } from '@tanstack/react-router'
import { Fragment, useState, useEffect, useRef } from 'react'
import { useServerFn } from '@tanstack/react-start'
import ReactMarkdown from 'react-markdown'
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
import { generateImage } from '../lib/openrouterImage.functions'
import { getProject, type ProjectConfigRow } from '../lib/projects.functions'
import { streamSynopsis, streamEpisodeScenes, refineSynopsis, refineEpisodeScenes } from '../lib/scriptAgent.functions'
import { Maximize2, FileText, Camera, Clock, Users, X, Loader2, Sparkles, Send } from 'lucide-react'
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
  synopsisText: string
  episodeTexts: { epIndex: number; text: string }[]
  nextEpIndex: number
  nextSceneCount: number
}

const emptyData: WorkspaceData = {
  outline: null,
  scenes: [],
  characters: [],
  storyboard: [],
  timeline: null,
  synopsisText: '',
  episodeTexts: [],
  nextEpIndex: 1,
  nextSceneCount: 15,
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
  const callSynopsis = useServerFn(streamSynopsis)
  const callEpisode = useServerFn(streamEpisodeScenes)
  const callRefine = useServerFn(refineSynopsis)
  const callRefineEpisode = useServerFn(refineEpisodeScenes)
  const loadProject = useServerFn(getProject)
  const [project, setProject] = useState<ProjectConfigRow | null>(null)
  const [charImages, setCharImages] = useState<Record<string, string[]>>({})
  const [panelImages, setPanelImages] = useState<Record<string, string>>({})
  const [sceneImages, setSceneImages] = useState<Record<string, string>>({})
  const [busyChar, setBusyChar] = useState<string | null>(null)
  const [busyPanel, setBusyPanel] = useState<string | null>(null)
  const [busyScene, setBusyScene] = useState<string | null>(null)
  const [generatingMultiView, setGeneratingMultiView] = useState<string | null>(null)
  const [selectedViewCount, setSelectedViewCount] = useState<string>('3')
  const [autoGen, setAutoGen] = useState(true)
  void setAutoGen
  // 流式剧本生成状态
  const [synopsisText, setSynopsisText] = useState('')
  const [synopsisDraft, setSynopsisDraft] = useState('')
  const [expandedEpisodes, setExpandedEpisodes] = useState<Set<number>>(new Set([1]))
  const [synopsisStreaming, setSynopsisStreaming] = useState(false)
  const [episodeStreaming, setEpisodeStreaming] = useState(false)
  const [synopsisBubbles, setSynopsisBubbles] = useState<{ id: string; text: string }[]>([])
  const [episodeBubbles, setEpisodeBubbles] = useState<{ id: string; text: string }[]>([])
  const synopsisPendingRef = useRef<Map<string, { buf: string; done: boolean }>>(new Map())
  const synopsisFlushRef = useRef<number | null>(null)
  const episodePendingRef = useRef<Map<string, { buf: string; done: boolean }>>(new Map())
  const episodeFlushRef = useRef<number | null>(null)
  const [streamingBubbleId, setStreamingBubbleId] = useState<string | null>(null)
  const episodeRefs = useRef<Record<number, HTMLDetailsElement | null>>({})
  const shownAutoCompleteToastRef = useRef(false)
  const autoRunTargetRef = useRef<number | null>(null)
  const [autoRunCompleteTarget, setAutoRunCompleteTarget] = useState<number | null>(null)
  const [selectedEpisodeIndex, setSelectedEpisodeIndex] = useState<number>(1)
  const [charViewTab, setCharViewTab] = useState<'characters' | 'scenes'>('characters')
  const workspaceId = Route.useParams().workspaceId
  useEffect(() => {
    let cancelled = false
    loadProject({ data: { id: workspaceId } })
      .then((r) => { if (!cancelled && r.project) setProject(r.project) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [workspaceId, loadProject])

  // Expand character visual description from script profiles before image generation
  async function expandCharacterLook(c: GenCharacter): Promise<string> {
    // Combine all detailed description fields
    const combined = [
      c.gender && `性别：${c.gender}`,
      `年龄：${c.age}`,
      c.faceDescription && `面部特征：${c.faceDescription}`,
      c.bodyDescription && `身材体型：${c.bodyDescription}`,
      c.clothingDescription && `服装配饰：${c.clothingDescription}`,
      c.palette?.length && `配色：${c.palette.join(', ')}`,
    ].filter(Boolean).join('\n')

    // If already detailed enough (>200 chars), use as-is
    if (combined.length > 200) return combined

    try {
      const res = await callAi({
        data: {
          stage: 'character',
          userPrompt: `基于以下角色信息，扩写一份详细的外形视觉描述（仅描述外貌、穿着、体态、发型、配饰等视觉元素，不要写性格和剧情）。控制在 300 字以内。\n\n角色名：${c.name}\n角色定位：${c.roleLabel}\n${combined}`,
          context: {},
        },
      })
      // The AI returns structured data; combine the description fields
      if (res?.ok && res.payload?.characters?.[0]) {
        const ch = res.payload.characters[0]
        const expanded = [
          ch.gender && `性别：${ch.gender}`,
          `年龄：${ch.age}`,
          ch.faceDescription && `面部特征：${ch.faceDescription}`,
          ch.bodyDescription && `身材体型：${ch.bodyDescription}`,
          ch.clothingDescription && `服装配饰：${ch.clothingDescription}`,
        ].filter(Boolean).join('\n')
        if (expanded.length > combined.length) {
          return expanded
        }
      }
    } catch {
      // Fall through to original
    }
    return combined
  }

  async function genSceneImage(s: GenScene) {
    if (busyScene) return
    setBusyScene(s.id)
    try {
      const prompt = [
        `Location: ${s.slug}`,
        s.location && `${s.location}`,
        `Time: ${s.timeOfDay === 'DAY' ? 'daytime' : s.timeOfDay === 'NIGHT' ? 'nighttime' : s.timeOfDay === 'DUSK' ? 'dusk, golden hour' : 'dawn'}`,
        'Empty scene, no people, no characters, no figures, no silhouettes.',
        'Cinematic environment photography, wide establishing shot, detailed architecture and props, atmospheric lighting, film still quality.',
      ].filter(Boolean).join('. ')
      const res = await callImage({ data: { prompt, model: project?.sceneModel } })
      if (res.url) {
        setSceneImages((m) => ({ ...m, [s.id]: res.url }))
      } else {
        toast.error(res.error || '场景图生成失败')
      }
    } catch {
      toast.error('场景图生成失败')
    } finally {
      setBusyScene(null)
    }
  }

  async function genCharImage(c: GenCharacter) {
    if (busyChar) return
    setBusyChar(c.id)
    try {
      // Expand character visual description first
      const expandedLook = await expandCharacterLook(c)
      const paletteLine = c.palette?.length
        ? `signature color palette (must appear in clothing / accessories): ${c.palette.join(', ')}`
        : ''
      const prompt = [
        `Character reference sheet of "${c.name}" — ${c.roleLabel}, age ${c.age}.`,
        `Appearance (strictly follow): ${expandedLook}.`,
        c.personality && `Personality vibe: ${c.personality}.`,
        paletteLine,
        'Full-body, standing upright facing camera, arms naturally at sides, pure white background, clean studio lighting, no shadows on background, consistent character design, high detail, no text, no watermark, no props, no other people.',
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
      const expandedLook = await expandCharacterLook(c)
      const paletteLine = c.palette?.length
        ? `signature color palette (must appear in clothing / accessories): ${c.palette.join(', ')}`
        : ''
      const base = 'pure white background, clean studio lighting, no shadows on background, consistent character design, same person, high detail, no text, no watermark, no props, no other people.'
      let viewsConfig: { key: string; label: string; prompt: string }[]
      if (selectedViewCount === '3') {
        viewsConfig = [
          { key: 'front', label: '全身', prompt: `Full-body, standing upright facing camera, arms naturally at sides, ${base}` },
          { key: 'upper', label: '半身', prompt: `Upper body shot, facing camera, ${base}` },
          { key: 'closeup', label: '特写', prompt: `Close-up on face and shoulders, facing camera, ${base}` },
        ]
      } else if (selectedViewCount === '5') {
        viewsConfig = [
          { key: 'front', label: '全身', prompt: `Full-body, standing upright facing camera, arms naturally at sides, ${base}` },
          { key: 'upper', label: '半身', prompt: `Upper body shot, facing camera, ${base}` },
          { key: 'closeup', label: '面部', prompt: `Close-up on face, facing camera, ${base}` },
          { key: 'expression', label: '表情', prompt: `Close-up on face, showing emotion and expression, facing camera, ${base}` },
          { key: 'outfit', label: '服装', prompt: `Full-body, front view showing outfit details, facing camera, ${base}` },
        ]
      } else {
        viewsConfig = [
          { key: 'front', label: '全身', prompt: `Full-body, standing upright facing camera, arms naturally at sides, ${base}` },
          { key: 'upper', label: '半身', prompt: `Upper body shot, facing camera, ${base}` },
          { key: 'closeup', label: '面部', prompt: `Close-up on face, facing camera, ${base}` },
          { key: 'expression', label: '表情', prompt: `Close-up on face, showing emotion and expression, facing camera, ${base}` },
          { key: 'outfit', label: '服装', prompt: `Full-body, front view showing outfit details, facing camera, ${base}` },
          { key: 'detail', label: '细节', prompt: `Close-up on hands and accessories, front view, ${base}` },
        ]
      }
      const newUrls: string[] = []
      for (let i = 0; i < viewsConfig.length; i++) {
        const v = viewsConfig[i]
        setBusyChar(`${c.id}-${v.key}`)
        const prompt = [
          `Character reference sheet of "${c.name}" — ${c.roleLabel}, age ${c.age}.`,
          `Appearance (strictly follow): ${expandedLook}.`,
          c.personality && `Personality vibe: ${c.personality}.`,
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

  // Auto-generate scene images for newly produced scenes
  useEffect(() => {
    if (!autoGen) return
    const pending = data.scenes.filter((s) => !sceneImages[s.id])
    if (!pending.length || busyScene) return
    void (async () => {
      for (const s of pending) {
        // eslint-disable-next-line no-await-in-loop
        await genSceneImage(s)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.scenes, autoGen])

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
              gender: c.gender ?? '',
              faceDescription: c.faceDescription ?? '',
              bodyDescription: c.bodyDescription ?? '',
              clothingDescription: c.clothingDescription ?? '',
              personality: c.personality ?? '',
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

  // ===== 剧本流式生成辅助 =====
  function ensureSynopsisFlush() {
    if (synopsisFlushRef.current != null) return
    synopsisFlushRef.current = window.setInterval(() => {
      const map = synopsisPendingRef.current
      if (map.size === 0) {
        if (synopsisFlushRef.current != null) window.clearInterval(synopsisFlushRef.current)
        synopsisFlushRef.current = null
        return
      }
      setSynopsisBubbles((prev) =>
        prev.map((b) => {
          const slot = map.get(b.id)
          if (!slot) return b
          if (slot.buf.length === 0) {
            if (slot.done) { map.delete(b.id); return { ...b, text: b.text } }
            return b
          }
          const take = Math.min(slot.buf.length, Math.max(2, Math.ceil(slot.buf.length / 12)))
          const chunk = slot.buf.slice(0, take)
          slot.buf = slot.buf.slice(take)
          const next = { ...b, text: b.text + chunk }
          if (slot.buf.length === 0 && slot.done) { map.delete(b.id) }
          return next
        }),
      )
    }, 24) as unknown as number
  }

  function ensureEpisodeFlush() {
    if (episodeFlushRef.current != null) return
    episodeFlushRef.current = window.setInterval(() => {
      const map = episodePendingRef.current
      if (map.size === 0) {
        if (episodeFlushRef.current != null) window.clearInterval(episodeFlushRef.current)
        episodeFlushRef.current = null
        return
      }
      setEpisodeBubbles((prev) =>
        prev.map((b) => {
          const slot = map.get(b.id)
          if (!slot) return b
          if (slot.buf.length === 0) {
            if (slot.done) { map.delete(b.id); return { ...b, text: b.text } }
            return b
          }
          const take = Math.min(slot.buf.length, Math.max(2, Math.ceil(slot.buf.length / 12)))
          const chunk = slot.buf.slice(0, take)
          slot.buf = slot.buf.slice(take)
          const next = { ...b, text: b.text + chunk }
          if (slot.buf.length === 0 && slot.done) { map.delete(b.id) }
          return next
        }),
      )
    }, 24) as unknown as number
  }

  async function runScriptSynopsis(opts: {
    type: string; genre: string; tone: string; theme: string; plot: string
    expectedEpisodes: number; totalMinutes: number; lang: 'zh' | 'en'; model?: string
  }): Promise<void> {
    setSynopsisStreaming(true)
    setSynopsisBubbles([])
    setSynopsisText('')
    const id = `sn-${Date.now()}`
    setSynopsisBubbles([{ id, text: '' }])
    try {
      const stream = await callSynopsis({ data: { ...opts, lang: opts.lang ?? 'zh' } }) as AsyncIterable<{ delta?: string; done?: boolean; text?: string; error?: string }>
      for await (const chunk of stream) {
        if ('error' in chunk) { toast.error(chunk.error); break }
        if ('delta' in chunk && chunk.delta) {
          const map = synopsisPendingRef.current
          const slot = map.get(id) ?? { buf: '', done: false }
          slot.buf += chunk.delta
          map.set(id, slot)
          ensureSynopsisFlush()
        } else if ('done' in chunk) {
          const map = synopsisPendingRef.current
          const slot = map.get(id)
          if (slot) { slot.done = true; ensureSynopsisFlush() }
          else { setSynopsisBubbles((prev) => prev.map((b) => b.id === id ? { ...b, text: chunk.text ?? '' } : b)) }
          setSynopsisText(chunk.text ?? '')
          setSynopsisDraft(chunk.text ?? '')
        }
      }
    } catch (e) {
      toast.error('生成失败')
    } finally {
      setSynopsisStreaming(false)
    }
  }

  async function runRefineSynopsis(opts: {
    instruction: string; lang: 'zh' | 'en'; model?: string
  }): Promise<void> {
    const currentSynopsis = synopsisDraft || synopsisText
    if (!currentSynopsis.trim()) {
      toast.error('请先生成故事梗概')
      return
    }
    setSynopsisStreaming(true)
    const id = `sn-${Date.now()}`
    setSynopsisBubbles([{ id, text: '' }])
    try {
      const stream = await callRefine({
        data: {
          currentSynopsis,
          instruction: opts.instruction,
          lang: opts.lang,
          model: opts.model,
        },
      }) as AsyncIterable<{ delta?: string; done?: boolean; text?: string; error?: string }>
      for await (const chunk of stream) {
        if ('error' in chunk) { toast.error(chunk.error); break }
        if ('delta' in chunk && chunk.delta) {
          const map = synopsisPendingRef.current
          const slot = map.get(id) ?? { buf: '', done: false }
          slot.buf += chunk.delta
          map.set(id, slot)
          ensureSynopsisFlush()
        } else if ('done' in chunk) {
          const map = synopsisPendingRef.current
          const slot = map.get(id)
          if (slot) { slot.done = true; ensureSynopsisFlush() }
          else { setSynopsisBubbles((prev) => prev.map((b) => b.id === id ? { ...b, text: chunk.text ?? '' } : b)) }
          setSynopsisText(chunk.text ?? '')
          setSynopsisDraft(chunk.text ?? '')
          toast.success('故事梗概已更新')
        }
      }
    } catch (e) {
      toast.error('修改失败')
    } finally {
      setSynopsisStreaming(false)
    }
  }

  async function runScriptEpisode(opts: {
    epIndex: number; sceneCount: number; lang: 'zh' | 'en'; model?: string; autoRunTarget?: number
  }): Promise<void> {
    const { autoRunTarget } = opts
    setEpisodeStreaming(true)
    const id = `ep-${Date.now()}`
    setStreamingBubbleId(id)
    setEpisodeBubbles([{ id, text: '' }])
    // Pre-expand so the episode is visible as soon as it appears
    setExpandedEpisodes((prev) => {
      const next = new Set(prev)
      next.add(opts.epIndex)
      return next
    })
    try {
      const stream = await callEpisode({ data: { ...opts, synopsisText: synopsisText || synopsisDraft } }) as AsyncIterable<{ delta?: string; done?: boolean; text?: string; error?: string }>
      for await (const chunk of stream) {
        if ('error' in chunk) { toast.error(chunk.error); break }
        if ('delta' in chunk && chunk.delta) {
          const map = episodePendingRef.current
          const slot = map.get(id) ?? { buf: '', done: false }
          slot.buf += chunk.delta
          map.set(id, slot)
          ensureEpisodeFlush()
        } else if ('done' in chunk) {
          const map = episodePendingRef.current
          const slot = map.get(id)
          if (slot) { slot.done = true; ensureEpisodeFlush() }
          else { setEpisodeBubbles((prev) => prev.map((b) => b.id === id ? { ...b, text: chunk.text ?? '' } : b)) }
          setData((d) => {
            const others = d.episodeTexts.filter((e) => e.epIndex !== opts.epIndex)
            return {
              ...d,
              episodeTexts: [...others, { epIndex: opts.epIndex, text: chunk.text ?? '' }].sort((a, b) => a.epIndex - b.epIndex),
              nextEpIndex: opts.epIndex + 1,
            }
          })
          // Auto-continue — use autoRunTarget from parameter (NOT data._autoRunTarget which is stale closure)
          if (autoRunTarget && opts.epIndex < autoRunTarget) {
            setTimeout(() => {
              runScriptEpisode({ epIndex: opts.epIndex + 1, sceneCount: opts.sceneCount, lang: opts.lang, autoRunTarget })
            }, 500)
          } else if (autoRunTarget && opts.epIndex >= autoRunTarget && !shownAutoCompleteToastRef.current) {
            shownAutoCompleteToastRef.current = true
            toast.success(`已连续生成至第 ${autoRunTarget} 集，生成完毕`)
          }
          // Auto-scroll to the new episode card
          setTimeout(() => {
            const el = episodeRefs.current[opts.epIndex]
            el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          }, 100)
          // Mark new episodes as expanded so they show content immediately
          setExpandedEpisodes((prev) => {
            const next = new Set(prev)
            next.add(opts.epIndex)
            return next
          })
        }
      }
    } catch (e) {
      toast.error('生成失败')
    } finally {
      setEpisodeStreaming(false)
      setStreamingBubbleId(null)
      // When auto-run completes, set the completion target for the banner
      if (autoRunTarget && opts.epIndex >= autoRunTarget) {
        setAutoRunCompleteTarget(autoRunTarget)
        autoRunTargetRef.current = null
      }
    }
  }

  // Build concatenated text of all episodes before the given index (for context)
  function buildPreviousEpisodesText(epIndex: number): string {
    const prevEps = data.episodeTexts
      .filter((e) => e.epIndex < epIndex)
      .sort((a, b) => a.epIndex - b.epIndex)
    if (!prevEps.length) return ''
    return prevEps.map((e) => `—— 第 ${e.epIndex} 集 ——\n${e.text}`).join('\n\n')
  }

  async function runScriptModify(opts: {
    epIndex: number; instruction: string; currentText: string; synopsisText?: string; previousEpisodesText?: string; lang: 'zh' | 'en'; model?: string
  }): Promise<void> {
    setEpisodeStreaming(true)
    const id = `ep-${Date.now()}`
    setStreamingBubbleId(id)
    setEpisodeBubbles([{ id, text: '' }])
    try {
      const stream = await callRefineEpisode({ data: { ...opts } }) as AsyncIterable<{ delta?: string; done?: boolean; text?: string; error?: string }>
      for await (const chunk of stream) {
        if ('error' in chunk) { toast.error(chunk.error); break }
        if ('delta' in chunk && chunk.delta) {
          const map = episodePendingRef.current
          const slot = map.get(id) ?? { buf: '', done: false }
          slot.buf += chunk.delta
          map.set(id, slot)
          ensureEpisodeFlush()
        } else if ('done' in chunk) {
          const map = episodePendingRef.current
          const slot = map.get(id)
          if (slot) { slot.done = true; ensureEpisodeFlush() }
          else { setEpisodeBubbles((prev) => prev.map((b) => b.id === id ? { ...b, text: chunk.text ?? '' } : b)) }
          setData((d) => {
            const others = d.episodeTexts.filter((e) => e.epIndex !== opts.epIndex)
            const updated = { ...d, episodeTexts: [...others, { epIndex: opts.epIndex, text: chunk.text ?? '' }].sort((a, b) => a.epIndex - b.epIndex) }
            return updated
          })
          toast.success(`第 ${opts.epIndex} 集剧本已修改`)
        }
      }
    } catch (e) {
      toast.error('修改失败')
    } finally {
      setEpisodeStreaming(false)
      setStreamingBubbleId(null)
    }
  }

  async function produce(stage: WorkspaceTab, userPrompt?: string): Promise<unknown> {
    let aiPatch: Partial<WorkspaceData> | null = null
    const trimmed = (userPrompt ?? '').trim()
    const meaningful = trimmed.length >= 4

    // Compute nextEpIndex from existing episodes (survives page refresh)
    const nextEpIndex = data.episodeTexts.length > 0
      ? Math.max(...data.episodeTexts.map((e) => e.epIndex)) + 1
      : 1

    // Check if this is a streaming script generation request (bypass tryAi)
    const isGenerateScript = trimmed.includes('generate_script') || trimmed.includes('生成剧本')
    const isRefineSynopsis = trimmed.startsWith('修改剧本梗概') || trimmed.startsWith('修改梗概')
    // isModifyEpisodeScript: "修改第 X 集剧本" — must be checked before isScriptModify
    const isModifyEpisodeScript = /^修改第\s*\d+\s*集剧本/.test(trimmed)
    const isScriptEpisode = trimmed.includes('生成分镜') || trimmed.includes('生成本集') || trimmed.includes('script_episode') || trimmed.includes('【分场剧本】根据梗概')
    const isScriptContinue = trimmed.includes('连跑') || trimmed.includes('auto_run') || trimmed.includes('自动连跑')
    // isScriptModify must NOT match "修改剧本梗概" or "修改第 X 集剧本"
    const isScriptModify = !isRefineSynopsis && !isModifyEpisodeScript && (trimmed.startsWith('修改剧本') || trimmed.startsWith('修改脚本'))
    const isStreamingScript = isGenerateScript || isRefineSynopsis || isModifyEpisodeScript || isScriptEpisode || isScriptContinue || isScriptModify

    // Detect "从第 X 集提取角色和场景" pattern (used by episodes tab extract button)
    const isExtractFromEpisode = /^从第\s*\d+\s*集提取/.test(trimmed)
    const extractEpMatch = trimmed.match(/^从第\s*(\d+)\s*集提取/)
    const extractEpIndex = extractEpMatch ? Number(extractEpMatch[1]) : 0

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

    // For streaming script generations, capture the promise before setState
    let scriptPromise: Promise<void> | undefined
    // Allow modify operations from both 'script' and 'episodes' tabs
    const isModifyOp = isModifyEpisodeScript || isRefineSynopsis
    if (isStreamingScript && (stage === 'script' || (isModifyOp && stage === 'episodes'))) {
      if (isGenerateScript) {
        const typeMatch = trimmed.match(/类型[：:]\s*([^\n，,]+)/) ?? trimmed.match(/Type[：:]\s*([^\n，,]+)/)
        const genreLineMatch = trimmed.match(/题材[：:]\s*([^\n]+)/) ?? trimmed.match(/Genre[：:]\s*([^\n]+)/)
        const toneLineMatch = trimmed.match(/风格[：:]\s*([^\n]+)/) ?? trimmed.match(/Tone[：:]\s*([^\n]+)/)
        const epMatch = trimmed.match(/预计集数[：:]\s*(\d+)/) ?? trimmed.match(/Expected episodes[：:]\s*(\d+)/)
        const minMatch = trimmed.match(/总时长[：:]\s*(\d+)/) ?? trimmed.match(/Total duration[：:]\s*(\d+)/)
        const themeMatch = trimmed.match(/主题[：:]\s*([^\n，,]+)/) ?? trimmed.match(/Theme[：:]\s*([^\n，,]+)/)
        const plotMatch = trimmed.match(/剧情[：:]\s*([^\n]+)/) ?? trimmed.match(/Plot[：:]\s*([^\n]+)/)
        scriptPromise = runScriptSynopsis({
          type: typeMatch?.[1] ?? 'Short',
          genre: genreLineMatch?.[1] ?? 'Drama',
          tone: toneLineMatch?.[1] ?? 'Serious',
          theme: themeMatch?.[1] ?? data.outline?.logline ?? '',
          plot: plotMatch?.[1] ?? trimmed,
          expectedEpisodes: Number(epMatch?.[1]) || 30,
          totalMinutes: Number(minMatch?.[1]) || 90,
          lang: 'zh',
        })
      } else if (isScriptEpisode) {
        const scMatch = trimmed.match(/分镜数[：:]\s*(\d+)/) ?? trimmed.match(/Storyboards[：:]\s*(\d+)/)
        const sceneCount = Number(scMatch?.[1]) || data.nextSceneCount
        scriptPromise = runScriptEpisode({ epIndex: nextEpIndex, sceneCount, lang: 'zh' })
      } else if (isModifyEpisodeScript) {
        const epMatch = trimmed.match(/^修改第\s*(\d+)\s*集剧本\n?/)
        const epIndex = Number(epMatch?.[1]) || selectedEpisodeIndex
        const instruction = trimmed.replace(/^修改第\s*\d+\s*集剧本\n?/, '')
        const currentEp = data.episodeTexts.find((e) => e.epIndex === epIndex)
        if (currentEp) {
          scriptPromise = runScriptModify({
            epIndex, instruction, currentText: currentEp.text,
            synopsisText: synopsisText || synopsisDraft,
            previousEpisodesText: buildPreviousEpisodesText(epIndex),
            lang: 'zh',
          })
        }
      } else if (isRefineSynopsis) {
        const instruction = trimmed.replace(/^修改剧本梗概\n?/, '').replace(/^修改梗概\n?/, '')
        scriptPromise = runRefineSynopsis({ instruction, lang: 'zh' })
      } else if (isScriptContinue) {
        shownAutoCompleteToastRef.current = false
        setAutoRunCompleteTarget(null) // Clear previous completion state
        const targetEpMatch = trimmed.match(/连跑至第?\s*(\d+)/) ?? trimmed.match(/targetEp[：:]\s*(\d+)/)
        const targetEp = Number(targetEpMatch?.[1]) || Math.min(nextEpIndex + 4, 30)
        // Extract scene count from prompt (e.g. "分镜数：5" or "分镜数: 5")
        const scMatch = trimmed.match(/分镜数[：:]\s*(\d+)/) ?? trimmed.match(/Storyboards[：:]\s*(\d+)/)
        const sceneCount = Number(scMatch?.[1]) || data.nextSceneCount
        // Store in ref so it can be read without stale closure
        autoRunTargetRef.current = targetEp
        // Pass autoRunTarget as parameter to avoid stale closure bug
        scriptPromise = runScriptEpisode({ epIndex: nextEpIndex, sceneCount, lang: 'zh', autoRunTarget: targetEp })
      } else if (isScriptModify) {
        const instruction = trimmed.replace(/^修改剧本\n?/, '').replace(/^修改脚本\n?/, '')
        const epIndex = nextEpIndex > 1 ? nextEpIndex - 1 : 1
        const currentEp = data.episodeTexts.find((e) => e.epIndex === epIndex)
        if (currentEp) {
          scriptPromise = runScriptModify({
            epIndex, instruction, currentText: currentEp.text,
            synopsisText: synopsisText || synopsisDraft,
            previousEpisodesText: buildPreviousEpisodesText(epIndex),
            lang: 'zh',
          })
        }
      }
    }

    // Skip tryAi for streaming script generations — those are handled separately above
    if (meaningful && !isStreamingScript && (stage === 'canvas' || stage === 'script' || stage === 'character' || stage === 'storyboard' || stage === 'timeline')) {
      aiPatch = await tryAi(stage, trimmed, snapshot)
    }

    // Extract characters + scenes from a specific episode (dual AI calls)
    if (isExtractFromEpisode && extractEpIndex > 0) {
      const epText = data.episodeTexts.find((e) => e.epIndex === extractEpIndex)?.text ?? ''
      if (epText) {
        const extractPrompt = `以下是第 ${extractEpIndex} 集的剧本内容，请只提取本集中出现的角色和主要场景：\n\n${epText}`
        const [charResult, sceneResult] = await Promise.all([
          tryAi('character', extractPrompt, snapshot),
          tryAi('script', extractPrompt, snapshot),
        ])
        aiPatch = {
          ...(charResult ?? {}),
          ...(sceneResult ?? {}),
        }
      }
    }

    setData((d) => {
      switch (stage) {
        case 'canvas':
          return { ...d, outline: aiPatch?.outline ?? generateOutline() }
        case 'script': {
          if (isGenerateScript || isRefineSynopsis || isModifyEpisodeScript || isScriptEpisode || isScriptContinue || isScriptModify) {
            return d
          }
          return d
        }
        case 'episodes': {
          return d
        }
        case 'character': {
          // Extract from episode: apply both characters and scenes
          if (isExtractFromEpisode && aiPatch) {
            const patch: Partial<WorkspaceData> = {}
            if (aiPatch.characters) patch.characters = aiPatch.characters
            if (aiPatch.scenes) patch.scenes = aiPatch.scenes
            return { ...d, ...patch }
          }
          return { ...d, characters: aiPatch?.characters ?? generateCharacters() }
        }
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

    return scriptPromise
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
          {tab === 'episodes' && <EpisodesView />}
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
          locked={episodeStreaming && autoRunTargetRef.current != null}
          selectedEpisodeIndex={selectedEpisodeIndex}
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
                <div><dt className="text-xs uppercase tracking-wide text-text-muted">性别</dt><dd className="text-text-secondary mt-0.5">{previewChar.gender}</dd></div>
                <div><dt className="text-xs uppercase tracking-wide text-text-muted">年龄</dt><dd className="text-text-secondary mt-0.5">{previewChar.age}</dd></div>
                <div><dt className="text-xs uppercase tracking-wide text-text-muted">面部</dt><dd className="text-text-secondary mt-0.5">{previewChar.faceDescription}</dd></div>
                <div><dt className="text-xs uppercase tracking-wide text-text-muted">身材</dt><dd className="text-text-secondary mt-0.5">{previewChar.bodyDescription}</dd></div>
                <div><dt className="text-xs uppercase tracking-wide text-text-muted">服装</dt><dd className="text-text-secondary mt-0.5">{previewChar.clothingDescription}</dd></div>
                <div><dt className="text-xs uppercase tracking-wide text-text-muted">性格</dt><dd className="text-text-secondary mt-0.5">{previewChar.personality}</dd></div>
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
    const hasSynopsis = synopsisText || synopsisDraft
    const hasEpisodes = data.episodeTexts.length > 0
    const isAutoRunning = autoRunCompleteTarget != null && !episodeStreaming
    // Find the currently streaming episode's bubble text
    const streamingBubble = streamingBubbleId ? episodeBubbles.find((b) => b.id === streamingBubbleId) : null

    if (!hasSynopsis && !hasEpisodes) {
      return (
        <div className="max-w-4xl mx-auto panel p-10 text-center">
          <p className="text-text-muted text-sm">{t.ws_script_empty}</p>
        </div>
      )
    }

    return (
      <div className="max-w-5xl mx-auto space-y-6 pb-4">
        {/* 故事梗概 */}
        {hasSynopsis && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-bold">故事梗概</h3>
              {synopsisStreaming && (
                <span className="inline-flex items-center gap-1.5 text-xs text-accent">
                  <Loader2 size={11} className="animate-spin" /> 生成中…
                </span>
              )}
            </div>
            <textarea
              value={synopsisDraft}
              onChange={(e) => setSynopsisDraft(e.target.value)}
              rows={24}
              className="w-full rounded-lg bg-bg-elevated border border-border text-sm text-text-primary p-3 leading-7 font-mono focus:outline-none focus:border-accent/50 resize-y overflow-auto"
              style={{ maxHeight: '70vh' }}
              placeholder="编辑故事梗概…"
            />
          </div>
        )}

        {/* 自动连跑完成提示 */}
        {isAutoRunning && autoRunCompleteTarget && (
          <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-accent/20 border border-accent/40 text-sm text-accent">
            <Sparkles size={14} />
            <span>已连续生成至第 {autoRunCompleteTarget} 集，生成完毕</span>
          </div>
        )}

        {/* 分集内容 — 纯 div + React state 控制折叠，onClick 仅在 header 上，无嵌套交互元素 */}
        {data.episodeTexts.map((ep) => {
          // Show streaming bubble text if this episode is currently streaming
          const computedNextEp = data.episodeTexts.length > 0 ? Math.max(...data.episodeTexts.map((e) => e.epIndex)) + 1 : 1
          const isThisStreaming = episodeStreaming && !!streamingBubble && ep.epIndex === computedNextEp - 1
          const displayText = isThisStreaming && streamingBubble?.text
            ? streamingBubble.text
            : ep.text
          const isExpanded = expandedEpisodes.has(ep.epIndex)
          return (
            <div
              key={ep.epIndex}
              ref={(el) => { episodeRefs.current[ep.epIndex] = el as HTMLDetailsElement | null }}
              className="panel p-0"
            >
              <div
                role="button"
                tabIndex={0}
                className="flex items-center gap-2 px-5 py-4 cursor-pointer text-base font-semibold hover:bg-bg-elevated select-none"
                onClick={() => {
                  setExpandedEpisodes((prev) => {
                    const next = new Set(prev)
                    if (next.has(ep.epIndex)) next.delete(ep.epIndex)
                    else next.add(ep.epIndex)
                    return next
                  })
                }}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') e.currentTarget.click() }}
              >
                <span className={`text-accent shrink-0 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
                <span className="flex-1">第 {ep.epIndex} 集</span>
                {isThisStreaming && (
                  <span className="inline-flex items-center gap-1 text-xs text-accent">
                    <Loader2 size={10} className="animate-spin" /> 生成中…
                  </span>
                )}
                <span className="px-2 py-1 rounded-md bg-bg-elevated border border-border text-text-muted text-xs">
                  {isExpanded ? '折叠' : '展开'}
                </span>
              </div>
              {isExpanded && displayText ? (
                <div className="px-5 pb-5 prose prose-invert prose-sm max-w-none text-text-primary whitespace-pre-wrap leading-relaxed text-sm">
                  <ReactMarkdown>{displayText}</ReactMarkdown>
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    )
  }

  function EpisodesView() {
    const episodes = data.episodeTexts
    // Auto-select latest episode when entering this tab
    useEffect(() => {
      if (episodes.length > 0 && !episodes.some((ep) => ep.epIndex === selectedEpisodeIndex)) {
        setSelectedEpisodeIndex(episodes[episodes.length - 1].epIndex)
      }
    }, [episodes, selectedEpisodeIndex])

    if (!episodes.length) {
      return (
        <div className="max-w-4xl mx-auto panel p-10 text-center">
          <p className="text-text-muted text-sm">{t.ws_episodes_empty}</p>
        </div>
      )
    }

    const selectedEp = episodes.find((ep) => ep.epIndex === selectedEpisodeIndex) ?? episodes[episodes.length - 1]

    return (
      <div className="max-w-5xl mx-auto space-y-6 pb-4">
        {/* 集数选择网格 */}
        <div>
          <h3 className="font-display text-lg font-bold mb-3">{t.ws_episodes_select}</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {episodes.map((ep) => {
              const active = ep.epIndex === selectedEp.epIndex
              const preview = ep.text.slice(0, 80)
              return (
                <button
                  key={ep.epIndex}
                  onClick={() => setSelectedEpisodeIndex(ep.epIndex)}
                  className={`p-3 rounded-xl border text-left transition ${
                    active
                      ? 'border-accent bg-accent-dim/40 shadow-glow'
                      : 'border-border bg-bg-elevated/60 hover:border-accent/50'
                  }`}
                >
                  <div className="font-semibold text-sm mb-1">第 {ep.epIndex} 集</div>
                  <div className="text-xs text-text-muted line-clamp-3 leading-relaxed">{preview}…</div>
                </button>
              )
            })}
          </div>
        </div>

        {/* 选中集数的完整剧本 */}
        {selectedEp && (
          <div className="panel p-0">
            <div className="flex items-center gap-2 px-5 py-4 border-b border-border">
              <span className="text-accent font-bold">▶</span>
              <span className="font-display text-base font-semibold">第 {selectedEp.epIndex} 集 · {t.ws_episodes_script}</span>
            </div>
            <div className="px-5 pb-5 pt-4 prose prose-invert prose-sm max-w-none text-text-primary whitespace-pre-wrap leading-relaxed text-sm">
              <ReactMarkdown>{selectedEp.text}</ReactMarkdown>
            </div>
          </div>
        )}
      </div>
    )
  }

  function CharacterView() {
    const hasChars = data.characters.length > 0
    const hasScenes = data.scenes.length > 0

    if (!hasChars && !hasScenes) {
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

    const SCENE_TIME_LABELS: Record<string, string> = { DAY: '日', NIGHT: '夜', DUSK: '黄昏', DAWN: '黎明' }

    return (
      <div className="-m-6 h-[calc(100vh-3rem)] flex flex-col">
        {/* Toggle bar */}
        <div className="flex items-center gap-2 px-6 pt-4 pb-2 shrink-0">
          <button
            onClick={() => setCharViewTab('characters')}
            className={`px-4 py-1.5 rounded-full text-sm font-semibold transition border ${
              charViewTab === 'characters'
                ? 'bg-accent-dim text-accent border-accent'
                : 'border-border text-text-secondary hover:text-text-primary hover:bg-bg-elevated'
            }`}
          >
            角色 {hasChars && `(${data.characters.length})`}
          </button>
          <button
            onClick={() => setCharViewTab('scenes')}
            className={`px-4 py-1.5 rounded-full text-sm font-semibold transition border ${
              charViewTab === 'scenes'
                ? 'bg-accent-dim text-accent border-accent'
                : 'border-border text-text-secondary hover:text-text-primary hover:bg-bg-elevated'
            }`}
          >
            场景 {hasScenes && `(${data.scenes.length})`}
          </button>
        </div>

        {/* Content area */}
        <div className="flex-1 overflow-y-auto snap-y snap-mandatory min-h-0">
          {charViewTab === 'scenes' ? (
            /* Scenes view */
            hasScenes ? (
              <div className="px-6 py-4 space-y-4">
                {data.scenes.map((s) => (
                  <div key={s.id} className="panel p-5 space-y-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs text-text-muted">SC {s.index}</span>
                      <h3 className="font-display text-lg font-bold text-text-primary">{s.slug}</h3>
                      <span className="text-xs px-2 py-0.5 rounded-full border border-border bg-bg-elevated text-text-muted">
                        {SCENE_TIME_LABELS[s.timeOfDay] ?? s.timeOfDay}
                      </span>
                      {busyScene === s.id && (
                        <span className="inline-flex items-center gap-1 text-xs text-accent">
                          <Loader2 size={10} className="animate-spin" /> 生成中…
                        </span>
                      )}
                    </div>
                    {/* Scene image — location only, no characters */}
                    {sceneImages[s.id] ? (
                      <div className="rounded-lg overflow-hidden border border-border">
                        <img src={sceneImages[s.id]} alt={s.slug} className="w-full aspect-video object-cover" />
                      </div>
                    ) : !busyScene ? (
                      <button
                        onClick={() => genSceneImage(s)}
                        className="w-full aspect-video rounded-lg border-2 border-dashed border-border flex items-center justify-center text-text-muted text-sm hover:border-accent hover:text-accent transition"
                      >
                        点击生成场景图
                      </button>
                    ) : null}
                    <p className="text-sm text-text-secondary leading-relaxed">{s.action}</p>
                    {s.beats.length > 0 && (
                      <ul className="space-y-1 text-sm">
                        {s.beats.map((b, i) => (
                          <li key={i} className="flex gap-2 text-text-secondary"><span className="text-accent shrink-0">·</span><span>{b}</span></li>
                        ))}
                      </ul>
                    )}
                    {s.dialogue.length > 0 && (
                      <div className="space-y-1.5 pt-1 border-t border-border/50">
                        {s.dialogue.map((d, i) => (
                          <div key={i} className="text-sm">
                            <span className="font-semibold text-text-primary">{d.role}</span>
                            {d.parenthetical && <span className="text-text-muted text-xs ml-1">({d.parenthetical})</span>}
                            <span className="text-text-secondary">："{d.line}"</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center justify-center h-full">
                <p className="text-text-muted text-sm">暂无场景数据，请先提取角色和场景。</p>
              </div>
            )
          ) : hasChars ? (
            /* Characters view (existing) */
            <>
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
                              ? ['半身', '面部', '表情', '服装']
                              : selectedViewCount === 'full'
                                ? ['半身', '面部', '表情', '服装', '细节']
                                : ['半身', '特写']
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
        </>
      ) : (
        <div className="flex items-center justify-center h-full">
          <p className="text-text-muted text-sm">暂无角色数据，请先提取角色和场景。</p>
        </div>
      )}
        </div>
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
      { label: '性别', value: character.gender },
      { label: '年龄', value: String(character.age) },
      { label: '面部', value: character.faceDescription },
      { label: '身材', value: character.bodyDescription },
      { label: '服装', value: character.clothingDescription },
      { label: '性格', value: character.personality },
    ].filter((r) => r.value)
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
