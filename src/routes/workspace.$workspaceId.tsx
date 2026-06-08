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
  type Outline, type GenScene, type GenCharacter, type GenCharacterLook, type StoryboardPanel, type TimelineData, type TimelineTrack, type TimelineClip,
  type StoryboardGroup, type StoryboardShot, type ShotType,
} from '../data/workspaceGenerators'
import { generateStageAi } from '../lib/aiGenerate.functions'
import { generateImage } from '../lib/openrouterImage.functions'
import { regenerateCharacterLook } from '../lib/characterRegen.functions'
import { generateStoryboardFromPlot, generateStoryboardShotImage, regenerateStoryboardShot } from '../lib/storyboard.functions'
import { getProject, saveWorkspaceData, loadWorkspaceData, type ProjectConfigRow } from '../lib/projects.functions'
import { streamSynopsis, streamEpisodeScenes, refineSynopsis, refineEpisodeScenes } from '../lib/scriptAgent.functions'
import type { ImportedScriptResult } from '../lib/parseImportedScript.functions'
import { resolveProjectStyle, resolveT2IModel, resolveI2IModel } from '../lib/visualStyles'
import { Maximize2, FileText, Camera, Clock, Users, X, Loader2, Sparkles, Send, CheckCircle2, Pencil, Check, Image as ImageIcon, LayoutGrid, RefreshCw } from 'lucide-react'
import CharacterPortrait from '../components/workspace/CharacterPortrait'
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
  /**
   * 由 AI 从当集剧情切分出来的分镜组(每组 1~3 个镜头)。这是新的"分镜编辑"
   * 流程的主数据,跟旧 storyboard 字段并存,UI 上替换了 storyboard 视图。
   */
  storyboardGroups: StoryboardGroup[]
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
  storyboardGroups: [],
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

// Module-scope: defined once, stable component identity across renders.
// Defining these inside WorkspacePage made them "new" components on every render,
// which caused React to unmount/remount and lose textarea cursor + IME state.
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

function WorkspacePage() {
  const { t } = useLanguage()
  const { user } = useAuth()
  const [tab, setTab] = useState<WorkspaceTab>('canvas')
  const [collapsed, setCollapsed] = useState(false)
  const [data, setData] = useState<WorkspaceData>(emptyData)
  const [flash, setFlash] = useState<WorkspaceTab | null>(null)
  // 预览态:记录角色 + 当前选中的 look(null 表示默认)。每个 look 是独立卡片,
  // 预览时也要展示对应 look 的图和服装描述。
  const [previewTarget, setPreviewTarget] = useState<{ character: GenCharacter; lookId: string | null } | null>(null)
  // 预览内"按意见重生"流程的本地状态(不持久化,关闭预览即清空)。
  //   selectedGenIdx: 当前看的是该 look 的第几代(0..history.length-1)
  //   regenInput: 用户输入的修改意见
  //   regenBusy: 正在调用 regenerateCharacterLook
  const [selectedGenIdx, setSelectedGenIdx] = useState(0)
  const [regenInput, setRegenInput] = useState('')
  const [regenBusy, setRegenBusy] = useState(false)

  // 右侧"修改形象"slide-in 面板:点卡片上的"修改"按钮打开,
  // 输入修改意见 → 发送 → 关闭面板,新图替换卡片封面(并加入历史)。
  //   modPanel: 当前要修改的 (角色, look);null 表示面板关闭
  //   modInput: 文本框
  //   modBusy: 正在调用 regenerateCharacterLook
  //   modError: 上次错误(显示在面板里)
  const [modPanel, setModPanel] = useState<
    | { character: GenCharacter; lookId: string | null; imageKey: string }
    | null
  >(null)
  const [modInput, setModInput] = useState('')
  const [modBusy, setModBusy] = useState(false)
  const [modError, setModError] = useState<string | null>(null)
  const callAi = useServerFn(generateStageAi)
  const callImage = useServerFn(generateImage)
  const callRegenCharacter = useServerFn(regenerateCharacterLook)
  const callGenerateStoryboard = useServerFn(generateStoryboardFromPlot)
  const callGenerateShotImage = useServerFn(generateStoryboardShotImage)
  const callRegenShot = useServerFn(regenerateStoryboardShot)
  const callSynopsis = useServerFn(streamSynopsis)
  const callEpisode = useServerFn(streamEpisodeScenes)
  const callRefine = useServerFn(refineSynopsis)
  const callRefineEpisode = useServerFn(refineEpisodeScenes)
  const loadProject = useServerFn(getProject)
  const callSaveWorkspace = useServerFn(saveWorkspaceData)
  const callLoadWorkspace = useServerFn(loadWorkspaceData)
  const [project, setProject] = useState<ProjectConfigRow | null>(null)
  const [savingWorkspace, setSavingWorkspace] = useState(false)
  const [savedWorkspace, setSavedWorkspace] = useState(false)
  const [dataLoaded, setDataLoaded] = useState(false)
  const autoSavedRef = useRef(false)
  const [charImages, setCharImages] = useState<Record<string, string[]>>({})
  // charImages 的镜像 ref:processCharacter 内部循环里要"看最新"以跳过已
  // 生成的图。React state 闭包是快照,useRef 才是实时的。
  const charImagesRef = useRef<Record<string, string[]>>({})
  useEffect(() => { charImagesRef.current = charImages }, [charImages])
  const [panelImages, setPanelImages] = useState<Record<string, string>>({})
  const [sceneImages, setSceneImages] = useState<Record<string, string>>({})
  // 角色图片生成状态拆分:
  //   activeImageKey: 当前**正在生成**的那一张图(imageKey = c.id 或 c.id::lk.id)。
  //                   用于卡片显示 spinner(只有这一张是"生成中"状态)。
  //   busyChars:      任何"有未完成 work 的"角色 ID 集合。Set 用来支持
  //                   "不同角色并行,同一角色串行":一旦某个角色开始处理,
  //                   加入 Set;处理完所有 looks 后移出 Set。
  //   卡片判定:
  //     activeImageKey === imageKey        → spinner(此刻正在画这张)
  //     busyChars.has(c.id) && !active     → "排队中..."(同角色下一张,或别人正在画)
  //     hasImg                              → 显示图片
  //     其他                                → "点击生成形象" 或 "排队生成中..."
  const [activeImageKey, setActiveImageKey] = useState<string | null>(null)
  const [busyChars, setBusyChars] = useState<Set<string>>(new Set())
  const [busyPanel, setBusyPanel] = useState<string | null>(null)
  const [busyScene, setBusyScene] = useState<string | null>(null)
  // 新的"分镜组"流程:正在生成 StoryboardGroup(整集切分)的标识
  const [busyStoryboardGen, setBusyStoryboardGen] = useState(false)
  // 正在跑"对某个分镜组的某张分镜图做多图融合"的 key,格式 `${groupId}::${shotId}`
  const [busyShotImages, setBusyShotImages] = useState<Set<string>>(new Set())
  // I2I 重生(按意见重生 / 三视图 / 多维资产)正在跑的卡片 imageKey → mode 映射。
  // 跟 activeImageKey(T2I 通道)是两套独立的状态,因为它们发生在不同时间窗口:
  //   T2I:首张图还没出,用户进不去 regen
  //   I2I:首张图已出,用户点三视图/多维资产/修改
  // 在 regen 期间给对应卡片加黑屏遮罩(spinner + "正在生成三视图" 等),
  // 防止用户重复点 / 让进度可感知。value 存 mode 用来显示对应的提示文字。
  const [regenBusyKeys, setRegenBusyKeys] = useState<Map<string, 'modify' | 'three-view' | 'multi-asset'>>(new Map())
  const [autoGen, setAutoGen] = useState(true)
  void setAutoGen
  // 流式剧本生成状态
  const [synopsisText, setSynopsisText] = useState('')
  const [synopsisDraft, setSynopsisDraft] = useState('')
  const [synopsisEditing, setSynopsisEditing] = useState(false)
  const synopsisEditRef = useRef<HTMLTextAreaElement>(null)
  const [expandedEpisodes, setExpandedEpisodes] = useState<Set<number>>(new Set([1]))
  const [episodeEditing, setEpisodeEditing] = useState<number | null>(null)
  const [episodeDraft, setEpisodeDraft] = useState('')
  const episodeEditRef = useRef<HTMLTextAreaElement>(null)
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
  const episodeCardRefs = useRef<Record<number, HTMLButtonElement | null>>({})
  const shownAutoCompleteToastRef = useRef(false)
  const autoRunTargetRef = useRef<number | null>(null)
  const [autoRunCompleteTarget, setAutoRunCompleteTarget] = useState<number | null>(null)
  const [selectedEpisodeIndex, setSelectedEpisodeIndex] = useState<number>(1)
  const [charViewTab, setCharViewTab] = useState<'characters' | 'scenes'>('characters')
  // 顶部下拉「+ 新增集数」触发的对话框。AI 生成 / 导入剧本 两条路径都走这里。
  const [addEpisodeOpen, setAddEpisodeOpen] = useState(false)
  const [addEpisodeImporting, setAddEpisodeImporting] = useState(false)
  const addEpisodeFileInputRef = useRef<HTMLInputElement>(null)
  // 分镜图历史 + 预览/修改态(和人物卡片同一套思路)
  //   - shotImages:key = `${groupId}::${shotId}`,value 是按时间顺序的 URL 数组
  //     (首先生成的在最前,最新生成的或按意见重生的在末尾)。
  //   - shotPreview:当前正在预览哪张镜头(null = 关闭)。
  //   - shotSelectedGenIdx:预览里选中的第几代(和 selectedGenIdx 同语义)。
  //   - shotModInput / shotModBusy:修改意见的输入 + 是否在调 regenerateStoryboardShot。
  const [shotImages, setShotImages] = useState<Record<string, string[]>>({})
  const [shotPreview, setShotPreview] = useState<{ groupId: string; shotId: string } | null>(null)
  const [shotSelectedGenIdx, setShotSelectedGenIdx] = useState(0)
  const [shotModInput, setShotModInput] = useState('')
  const [shotModBusy, setShotModBusy] = useState(false)
  const workspaceId = Route.useParams().workspaceId
  useEffect(() => {
    let cancelled = false
    loadProject({ data: { id: workspaceId } })
      .then((r) => { if (!cancelled && r.project) setProject(r.project) })
      .catch(() => {})
    // Load persisted workspace data
    callLoadWorkspace({ data: { id: workspaceId } })
      .then((r: any) => {
        if (cancelled || r.error || !r.workspaceData) return
        const wd = r.workspaceData as Record<string, any>
        if (wd.outline) setData((d) => ({ ...d, outline: wd.outline as WorkspaceData['outline'] }))
        // 兼容旧数据:旧版 characters/scenes/storyboardGroups 没有 episodeIndex 字段,
        // 一律默认 1(旧版没有按集分角色的概念,所有内容都属于第 1 集)。
        if (Array.isArray(wd.scenes) && wd.scenes.length) {
          const scenes: GenScene[] = (wd.scenes as any[]).map((s) => ({ ...s, episodeIndex: typeof s.episodeIndex === 'number' ? s.episodeIndex : 1 }))
          setData((d) => ({ ...d, scenes }))
        }
        if (Array.isArray(wd.characters) && wd.characters.length) {
          const characters: GenCharacter[] = (wd.characters as any[]).map((c) => ({ ...c, episodeIndex: typeof c.episodeIndex === 'number' ? c.episodeIndex : 1 }))
          setData((d) => ({ ...d, characters }))
        }
        if (Array.isArray(wd.storyboard) && wd.storyboard.length) setData((d) => ({ ...d, storyboard: wd.storyboard as StoryboardPanel[] }))
        if (Array.isArray(wd.storyboardGroups) && wd.storyboardGroups.length) {
          const storyboardGroups: StoryboardGroup[] = (wd.storyboardGroups as any[]).map((g) => ({ ...g, episodeIndex: typeof g.episodeIndex === 'number' ? g.episodeIndex : 1 }))
          setData((d) => ({ ...d, storyboardGroups }))
          // 老数据没有 shotImages 字段 —— 从每个 group.shots[i].imageUrl 一次性回填,
          // 这样旧项目的"分镜图历史"也能在打开预览时看到(至少有 1 张)。
          // 已经被新数据覆盖过(wd.shotImages 存在)的就不动。
          if (!wd.shotImages) {
            const migrated: Record<string, string[]> = {}
            for (const g of storyboardGroups) {
              for (const s of g.shots) {
                if (s.imageUrl) {
                  migrated[`${g.id}::${s.id}`] = [s.imageUrl]
                }
              }
            }
            if (Object.keys(migrated).length) setShotImages(migrated)
          }
        }
        if (wd.timeline) setData((d) => ({ ...d, timeline: wd.timeline as WorkspaceData['timeline'] }))
        if (typeof wd.synopsisText === 'string' && wd.synopsisText) {
          setSynopsisText(wd.synopsisText)
          setSynopsisDraft(wd.synopsisText)
        }
        if (Array.isArray(wd.episodeTexts) && wd.episodeTexts.length) {
          setData((d) => ({ ...d, episodeTexts: wd.episodeTexts as WorkspaceData['episodeTexts'] }))
        }
        if (wd.charImages) setCharImages(wd.charImages as Record<string, string[]>)
        if (wd.shotImages) setShotImages(wd.shotImages as Record<string, string[]>)
        if (wd.panelImages) setPanelImages(wd.panelImages as Record<string, string>)
        if (wd.sceneImages) setSceneImages(wd.sceneImages as Record<string, string>)
        setDataLoaded(true)
      })
      .catch(() => { setDataLoaded(true) })
    return () => { cancelled = true }
  }, [workspaceId, loadProject, callLoadWorkspace])

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

  /**
   * 处理单个角色的所有 look(默认 + looks[]),内部**串行**——同角色不同
   * 服装必须按顺序走,这样 LLM 看到前一张的"脸锁定"记忆时不会被打断。
   * 跨角色由 useEffect 通过 Promise.all 并行触发,实现"不同角色并行 / 同
   * 角色串行"的要求。
   */
  async function processCharacter(c: GenCharacter) {
    // 拉平成 lookSpecs。key 为图片存储 key(imageKey),label 用于 toast/标题。
    const lookSpecs: { imageKey: string; label: string; data: { faceDescription: string; bodyDescription: string; clothingDescription: string } }[] = [
      { imageKey: c.id, label: '默认', data: { faceDescription: c.faceDescription, bodyDescription: c.bodyDescription, clothingDescription: c.clothingDescription } },
      ...(c.looks ?? []).map((lk) => ({
        imageKey: `${c.id}::${lk.id}`,
        label: lk.label,
        // 脸和身材沿用主条目,clothingDescription 用 look 自己的
        data: { faceDescription: lk.faceDescription || c.faceDescription, bodyDescription: lk.bodyDescription || c.bodyDescription, clothingDescription: lk.clothingDescription || c.clothingDescription },
      })),
    ]

    for (const ls of lookSpecs) {
      // 跳过已经生成过的(可能在并发期间被其他 useEffect 跑过)
      const currentImages = charImagesRef.current
      if (currentImages[ls.imageKey]?.length) continue

      setActiveImageKey(ls.imageKey)
      try {
        // 解析项目视觉风格。每个 look 共享项目风格(项目级美术指导),但只换衣服/身份。
        const styleSpec = resolveProjectStyle(project?.style)
        const paletteLine = c.palette?.length
          ? `signature color palette (must appear in clothing / accessories): ${c.palette.join(', ')}`
          : ''
        const cardTitle = ls.label === '默认' ? c.name : `${c.name} · ${ls.label}`
        // ====================================================================
        // 角色主视图 prompt(v3 —— 强制版)
        //   设计要点(解决反复出现的"半身 / 切脚 / 无腿"问题):
        //   1) 用电影/摄影术语 "full shot / long shot / full-length portrait",
        //      这些词在模型训练数据里出现频率高,语义明确,比抽象的
        //      "head-to-toe" 触发全身构图的成功率更高。
        //   2) 用"character occupies 85-95% of canvas height"等比例语言,模型
        //      对百分比比绝对像素更敏感。
        //   3) 把画布几何用坐标 (y=80 head, y=1392 feet) 写出来,模型按此
        //      排版时几乎不会切脚。
        //   4) 用"step-by-step"让模型先生成画布再放人物,而不是默认塞中间。
        //   5) 末尾"FINAL CHECK"让模型生成前做一次自检,自检不通过就重画。
        //   6) negative_prompt 把"半身/切脚"近义词全覆盖,多写一份冗余。
        // ====================================================================
        const prompt = [
          // 任务一句话(强指令,放最前)
          `Generate ONE full-body head-to-toe character reference image of "${cardTitle}" — a ${c.roleLabel}, age ${c.age}.`,
          ``,
          // 摄影术语 + 镜头类型
          `SHOT TYPE: Full shot (FS) / long shot (LS) / full-length portrait — the same framing used in fashion catalog full-body shots, character design turnaround sheets, model sheets, and costume reference sheets.`,
          ``,
          // 画布几何(显式坐标)
          `CANVAS GEOMETRY: The image is a 3:4 portrait-orientation canvas (taller than wide), 1104 wide × 1472 tall. The character's full standing figure occupies 85-95% of the canvas height — from y≈80 (top of head) to y≈1392 (soles of feet). The remaining 5-15% is split as small white margin above the head AND below the feet. The figure does NOT touch the top or bottom edge of the frame.`,
          ``,
          // 构图步骤
          `COMPOSITION STEPS (apply in this order):
  1. Reserve a 3:4 portrait canvas (taller than wide).
  2. Place the character dead-center horizontally.
  3. Place the top of the head at y ≈ 80 pixels (5% margin from the top).
  4. Place the soles of the feet at y ≈ 1392 pixels (5% margin from the bottom).
  5. The character body is 1312 pixels tall — a full-body figure that fills the vertical axis.
  6. Both feet are clearly visible at the bottom of the frame. Both hands are visible at the sides.`,
          ``,
          // 硬约束(列出所有失败模式)
          `HARD CONSTRAINTS — the image is REJECTED if ANY of these is true:
  • The image is a half-body, waist-up, hip-up, chest-up, shoulder-up, knee-up, cowboy shot, or head-and-shoulders crop.
  • The head or top of the hair is cut off at the top of the frame.
  • The feet or shoes are cut off at the bottom of the frame.
  • The character is floating with no visible feet, or the lower body fades into the background.
  • The body extends beyond the frame edge.
  • The character occupies less than 80% of the canvas height.
  • The body touches the top or bottom edge of the image.`,
          ``,
          // 镜头角度
          `CAMERA: Dead-on front view, eye-level. Both eyes fully visible, looking at the camera. Arms relaxed at the sides, feet slightly apart. No low angle, no worm's-eye view, no high angle, no tilted camera.`,
          ``,
          // 表情
          `EXPRESSION: Neutral, expressionless, like a passport photo. No smile, no frown, no emotion, eyes open.`,
          ``,
          // 背景
          `BACKGROUND: 100% pure white #FFFFFF. No scenery, no floor, no shadow, no gradient, no vignette, no horizon line.`,
          ``,
          // 视觉风格
          `VISUAL STYLE: ${styleSpec.label}. Render the character in this exact style. ${styleSpec.positive}. Avoid: ${styleSpec.negative}.`,
          ``,
          // 多 outfit 一致性
          `FACE / BODY LOCK: "${c.name}" has multiple outfit variants. The face and body MUST remain identical across all variants. Only the outfit changes. Treat the FACE / BODY descriptions below as the single source of truth.`,
          ``,
          // 角色描述
          `CHARACTER:
  Name: ${c.name} (${c.roleLabel}, age ${c.age})
  Variant: ${ls.label}
  ${paletteLine ? paletteLine + '\n  ' : ''}Face: ${ls.data.faceDescription}
  Body: ${ls.data.bodyDescription}
  Outfit (this variant): ${ls.data.clothingDescription}`,
          ``,
          // 终检
          `FINAL CHECK — before submitting the output, verify every item is true. If any is false, REGENERATE the image:
  [ ] Full body is visible from head to feet (yes)
  [ ] Both feet are clearly visible at the bottom of the frame (yes)
  [ ] Character occupies 85-95% of canvas height (yes)
  [ ] Nothing is cut off — no half-body, no waist-up, no knee-up, no close-up (yes)
  [ ] Style matches "${styleSpec.label}" (yes)
  [ ] Background is pure white #FFFFFF (yes)
  [ ] Expression is neutral (yes)
  [ ] Camera is dead-on front view, eye-level (yes)`,
          ``,
          `Begin. Output the full-body image.`,
        ].filter(Boolean).join('\n')

        // ====================================================================
        // 强 negative_prompt(显式下发到 DashScope parameters.negative_prompt)
        // 把"半身 / 切脚 / 浮空无脚"的所有近义词/同义词全部覆盖,冗余但有效。
        // 关键:用 cinematic / photography 术语模型识别度更高,比中文更稳。
        // ====================================================================
        const negativePrompt = [
          // —— 摄影 / 镜头(半身特写)——
          'medium shot, medium close-up, MCU, MS, mid-shot, mid close-up, half body, half-body, half-length, three-quarter body, 3/4 body, three-quarter length, cowboy shot, american shot, knee-up shot, knee-up, mid-thigh shot, thigh-up, hip-up, waist-up shot, waist-up, midriff-up, chest-up shot, chest-up, shoulder-up, head and shoulders, head-and-shoulders, head only, headshot, head shot, tight headshot, tight crop, tight framing, close-up, close up, CU, extreme close-up, ECU, bust shot, bust, portrait crop, portrait shot, passport photo, ID photo, avatar crop, profile picture crop, pfp crop',
          // —— 切边 / 切脚 / 切头——
          'cropped at knees, cropped at calves, cropped at shins, cropped at ankles, cropped at waist, cropped at hips, cropped at thighs, cropped at chest, cropped at shoulders, cropped at neck, head cut off, top of head cut off, top of head clipped, hair cut off, feet cut off, shoes cut off, hands cut off at frame edge, body extending beyond frame, body touching frame edge, body touching top of frame, body touching bottom of frame, figure touching top of frame, figure touching bottom of frame, out of frame on top, out of frame on bottom',
          // —— 部位缺失 / 浮空——
          'missing feet, missing shoes, missing head, missing legs, missing lower body, missing upper body, missing arms, missing hands, head only, torso only, legs only, partial body, incomplete body, amputated limbs, no legs, no feet, legless, feet-less, lower body cut off, lower body fading out, lower body blended with background, character floating with no feet, floating in air, character shown only from the waist up, from waist up only, from chest up only, from hips up only, from knees up only',
          // —— 摄像机角度(仰视 / 侧视)——
          'low angle, low-angle shot, worm\'s eye view, worm eye view, hero shot, looking up at subject, upward camera, upward tilt, camera below subject, dutch angle, dutch tilt, tilted camera, canted angle, fisheye, wide-angle distortion, 3/4 view, three-quarter view, side view, profile view, back view, rear view, over-the-shoulder, looking sideways, glance to the side, head turned, body turned, asymmetric pose, top-down, bird\'s eye view, bottom-up',
          // —— 画幅 / 比例(方形特写)——
          'square crop, square framing, 1:1 aspect, instagram portrait crop, tiktok portrait, headshot-style crop, landscape orientation, 16:9 widescreen',
          // —— 边缘人 / 多余元素——
          'two people, multiple people, extra person in background, bystander, crowd, two characters, three characters',
          // —— 风格漂移——
          'photorealistic when input is anime, anime when input is realistic, 3D render when input is 2D, different art style, style drift',
          // —— 杂项——
          'watermark, logo, text, signature, label, panel number, caption, annotation, extra limbs, deformed hands, extra fingers, blurred face, low quality',
        ].join(', ')

        // 显式传 portrait 画幅给 Qwen,锁死竖向构图(用 prompt 反复强调"全身"
        // 仍会偶发切脚,但 3:4 画幅从结构上让模型必须把人物铺满纵向画布)。
        const characterSize = '1104*1472'

        const res = await callImage({ data: { prompt, model: resolveT2IModel(project?.sceneModel), noFallback: true, negativePrompt, size: characterSize } })
        if (res.url) {
          // 追加到 history 数组(每次生成都保留,用户在预览左侧看历史缩略图)
          setCharImages((m) => ({ ...m, [ls.imageKey]: [...(m[ls.imageKey] ?? []), res.url] }))
          toast.success(`已生成 ${cardTitle}（${styleSpec.label}）`)
        } else {
          toast.error(res.error || '生成失败')
        }
      } catch (e) {
        toast.error('生成失败')
      }
    }
    // 这个角色的所有 look 都处理完,从 busyChars 移除
    setActiveImageKey((cur) => (cur && cur.startsWith(c.id) ? null : cur))
    setBusyChars((s) => {
      if (!s.has(c.id)) return s
      const n = new Set(s)
      n.delete(c.id)
      return n
    })
  }

  // Wrapper for "click on one card to regenerate": just trigger the whole
  // character through processCharacter (which is idempotent — it skips done looks).
  async function genCharImage(c: GenCharacter) {
    if (busyChars.has(c.id)) return
    setBusyChars((s) => new Set([...s, c.id]))
    await processCharacter(c)
  }

  /**
   * 预览模态框里"按意见重生"——把:
   *   1) 当前选中的图片 URL(referenceImageUrl)
   *   2) 用户输入的修改意见
   *   3) 该形象的描述(face/body/outfit)
   *   4) 项目视觉风格 + 角色基本信息
   * 一起发给 regenerateCharacterLook server fn。返回新图后 push 到
   * charImages[imageKey] history 数组并自动选中。
   */
  async function handleRegenerate() {
    if (!previewTarget || regenBusy) return
    const c = previewTarget.character
    const lk = previewTarget.lookId == null
      ? null
      : c.looks?.find((x) => x.id === previewTarget.lookId) ?? null
    const imageKey = lk ? `${c.id}::${lk.id}` : c.id
    const generations = charImages[imageKey] ?? []
    const currentIdx = Math.min(selectedGenIdx, Math.max(0, generations.length - 1))
    const referenceUrl = generations[currentIdx]
    const instruction = regenInput.trim()
    if (!referenceUrl || !instruction) return

    setRegenBusy(true)
    try {
      const res = await callRegenCharacter({
        data: {
          referenceImageUrl: referenceUrl,
          userInstruction: instruction,
          faceDescription: lk?.faceDescription || c.faceDescription || '',
          bodyDescription: lk?.bodyDescription || c.bodyDescription || '',
          clothingDescription: lk?.clothingDescription || c.clothingDescription || '',
          characterName: c.name,
          characterRoleLabel: c.roleLabel,
          characterAge: c.age,
          lookLabel: lk?.label || '默认',
          palette: c.palette,
          projectStyle: project?.style,
          model: project?.sceneModel,
        },
      })
      if (res?.ok && res.url) {
        setCharImages((m) => ({ ...m, [imageKey]: [...(m[imageKey] ?? []), res.url!] }))
        // 自动选中新生成的那张
        setSelectedGenIdx((charImages[imageKey]?.length ?? generations.length))
        setRegenInput('')
        toast.success('已按意见重生')
      } else {
        toast.error(res?.error || '重生失败')
      }
    } catch (e) {
      toast.error('重生失败')
    } finally {
      setRegenBusy(false)
    }
  }

  // ============= 卡片底部 3 个按钮的逻辑 =============
  // 打开右侧修改面板(由卡片"修改"按钮触发)
  function openModPanel(c: GenCharacter, lookId: string | null) {
    const imageKey = lookId == null ? c.id : `${c.id}::${lookId}`
    setModPanel({ character: c, lookId, imageKey })
    setModInput('')
    setModError(null)
  }

  function closeModPanel() {
    if (modBusy) return  // 正在跑就别让人关掉
    setModPanel(null)
    setModInput('')
    setModError(null)
  }

  /**
   * 通用"调一次 regen"的核心,把当前选中的图 + 用户 instruction + 描述发
   * 给 server fn。新图 push 到 history(自动替换卡片封面),失败弹 toast。
   */
  async function doRegen(
    c: GenCharacter,
    lookId: string | null,
    mode: 'modify' | 'three-view' | 'multi-asset',
    instruction: string,
  ) {
    const lk = lookId == null ? null : c.looks?.find((x) => x.id === lookId) ?? null
    const imageKey = lk ? `${c.id}::${lk.id}` : c.id
    const generations = charImagesRef.current[imageKey] ?? []
    const referenceUrl = generations[generations.length - 1]  // 用最新一张当参考
    if (!referenceUrl) {
      toast.error('该形象还没生成,无法重生')
      return
    }
    // 把这张卡标记为 regen 中,UI 那边会显示黑屏遮罩。结束时(成功/失败)一定清掉。
    setRegenBusyKeys((m) => new Map(m).set(imageKey, mode))
    try {
      const res = await callRegenCharacter({
        data: {
          referenceImageUrl: referenceUrl,
          userInstruction: instruction,
          faceDescription: lk?.faceDescription || c.faceDescription || '',
          bodyDescription: lk?.bodyDescription || c.bodyDescription || '',
          clothingDescription: lk?.clothingDescription || c.clothingDescription || '',
          characterName: c.name,
          characterRoleLabel: c.roleLabel,
          characterAge: c.age,
          lookLabel: lk?.label || '默认',
          palette: c.palette,
          projectStyle: project?.style,
          // I2I(model 必须支持 multimodal input)。qwen-image-max 等只支持 T2I 的
          // 模型会 400 "url error";用 resolveI2IModel 强制映射到订阅里 I2I 兼容的
          // model(qwen-image-2.0-pro)。
          model: resolveI2IModel(project?.sceneModel),
          mode,
        },
      })
      if (res?.ok && res.url) {
        setCharImages((m) => ({ ...m, [imageKey]: [...(m[imageKey] ?? []), res.url!] }))
        const modeLabel =
          mode === 'modify' ? '已按意见重生' :
          mode === 'three-view' ? '已生成三视图' :
          '已生成多维资产图'
        toast.success(modeLabel)
        return true
      }
      toast.error(res?.error || '生成失败')
      return false
    } catch (e) {
      toast.error('生成失败')
      return false
    } finally {
      setRegenBusyKeys((m) => {
        if (!m.has(imageKey)) return m
        const n = new Map(m)
        n.delete(imageKey)
        return n
      })
    }
  }

  // 右侧面板的"发送"按钮:走 mode='modify' + 用户意见
  async function submitModPanel() {
    if (!modPanel || modBusy) return
    const instruction = modInput.trim()
    if (!instruction) {
      setModError('请输入修改意见')
      return
    }
    setModBusy(true)
    setModError(null)
    const ok = await doRegen(modPanel.character, modPanel.lookId, 'modify', instruction)
    setModBusy(false)
    if (ok) {
      closeModPanel()
    } else {
      setModError('生成失败,请重试或换更简单的修改')
    }
  }

  // 卡片"三视图" / "多维资产图"按钮:无 user input,直接跑预定义指令
  async function runPresetRegen(
    c: GenCharacter,
    lookId: string | null,
    mode: 'three-view' | 'multi-asset',
  ) {
    const instruction = mode === 'three-view'
      ? '根据此形象生成标准三视图:同一角色分别从前、正侧、背三个角度展示,头到脚全身,脸/身材/衣服在三个视图里完全一致。'
      : '根据此形象生成多维资产图:同一角色 4-6 个面板,展示不同姿态(站/坐/行走)和不同场景片段,脸/身材/衣服在所有面板里完全一致。'
    await doRegen(c, lookId, mode, instruction)
  }


  async function genPanelImage(p: StoryboardPanel) {
    if (busyPanel) return
    setBusyPanel(p.id)
    try {
      const scene = data.scenes.find((s) => s.id === p.sceneId)
      // 分镜也跟随项目视觉风格,避免出现"角色是动漫风 / 分镜是写实"
      // 这种割裂。分镜不需要"纯白背景"(分镜本身有场景),所以只注入风格。
      const styleSpec = resolveProjectStyle(project?.style)
      const prompt = [
        `[VISUAL STYLE — must follow the project's art direction]`,
        `Style: ${styleSpec.positive}.`,
        `AVOID: ${styleSpec.negative}.`,
        `---`,
        scene?.slug && `Scene: ${scene.slug}`,
        `Shot ${p.shot}: ${p.camera}`,
        p.action, p.emotion && `mood: ${p.emotion}`,
        'cinematic storyboard panel, dramatic composition, film still, consistent with the character design established by the reference sheet',
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

  // ====================================================================
  // 新的分镜流程 —— 两条 server function 入口
  //   1) runEnterStoryboard:把当集剧情发给 AI → 生成多组 StoryboardGroup
  //   2) generateShotImageForGroup:对单个 group 的某个 shot,做多图融合
  // ====================================================================

  /**
   * 从当集剧情生成多组 StoryboardGroup。
   * 流程:
   *  1) 取选中的 episode 文本(默认 selectedEpisodeIndex)
   *  2) 拼角色 / 场景摘要
   *  3) 调 generateStoryboardFromPlot server function
   *  4) 把返回的 groups 存到 data.storyboardGroups
   *  5) 切到 storyboard tab
   */
  async function runEnterStoryboard() {
    if (busyStoryboardGen) return
    const ep = data.episodeTexts.find((e) => e.epIndex === selectedEpisodeIndex)
    const epText = ep?.text?.trim() ?? ''
    if (!epText) {
      toast.error('当集剧本为空,请先在"分集"标签生成剧本')
      return
    }
    // 只检查当集是否有角色(其他集的角色不能用来切分当集剧情)
    const epChars = data.characters.filter((c) => c.episodeIndex === selectedEpisodeIndex)
    if (!epChars.length) {
      toast.error(`第 ${selectedEpisodeIndex} 集还没有角色,请先在"角色"标签提取本集角色`)
      return
    }
    setBusyStoryboardGen(true)
    try {
      // 只用当集的角色/场景做切分(避免别集的角色污染剧情理解)
      const epChars = data.characters.filter((c) => c.episodeIndex === selectedEpisodeIndex)
      const epScenes = data.scenes.filter((s) => s.episodeIndex === selectedEpisodeIndex)
      const charSummaries = epChars.map((c) => ({
        id: c.id,
        name: c.name,
        role: c.roleLabel,
        profile: [
          c.gender && `性别:${c.gender}`,
          `年龄:${c.age}`,
          c.faceDescription && `面部:${c.faceDescription.slice(0, 120)}`,
          c.clothingDescription && `服装:${c.clothingDescription.slice(0, 120)}`,
        ]
          .filter(Boolean)
          .join('; '),
      }))
      const sceneSummaries = epScenes.map((s) => ({
        id: s.id,
        slug: s.slug,
        location: s.location,
        timeOfDay: s.timeOfDay,
        profile: (s.action || '').slice(0, 200),
      }))
      // 前面所有集数作为上下文
      const prevEps = data.episodeTexts
        .filter((e) => e.epIndex < selectedEpisodeIndex)
        .sort((a, b) => a.epIndex - b.epIndex)
        .map((e) => `—— 第 ${e.epIndex} 集 ——\n${e.text}`)
        .join('\n\n')
      const res = await callGenerateStoryboard({
        data: {
          episodeText: epText,
          episodeIndex: selectedEpisodeIndex,
          characterSummaries: charSummaries,
          sceneSummaries: sceneSummaries,
          groupCount: 6,
          previousEpisodesText: prevEps || undefined,
          projectStyle: project?.style,
        },
      })
      if (!res.ok) {
        toast.error(res.error || '分镜生成失败')
        return
      }
      // 关联 sceneLocation(从场景摘要里取),并打 episodeIndex 标签。
      // 合并:替换当集已有分镜组,其他集保留。
      const groups = (res.groups as StoryboardGroup[]).map((g) => {
        const sc = sceneSummaries.find((s) => s.id === g.sceneId)
        return { ...g, episodeIndex: selectedEpisodeIndex, sceneLocation: sc?.location || sc?.slug }
      })
      setData((d) => ({
        ...d,
        storyboardGroups: [
          ...d.storyboardGroups.filter((g) => g.episodeIndex !== selectedEpisodeIndex),
          ...groups,
        ],
      }))
      toast.success(`已生成 ${groups.length} 组分镜`)
      setTab('storyboard')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '分镜生成失败')
    } finally {
      setBusyStoryboardGen(false)
    }
  }

  /**
   * 对某个 StoryboardGroup 的某个 shot 做多图融合,产出最终分镜图。
   * 策略:
   *  - 角色图:从 charImages[角色ID] / charImages[角色ID::lookId] 取最新一张
   *  - 场景图:从 sceneImages[sceneId] 取
   *  - 串行调用(并发 1)避免 Qwen 429 / 跑偏
   */
  async function generateShotImageForGroup(groupId: string, shotId: string) {
    if (busyShotImages.has(`${groupId}::${shotId}`)) return
    const group = data.storyboardGroups.find((g) => g.id === groupId)
    if (!group) return
    const shot = group.shots.find((s) => s.id === shotId)
    if (!shot) return

    // 准备角色图(从 group.characterIds 取)
    // ⚠️ qwen-image-2.0-pro 端点限制:0 张图 = T2I,1~3 张图 = I2I。
    //    超过 3 张会报 400 "Model 'qwen-image-2.0-2in1' supports 0~3 image content items"。
    //    策略:有场景图 → 最多 2 张角色图;无场景图 → 最多 3 张角色图。
    const charImageUrls: string[] = []
    const charNames: string[] = []
    const hasScene = !!(group.sceneId && sceneImages[group.sceneId])
    const maxChars = hasScene ? 2 : 3
    for (const cid of group.characterIds) {
      if (charImageUrls.length >= maxChars) break
      const arr = charImages[cid]
      const url = arr?.[arr.length - 1] // 最新一张
      if (url) {
        charImageUrls.push(url)
        const ch = data.characters.find((c) => c.id === cid)
        charNames.push(ch?.name ?? cid)
      }
    }
    // 准备场景图
    let sceneImageUrl: string | undefined
    if (group.sceneId && sceneImages[group.sceneId]) {
      sceneImageUrl = sceneImages[group.sceneId]
    }
    // 场景描述
    const sceneObj = data.scenes.find((s) => s.id === group.sceneId)

    setBusyShotImages((s) => {
      const n = new Set(s)
      n.add(`${groupId}::${shotId}`)
      return n
    })
    try {
      const res = await callGenerateShotImage({
        data: {
          plotText: group.plotText,
          shotType: shot.shotType,
          shotTypeLabel: shot.shotTypeLabel,
          action: shot.action,
          camera: shot.camera,
          characterImageUrls: charImageUrls,
          characterNames: charNames,
          sceneImageUrl,
          sceneLocation: sceneObj?.location || group.sceneLocation || '',
          sceneTimeOfDay: sceneObj?.timeOfDay || '',
          projectStyle: project?.style,
        },
      })
      if (!res.ok) {
        toast.error(res.error || '分镜图生成失败')
        return
      }
      const imageKey = `${groupId}::${shotId}`
      // 写回 group.shots[i].imageUrl(保持向后兼容,旧数据读取也走这个字段)
      // 同时 push 到 shotImages 历史数组(供预览 + 按意见重生使用)
      setData((d) => ({
        ...d,
        storyboardGroups: d.storyboardGroups.map((g) =>
          g.id === groupId
            ? {
                ...g,
                shots: g.shots.map((sh) => (sh.id === shotId ? { ...sh, imageUrl: res.url } : sh)),
              }
            : g,
        ),
      }))
      setShotImages((m) => ({ ...m, [imageKey]: [...(m[imageKey] ?? []), res.url!] }))
      toast.success(`分镜图 ${shot.shotTypeLabel} 已生成`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '分镜图生成失败')
    } finally {
      setBusyShotImages((s) => {
        const n = new Set(s)
        n.delete(`${groupId}::${shotId}`)
        return n
      })
    }
  }

  /**
   * 一键为整个 group 的所有 shot 生成图(串行,避免 Qwen 撞限速 / 跑偏)
   */
  async function generateAllShotsForGroup(groupId: string) {
    const group = data.storyboardGroups.find((g) => g.id === groupId)
    if (!group) return
    for (const shot of group.shots) {
      if (shot.imageUrl) continue
      // eslint-disable-next-line no-await-in-loop
      await generateShotImageForGroup(groupId, shot.id)
    }
  }

  /**
   * 按用户意见重生分镜图(和 regenerateCharacterLook 同语义)。
   *  1) 取 group / shot,以及当前要修改的 referenceImageUrl(从 shotImages 取最新一张)
   *  2) 拼角色 / 场景参考(server 端再按 qwen 3 张上限截断)
   *  3) 调 callRegenShot,新图 push 到 shotImages 历史 + 写回 g.shots[i].imageUrl
   *  4) 自动选中新生成的那张,关闭 modInput
   */
  async function handleRegenShot() {
    if (!shotPreview || shotModBusy) return
    const { groupId, shotId } = shotPreview
    const group = data.storyboardGroups.find((g) => g.id === groupId)
    if (!group) return
    const shot = group.shots.find((s) => s.id === shotId)
    if (!shot) return
    const imageKey = `${groupId}::${shotId}`
    const generations = shotImages[imageKey] ?? []
    const currentIdx = Math.min(shotSelectedGenIdx, Math.max(0, generations.length - 1))
    const referenceUrl = generations[currentIdx] ?? shot.imageUrl
    const instruction = shotModInput.trim()
    if (!referenceUrl || !instruction) return

    // 拼角色 / 场景参考 —— 跟 generateShotImageForGroup 同样的截断策略
    const charImageUrls: string[] = []
    const charNames: string[] = []
    const hasScene = !!(group.sceneId && sceneImages[group.sceneId])
    const maxChars = hasScene ? 2 : 3
    for (const cid of group.characterIds) {
      if (charImageUrls.length >= maxChars) break
      const arr = charImages[cid]
      const url = arr?.[arr.length - 1]
      if (url) {
        charImageUrls.push(url)
        const ch = data.characters.find((c) => c.id === cid)
        charNames.push(ch?.name ?? cid)
      }
    }
    const sceneImageUrl = group.sceneId && sceneImages[group.sceneId] ? sceneImages[group.sceneId] : undefined
    const sceneObj = data.scenes.find((s) => s.id === group.sceneId)

    setShotModBusy(true)
    try {
      const res = await callRegenShot({
        data: {
          referenceImageUrl: referenceUrl,
          userInstruction: instruction,
          plotText: group.plotText,
          shotType: shot.shotType,
          shotTypeLabel: shot.shotTypeLabel,
          action: shot.action,
          camera: shot.camera,
          characterImageUrls: charImageUrls,
          characterNames: charNames,
          sceneImageUrl,
          sceneLocation: sceneObj?.location || group.sceneLocation || '',
          sceneTimeOfDay: sceneObj?.timeOfDay || '',
          projectStyle: project?.style,
        },
      })
      if (res?.ok && res.url) {
        const newLen = (shotImages[imageKey]?.length ?? 0) + 1
        setShotImages((m) => ({ ...m, [imageKey]: [...(m[imageKey] ?? []), res.url!] }))
        setData((d) => ({
          ...d,
          storyboardGroups: d.storyboardGroups.map((g) =>
            g.id === groupId
              ? { ...g, shots: g.shots.map((sh) => (sh.id === shotId ? { ...sh, imageUrl: res.url } : sh)) }
              : g,
          ),
        }))
        setShotSelectedGenIdx(newLen - 1)
        setShotModInput('')
        toast.success('已按意见重生')
      } else {
        toast.error(res?.error || '重生失败')
      }
    } catch (e) {
      toast.error('重生失败')
    } finally {
      setShotModBusy(false)
    }
  }

  // Auto-generate real images for newly produced characters / storyboard panels.
  //
  // ⚠️ 串行生成(并发上限 = 1,跨角色也排队)。
  //
  // 历史经验:
  //   - 完全无并发 = 2 的时候,Qwen 同时给 N 个 429,代码 fallback 到不同 model,
  //     产生风格/构图/背景不一致的图。
  //   - 改并发 = 2 后:撞 429 概率仍偏高,DashScope 高峰排队时返回的图在
  //     "正视图 / 全身" 这种构图约束上很容易跑偏(仰视、半身、切头切脚),
  //     而且失败次数上去后整批失败率上升(因为 noFallback 锁了主 model)。
  //   - 串行 = 1 是最稳的选择:每一张图独占 DashScope 的请求槽,model 在
  //     单一上下文里能更稳定地服从 prompt 约束。代价是耗时 = N 角色 × N look
  //     × ~30s/张,但对"角色一致性"是质量优先,值得。
  //
  // 同一角色的多个 look 在 processCharacter 里已经是串行(for 循环),
  // 这里只需要把"跨角色"也排队,实现端到端的"一张接一张"。
  useEffect(() => {
    if (!autoGen) return
    // 找出"至少有一个 look 未生成"的角色集合
    const charactersToStart: GenCharacter[] = []
    for (const c of data.characters) {
      if (busyChars.has(c.id)) continue  // 已经在跑(默认或某个 look)
      const needDefault = !(charImages[c.id]?.length)
      const needLooks = (c.looks ?? []).some((lk) => !(charImages[`${c.id}::${lk.id}`]?.length))
      if (needDefault || needLooks) charactersToStart.push(c)
    }
    if (!charactersToStart.length) return
    // 串行:一个角色跑完才跑下一个。即便用户觉得慢,也不要在角色之间开并发 —
    // 撞 429 / 构图跑偏 / 整批失败率上升 这三个问题都跟并发直接相关。
    void (async () => {
      for (const c of charactersToStart) {
        // eslint-disable-next-line no-await-in-loop
        await processCharacter(c)
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

  // ============= Import script handler =============
  // Wired to the ZopiaChatPanel "导入剧本" CTA. Writes the parsed synopsis + episode
  // list to the workspace state, then jumps to the per-episode view. Overwrites any
  // existing episodes (matches the "import" semantics).
  function handleImportScript(result: ImportedScriptResult) {
    const sortedEps = [...result.episodes].sort((a, b) => a.epIndex - b.epIndex)
    const firstEp = sortedEps[0]?.epIndex ?? 1

    // 1. Synopsis state
    setSynopsisText(result.synopsis)
    setSynopsisDraft(result.synopsis)
    setSynopsisEditing(false)
    setSynopsisBubbles([])

    // 2. Episode list + next index
    setData((d) => ({
      ...d,
      episodeTexts: sortedEps,
      nextEpIndex: sortedEps.length > 0
        ? Math.max(...sortedEps.map((e) => e.epIndex)) + 1
        : 1,
    }))

    // 3. Selection + expansion
    setSelectedEpisodeIndex(firstEp)
    setExpandedEpisodes(new Set([firstEp]))

    // 4. Clear any in-flight streaming
    setEpisodeStreaming(false)
    setEpisodeBubbles([])
    setStreamingBubbleId(null)
    setAutoRunCompleteTarget(null)

    // 5. Jump to per-episode view
    setTab('episodes')

    toast.success(t.zp_import_success.replace('{{count}}', String(sortedEps.length)))
  }

  // ============= 新增集数(下拉「+ 新增集数」入口) =============
  // 延续已有集数索引(取 max(epIndex)+1;空项目从 1 起),不重置 selectedEpisodeIndex。
  // 提供两条路径:
  //   1) AI 生成:在 data.episodeTexts 里塞一条空记录,切到 script tab,然后调
  //      runScriptEpisode 走流式生成;前端能看到"生成中…"实时更新。
  //   2) 导入剧本:读 .txt/.md/.docx 文件,把内容作为本集文本写入;docx 用 mammoth。
  // 两条路径都会:
  //   - 选中新建的 epIndex,setExpandedEpisodes 展开它
  //   - 切到 script tab
  //   - toast 提示
  function computeNextEpIndex(): number {
    if (data.episodeTexts.length === 0) return 1
    return Math.max(...data.episodeTexts.map((e) => e.epIndex)) + 1
  }

  function openAddEpisodeDialog() {
    setAddEpisodeOpen(true)
  }
  function closeAddEpisodeDialog() {
    if (addEpisodeImporting) return
    setAddEpisodeOpen(false)
  }

  /**
   * 路径 1:AI 生成新一集。
   * 先把空记录写入 episodeTexts(让 UI 立刻出现新卡片),再切到 script tab 让
   * 流式生成开始写文本。生成完成后,runScriptEpisode 的 'done' 分支会用真实
   * 文本覆盖那条空记录。
   */
  async function handleAddEpisodeAI() {
    if (episodeStreaming || synopsisStreaming) {
      toast.error('当前正在流式生成,稍后再试')
      return
    }
    const newEpIndex = computeNextEpIndex()
    // 写空记录(去重,避免重复点击)
    setData((d) => {
      if (d.episodeTexts.some((e) => e.epIndex === newEpIndex)) return d
      return {
        ...d,
        episodeTexts: [...d.episodeTexts, { epIndex: newEpIndex, text: '' }].sort((a, b) => a.epIndex - b.epIndex),
        nextEpIndex: newEpIndex + 1,
      }
    })
    setSelectedEpisodeIndex(newEpIndex)
    setExpandedEpisodes((prev) => new Set(prev).add(newEpIndex))
    setAddEpisodeOpen(false)
    setTab('script')
    if (!synopsisText && !synopsisDraft) {
      toast.warning('当前还没有故事梗概,AI 会以"通用剧情"理解,效果可能一般;生成完可在「剧本」标签补充梗概后重跑。')
    }
    // 流式生成(runScriptEpisode 内部会自动用 synopsisText + 前面所有集作为上下文)
    await runScriptEpisode({
      epIndex: newEpIndex,
      sceneCount: data.nextSceneCount || 15,
      lang: 'zh',
    })
  }

  /**
   * 路径 2:从文件导入当集剧本。
   * 支持 .txt/.md 直接读;.docx 用 mammoth(懒加载)。整个文件内容作为本集文本,
   * 不做分集边界检测(已有的「导入剧本」全量导入入口在 ZopiaChatPanel,语义不同)。
   */
  async function handleAddEpisodeFilePicked(file: File | null | undefined) {
    if (!file) return
    if (file.size > 10 * 1024 * 1024) {
      toast.error('文件过大(>10MB),请拆分后重试')
      return
    }
    const lower = file.name.toLowerCase()
    if (!/\.(txt|md|docx)$/i.test(file.name)) {
      toast.error('仅支持 .txt / .md / .docx 文件')
      return
    }
    setAddEpisodeImporting(true)
    try {
      let text = ''
      if (lower.endsWith('.docx')) {
        // 懒加载 mammoth,避免把 .docx 解析塞进首屏
        const mod: any = await import('mammoth')
        const mammoth = mod.default ?? mod
        const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })
        text = (result?.value ?? '').trim()
      } else {
        text = (await file.text()).trim()
      }
      if (text.length < 5) {
        toast.error('文件内容过短,无法作为本集剧本')
        return
      }
      const newEpIndex = computeNextEpIndex()
      setData((d) => {
        if (d.episodeTexts.some((e) => e.epIndex === newEpIndex)) return d
        return {
          ...d,
          episodeTexts: [...d.episodeTexts, { epIndex: newEpIndex, text }].sort((a, b) => a.epIndex - b.epIndex),
          nextEpIndex: newEpIndex + 1,
        }
      })
      setSelectedEpisodeIndex(newEpIndex)
      setExpandedEpisodes((prev) => new Set(prev).add(newEpIndex))
      setAddEpisodeOpen(false)
      setTab('script')
      toast.success(`已从文件添加第 ${newEpIndex} 集剧本`)
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : '读取文件失败')
    } finally {
      setAddEpisodeImporting(false)
      if (addEpisodeFileInputRef.current) addEpisodeFileInputRef.current.value = ''
    }
  }

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

  // ===== Workspace data persistence =====
  const completedStages = (() => {
    const stages = new Set<WorkspaceTab>()
    if (data.outline && data.outline.acts.length > 0) stages.add('canvas')
    if (synopsisText || data.episodeTexts.length > 0) stages.add('script')
    if (data.characters.length > 0) stages.add('character')
    if (data.storyboard.length > 0) stages.add('storyboard')
    if (data.timeline) stages.add('timeline')
    return stages
  })()

  const ALL_STAGES: WorkspaceTab[] = ['canvas', 'script', 'character', 'storyboard', 'timeline']

  async function handleSaveWorkspace() {
    if (!user) {
      toast.error('请先登录')
      return
    }
    setSavingWorkspace(true)
    setSavedWorkspace(false)
    try {
      const workspaceData: Record<string, unknown> = {
        outline: data.outline,
        scenes: data.scenes,
        characters: data.characters,
        storyboard: data.storyboard,
        storyboardGroups: data.storyboardGroups,
        timeline: data.timeline,
        synopsisText: synopsisText || synopsisDraft,
        episodeTexts: data.episodeTexts,
        charImages,
        shotImages,
        panelImages,
        sceneImages,
      }
      const res = await callSaveWorkspace({
        data: {
          id: workspaceId,
          workspaceData,
          completedStages: Array.from(completedStages),
        },
      })
      if (res.ok) {
        setSavedWorkspace(true)
        toast.success('工作区已保存')
        // Reset "saved" badge after 3 seconds
        setTimeout(() => setSavedWorkspace(false), 3000)
      } else {
        toast.error(res.error || '保存失败')
      }
    } catch {
      toast.error('保存失败')
    } finally {
      setSavingWorkspace(false)
    }
  }

  // Auto-save when all stages are complete (only trigger once)
  const completedKey = ALL_STAGES.map((s) => completedStages.has(s) ? '1' : '0').join('')
  useEffect(() => {
    if (autoSavedRef.current) return
    if (!dataLoaded) return
    if (completedKey === '11111') {
      autoSavedRef.current = true
      void handleSaveWorkspace()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completedKey, dataLoaded])

  // EpisodesView: Auto-select latest episode when episodes change
  useEffect(() => {
    const episodes = data.episodeTexts
    if (tab === 'episodes' && episodes.length > 0 && !episodes.some((ep) => ep.epIndex === selectedEpisodeIndex)) {
      setSelectedEpisodeIndex(episodes[episodes.length - 1].epIndex)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.episodeTexts, selectedEpisodeIndex, tab])

  // EpisodesView: Scroll selected episode card into view when selectedEpisodeIndex changes
  useEffect(() => {
    if (tab === 'episodes') {
      const el = episodeCardRefs.current[selectedEpisodeIndex]
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
      }
    }
  }, [selectedEpisodeIndex, tab])

  async function tryAi(stage: 'canvas' | 'script' | 'scene' | 'character' | 'character-extract' | 'storyboard' | 'timeline', userPrompt: string, currentData: WorkspaceData): Promise<Partial<WorkspaceData> | null> {
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
            episodeIndex: typeof s.episodeIndex === 'number' ? s.episodeIndex : 1,
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
        case 'scene': {
          // 'scene' 阶段：AI 只做场景提取(轻量 prompt + 简化 schema),
          // 输出更干净的 GenScene[]。与 'script' 阶段的"写剧本"区别开。
          const rawScenes: any[] = Array.isArray(p.scenes) ? p.scenes : []
          // 兜底:AI 偶尔不返回 scenes 字段时不要 wipe 现有数据
          if (rawScenes.length === 0) return { scenes: currentData.scenes }
          const scenes: GenScene[] = rawScenes.map((s: any, i: number) => ({
            episodeIndex: typeof s.episodeIndex === 'number' ? s.episodeIndex : 1,
            id: `ai-sc-${i + 1}-${Date.now()}`,
            index: s.index ?? i + 1,
            slug: s.slug ?? '',
            location: s.location ?? '',
            timeOfDay: s.timeOfDay ?? 'DAY',
            action: s.action ?? '',
            beats: Array.isArray(s.beats) ? s.beats : [],
            dialogue: [],
          }))
          return { scenes }
        }
        case 'character-extract':
        case 'character': {
          const characters: GenCharacter[] = (p.characters ?? []).map((c: any, i: number) => {
            const palette: string[] = Array.isArray(c.palette) && c.palette.length ? c.palette : ['#1e293b', '#475569', '#fbbf24']
            const cid = `ai-ch-${i + 1}-${Date.now()}`
            // 同角色不同造型(医生/穿越/学生 等),每个 look 走独立图片生成 call,
            // 脸和身材沿用主条目,clothingDescription 用 look 自己的。AI 字段
            // 是 string[] of { label, clothingDescription },转成 GenCharacterLook[]。
            const looks: GenCharacterLook[] = Array.isArray(c.looks)
              ? c.looks
                  .filter((lk: any) => lk && typeof lk.label === 'string' && lk.label.trim())
                  .map((lk: any, k: number) => ({
                    id: `ai-lk-${i + 1}-${k + 1}-${Date.now()}`,
                    label: lk.label.trim(),
                    faceDescription: c.faceDescription ?? '',  // 沿用主条目
                    bodyDescription: c.bodyDescription ?? '',
                    clothingDescription: lk.clothingDescription ?? '',
                  }))
              : []
            return {
              // 默认归属第 1 集(若调用方传了 episodeIndex,produce() 会覆盖)
              episodeIndex: typeof c.episodeIndex === 'number' ? c.episodeIndex : 1,
              id: cid,
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
              looks: looks.length > 0 ? looks : undefined,
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
    epIndex: number; sceneCount: number; lang: 'zh' | 'en'; model?: string; autoRunTarget?: number; expectedEpisodes?: number
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
              runScriptEpisode({ epIndex: opts.epIndex + 1, sceneCount: opts.sceneCount, lang: opts.lang, autoRunTarget, expectedEpisodes: opts.expectedEpisodes })
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
        scriptPromise = runScriptEpisode({ epIndex: nextEpIndex, sceneCount, lang: 'zh', autoRunTarget: targetEp, expectedEpisodes: targetEp })
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

    // Skip tryAi for streaming script generations — those are handled separately above.
    // Also skip for 'character' stage when this is an extract-from-episode call,
    // because that branch below does its own dedicated character extraction with
    // the actual episode text in the prompt (vs. just "从第 X 集提取..." which
    // produces garbage from the AI).
    const skipTopLevelTryAi =
      isStreamingScript ||
      (stage === 'character' && isExtractFromEpisode)
    if (meaningful && !skipTopLevelTryAi && (stage === 'canvas' || stage === 'script' || stage === 'character' || stage === 'storyboard' || stage === 'timeline')) {
      aiPatch = await tryAi(stage, trimmed, snapshot)
    }

    // Extract characters + scenes from a specific episode (dual AI calls).
    // 'character-extract' stage: 放宽 schema (minItems: 1) 专门做单集角色提取,
    //   避免 'character' stage 的 minItems:3 在单集 1-2 角色时 tool call 失败。
    // 'scene' stage: 专门的场景提取(在 aiGenerate.functions.ts 新加)。
    if (isExtractFromEpisode && extractEpIndex > 0) {
      const epText = data.episodeTexts.find((e) => e.epIndex === extractEpIndex)?.text ?? ''
      if (epText) {
        const extractPrompt = `以下是第 ${extractEpIndex} 集的剧本内容，请只提取本集中出现的角色和主要场景：\n\n${epText}`
        const [charResult, sceneResult] = await Promise.all([
          tryAi('character-extract', extractPrompt, snapshot),
          tryAi('scene', extractPrompt, snapshot),
        ])
        // 给所有角色/场景打 episodeIndex 标签,UI 按集数过滤用。
        // 同一角色若跨多集出现,每集都会产生一条独立记录(避免冲突)。
        const charsWithEp = charResult?.characters?.map((c) => ({ ...c, episodeIndex: extractEpIndex }))
        const scenesWithEp = sceneResult?.scenes?.map((s) => ({ ...s, episodeIndex: extractEpIndex }))
        aiPatch = {
          ...(charResult ? { characters: charsWithEp } : {}),
          ...(sceneResult ? { scenes: scenesWithEp } : {}),
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
          // Extract from episode: 合并而非替换 —— 同一集的角色/场景用新的
          // 替换,其他集的角色/场景保留。这样多集剧本可以独立提取、互不影响。
          if (isExtractFromEpisode && aiPatch) {
            let characters = d.characters
            let scenes = d.scenes
            if (aiPatch.characters) {
              characters = [
                ...d.characters.filter((c) => c.episodeIndex !== extractEpIndex),
                ...aiPatch.characters,
              ]
            }
            if (aiPatch.scenes) {
              scenes = [
                ...d.scenes.filter((s) => s.episodeIndex !== extractEpIndex),
                ...aiPatch.scenes,
              ]
            }
            return { ...d, characters, scenes }
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
      <WorkspaceTopbar tab={tab} onTabChange={setTab} episodeCount={data.episodeTexts.length} selectedEpisodeIndex={selectedEpisodeIndex} onEpisodeIndexChange={setSelectedEpisodeIndex} onSaveAssets={handleSaveAssets} onSave={handleSaveWorkspace} saving={savingWorkspace} saved={savedWorkspace} completedStages={completedStages} onAddEpisode={openAddEpisodeDialog} />
      <div className="flex-1 flex min-h-0">
        <main className="flex-1 min-w-0 overflow-auto p-6">
          {tab === 'canvas' && (
            <div className="relative max-w-4xl mx-auto rounded-2xl border-2 border-dashed border-accent/50 bg-bg-surface p-6 min-h-[500px]">
              <div className="flex items-center justify-between mb-3">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-bg-elevated text-xs border border-border">
                  <FileText size={12} /> {t.ws_tab_canvas}
                </span>
                <div className="flex items-center gap-2">
                  {completedStages.has('canvas') && <span className="inline-flex items-center gap-0.5 text-xs text-emerald-400"><CheckCircle2 size={12} /> 已完成</span>}
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
          )}
          {tab === 'script' && (() => {
            const hasSynopsis = synopsisText || synopsisDraft
            const hasEpisodes = data.episodeTexts.length > 0
            const isAutoRunning = autoRunCompleteTarget != null && !episodeStreaming
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
                {hasSynopsis && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="font-display text-lg font-bold">故事梗概</h3>
                      <div className="flex items-center gap-2">
                        {synopsisStreaming && (
                          <span className="inline-flex items-center gap-1.5 text-xs text-accent">
                            <Loader2 size={11} className="animate-spin" /> 生成中…
                          </span>
                        )}
                        <button
                          onClick={() => {
                            if (synopsisEditing) {
                              setSynopsisText(synopsisDraft)
                              setSynopsisEditing(false)
                            } else {
                              setSynopsisEditing(true)
                            }
                          }}
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold transition ${
                            synopsisEditing
                              ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25'
                              : 'border border-border text-text-secondary hover:text-text-primary hover:border-accent hover:bg-bg-elevated'
                          }`}
                        >
                          {synopsisEditing ? <><Check size={13} /> 完成</> : <><Pencil size={13} /> 编辑</>}
                        </button>
                      </div>
                    </div>
                    {synopsisEditing ? (
                      <textarea
                        key="synopsis-edit-textarea"
                        ref={synopsisEditRef}
                        value={synopsisDraft}
                        onChange={(e) => setSynopsisDraft(e.target.value)}
                        rows={24}
                        className="w-full rounded-lg bg-bg-elevated border border-accent/50 text-sm text-text-primary p-3 leading-7 font-mono focus:outline-none focus:border-accent resize-y overflow-auto"
                        style={{ maxHeight: '70vh' }}
                        placeholder="编辑故事梗概…"
                      />
                    ) : (
                      <div className="rounded-lg bg-bg-elevated border border-border p-4 prose prose-invert prose-sm max-w-none text-text-primary whitespace-pre-wrap leading-relaxed text-sm">
                        <ReactMarkdown>{synopsisDraft}</ReactMarkdown>
                      </div>
                    )}
                  </div>
                )}

                {isAutoRunning && autoRunCompleteTarget && (
                  <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-accent/20 border border-accent/40 text-sm text-accent">
                    <Sparkles size={14} />
                    <span>已连续生成至第 {autoRunCompleteTarget} 集，生成完毕</span>
                  </div>
                )}

                {data.episodeTexts.map((ep) => {
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
                        {isExpanded && !isThisStreaming && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              if (episodeEditing === ep.epIndex) {
                                setData((d) => ({
                                  ...d,
                                  episodeTexts: d.episodeTexts.map((et) =>
                                    et.epIndex === ep.epIndex ? { ...et, text: episodeDraft } : et
                                  ),
                                }))
                                setEpisodeEditing(null)
                                setEpisodeDraft('')
                              } else {
                                setEpisodeEditing(ep.epIndex)
                                setEpisodeDraft(ep.text)
                              }
                            }}
                            className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold transition shrink-0 ${
                              episodeEditing === ep.epIndex
                                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25'
                                : 'border border-border text-text-muted hover:text-text-primary hover:border-accent hover:bg-bg-elevated'
                            }`}
                          >
                            {episodeEditing === ep.epIndex ? <><Check size={11} /> 完成</> : <><Pencil size={11} /> 编辑</>}
                          </button>
                        )}
                        <span className="px-2 py-1 rounded-md bg-bg-elevated border border-border text-text-muted text-xs">
                          {isExpanded ? '折叠' : '展开'}
                        </span>
                      </div>
                      {isExpanded && displayText ? (
                        episodeEditing === ep.epIndex ? (
                          <div className="px-5 pb-5">
                            <textarea
                              key={`episode-edit-textarea-${ep.epIndex}`}
                              ref={episodeEditRef}
                              value={episodeDraft}
                              onChange={(e) => setEpisodeDraft(e.target.value)}
                              rows={20}
                              className="w-full rounded-lg bg-bg-elevated border border-accent/50 text-sm text-text-primary p-3 leading-7 font-mono focus:outline-none focus:border-accent resize-y overflow-auto"
                              style={{ maxHeight: '70vh' }}
                              placeholder="编辑剧本…"
                            />
                          </div>
                        ) : (
                          <div className="px-5 pb-5 prose prose-invert prose-sm max-w-none text-text-primary whitespace-pre-wrap leading-relaxed text-sm">
                            <ReactMarkdown>{displayText}</ReactMarkdown>
                          </div>
                        )
                      ) : null}
                    </div>
                  )
                })}
              </div>
            )
          })()}
          {tab === 'episodes' && (() => {
            const episodes = data.episodeTexts
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
                <div>
                  <h3 className="font-display text-lg font-bold mb-3">{t.ws_episodes_select}</h3>
                  <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin">
                    {episodes.map((ep) => {
                      const active = ep.epIndex === selectedEp.epIndex
                      const preview = ep.text.slice(0, 80)
                      return (
                        <button
                          key={ep.epIndex}
                          ref={(el) => { episodeCardRefs.current[ep.epIndex] = el }}
                          onClick={() => setSelectedEpisodeIndex(ep.epIndex)}
                          className={`min-w-[160px] max-w-[160px] p-3 rounded-xl border text-left transition shrink-0 ${
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

                {selectedEp && (
                  <div className="panel p-0">
                    <div className="flex items-center gap-2 px-5 py-4 border-b border-border">
                      <span className="text-accent font-bold">▶</span>
                      <span className="flex-1 font-display text-base font-semibold">第 {selectedEp.epIndex} 集 · {t.ws_episodes_script}</span>
                      <button
                        onClick={() => {
                          if (episodeEditing === selectedEp.epIndex) {
                            setData((d) => ({
                              ...d,
                              episodeTexts: d.episodeTexts.map((et) =>
                                et.epIndex === selectedEp.epIndex ? { ...et, text: episodeDraft } : et
                              ),
                            }))
                            setEpisodeEditing(null)
                            setEpisodeDraft('')
                          } else {
                            setEpisodeEditing(selectedEp.epIndex)
                            setEpisodeDraft(selectedEp.text)
                          }
                        }}
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold transition shrink-0 ${
                          episodeEditing === selectedEp.epIndex
                            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25'
                            : 'border border-border text-text-secondary hover:text-text-primary hover:border-accent hover:bg-bg-elevated'
                        }`}
                      >
                        {episodeEditing === selectedEp.epIndex ? <><Check size={11} /> 完成</> : <><Pencil size={11} /> 编辑</>}
                      </button>
                    </div>
                    {episodeEditing === selectedEp.epIndex ? (
                      <div className="px-5 pb-5 pt-4">
                        <textarea
                          key={`episodes-view-edit-textarea-${selectedEp.epIndex}`}
                          ref={episodeEditRef}
                          value={episodeDraft}
                          onChange={(e) => setEpisodeDraft(e.target.value)}
                          rows={20}
                          className="w-full rounded-lg bg-bg-elevated border border-accent/50 text-sm text-text-primary p-3 leading-7 font-mono focus:outline-none focus:border-accent resize-y overflow-auto"
                          style={{ maxHeight: '70vh' }}
                          placeholder="编辑剧本…"
                        />
                      </div>
                    ) : (
                      <div className="px-5 pb-5 pt-4 prose prose-invert prose-sm max-w-none text-text-primary whitespace-pre-wrap leading-relaxed text-sm">
                        <ReactMarkdown>{selectedEp.text}</ReactMarkdown>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })()}
          {tab === 'character' && (() => {
            // 角色/场景 都按当前选中集数过滤 —— 一次只看一集。
            const epChars = data.characters.filter((c) => c.episodeIndex === selectedEpisodeIndex)
            const epScenes = data.scenes.filter((s) => s.episodeIndex === selectedEpisodeIndex)
            const hasChars = epChars.length > 0
            const hasScenes = epScenes.length > 0
            const hasAnyEp = data.episodeTexts.some((e) => e.epIndex === selectedEpisodeIndex)
            const extractPrompt = `从第 ${selectedEpisodeIndex} 集提取角色和场景`

            if (!hasChars && !hasScenes) {
              // 当集没数据时,给出"提取本集角色"的入口(快捷路径),
              // 避免用户切到角色 tab 后看到一个空壳还要跑去 chat 里发命令。
              return (
                <div className="max-w-4xl mx-auto panel p-10 text-center space-y-3">
                  <Users size={36} className="mx-auto text-text-muted" />
                  <p className="text-text-secondary font-medium">第 {selectedEpisodeIndex} 集 还没有角色和场景</p>
                  <p className="text-xs text-text-muted leading-relaxed">
                    {hasAnyEp
                      ? '点击下方按钮,AI 会从当集剧本里提取本集出现的角色和场景,自动给角色生成形象参考图。'
                      : '请先在「分集」标签生成当集剧本,然后回到这里提取角色。'}
                  </p>
                  {hasAnyEp && (
                    <button
                      type="button"
                      onClick={() => void produce('character', extractPrompt)}
                      className="mt-2 inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-accent-dim text-accent text-sm font-semibold hover:bg-accent hover:text-white transition disabled:opacity-40"
                    >
                      <Sparkles size={13} /> 提取第 {selectedEpisodeIndex} 集角色和场景
                    </button>
                  )}
                  {!hasAnyEp && (
                    <button
                      type="button"
                      onClick={() => setTab('episodes')}
                      className="mt-2 inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-accent-dim text-accent text-sm font-semibold hover:bg-accent hover:text-white transition"
                    >
                      切到分集剧本 →
                    </button>
                  )}
                </div>
              )
            }

            const order: Record<GenCharacter['role'], number> = { lead: 0, supporting: 1, villain: 2 }
            const sorted = [...epChars].sort((a, b) => order[a.role] - order[b.role])
            const SCENE_TIME_LABELS: Record<string, string> = { DAY: '日', NIGHT: '夜', DUSK: '黄昏', DAWN: '黎明' }

            return (
              <div className="-m-6 h-[calc(100vh-3rem)] flex flex-col">
                <div className="flex items-center gap-2 px-6 pt-4 pb-2 shrink-0 flex-wrap">
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-accent-dim text-accent text-xs font-semibold border border-accent/40">
                    <Users size={12} /> 第 {selectedEpisodeIndex} 集
                  </span>
                  <button
                    onClick={() => setCharViewTab('characters')}
                    className={`px-4 py-1.5 rounded-full text-sm font-semibold transition border ${
                      charViewTab === 'characters'
                        ? 'bg-accent-dim text-accent border-accent'
                        : 'border-border text-text-secondary hover:text-text-primary hover:bg-bg-elevated'
                    }`}
                  >
                    角色 {hasChars && `(${epChars.length})`}
                  </button>
                  <button
                    onClick={() => setCharViewTab('scenes')}
                    className={`px-4 py-1.5 rounded-full text-sm font-semibold transition border ${
                      charViewTab === 'scenes'
                        ? 'bg-accent-dim text-accent border-accent'
                        : 'border-border text-text-secondary hover:text-text-primary hover:bg-bg-elevated'
                    }`}
                  >
                    场景 {hasScenes && `(${epScenes.length})`}
                  </button>
                  {hasAnyEp && (
                    <button
                      type="button"
                      onClick={() => void produce('character', extractPrompt)}
                      className="ml-auto text-[11px] px-2.5 py-1 rounded border border-border bg-bg-elevated text-text-secondary hover:border-accent hover:text-accent transition inline-flex items-center gap-1"
                      title={`重新从第 ${selectedEpisodeIndex} 集剧本提取(会覆盖本集已有角色/场景)`}
                    >
                      <RefreshCw size={11} /> 重新提取本集
                    </button>
                  )}
                </div>

                <div className="flex-1 overflow-y-auto min-h-0">
                  {charViewTab === 'scenes' ? (
                    hasScenes ? (
                      <div className="px-6 py-4 space-y-4">
                        {epScenes.map((s) => (
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
                      <div className="flex flex-col items-center justify-center h-full gap-2">
                        <p className="text-text-muted text-sm">第 {selectedEpisodeIndex} 集 暂无场景数据</p>
                        {hasAnyEp && (
                          <button
                            type="button"
                            onClick={() => void produce('character', extractPrompt)}
                            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-accent-dim text-accent text-xs font-semibold hover:bg-accent hover:text-white transition"
                          >
                            <Sparkles size={11} /> 提取本集场景
                          </button>
                        )}
                      </div>
                    )
                  ) : hasChars ? (
                    <div className="px-6 py-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                      {(() => {
                        // 把"每个角色每个 look"展平成"每张卡片一行",保证同角色
                        // 不同造型各自一张卡(男主角-医生 / 男主角-穿越 ...)。
                        type DisplayCard = {
                          character: GenCharacter
                          lookId: string | null  // null = 默认
                          lookLabel: string
                          imageKey: string
                        }
                        const cards: DisplayCard[] = []
                        for (const c of sorted) {
                          cards.push({
                            character: c, lookId: null, lookLabel: '默认',
                            imageKey: c.id,
                          })
                          for (const lk of c.looks ?? []) {
                            cards.push({
                              character: c, lookId: lk.id, lookLabel: lk.label,
                              imageKey: `${c.id}::${lk.id}`,
                            })
                          }
                        }
                        return cards.map((card) => {
                          const { character: c, lookLabel, imageKey } = card
                          const hasImg = !!(charImages[imageKey] && charImages[imageKey].length > 0)
                          // 并行策略:不同角色同时跑,同角色串行。
                          //   activeImageKey === imageKey: 这张图**正在画**
                          //   busyChars.has(c.id) 但 activeImageKey 不是这张:同角色下一张在排队
                          //   都不在:没排上(其他角色在画、或本角色所有 look 都好了)
                          const isActive = activeImageKey === imageKey
                          const isQueued = !isActive && busyChars.has(c.id)
                          // I2I 重生(按意见 / 三视图 / 多维资产)是否在这张卡上跑,
                          // 跑了就显示黑屏遮罩 + 对应模式的提示文字。
                          const regenMode = regenBusyKeys.get(imageKey)
                          const isRegening = regenMode !== undefined
                          const regenLabel =
                            regenMode === 'three-view' ? '正在生成三视图…' :
                            regenMode === 'multi-asset' ? '正在生成多维资产图…' :
                            regenMode === 'modify' ? '正在按意见重生…' :
                            '正在生成…'
                          const [primary, ...rest] = c.roleLabel.split('·').map((s) => s.trim()).filter(Boolean)
                          const archetype = rest.join(' · ')
                          const brief = c.personality?.trim() || ''
                          const cardTitle = card.lookId === null ? c.name : `${c.name} · ${lookLabel}`
                          return (
                            // 外层用 div role="button" 而不是 <button>:卡片内部还要
                            // 套 3 个真正的 <button>(修改 / 三视图 / 多维资产),
                            // <button> 不能嵌 <button>,会 hydration error。
                            <div
                              key={imageKey}
                              role="button"
                              tabIndex={0}
                              onClick={() => setPreviewTarget({ character: c, lookId: card.lookId })}
                              onKeyDown={(e) => {
                                // 键盘可达:Enter / Space 等价于点击
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault()
                                  setPreviewTarget({ character: c, lookId: card.lookId })
                                }
                              }}
                              className="group relative text-left rounded-xl border border-border bg-bg-elevated/40 hover:border-accent hover:bg-bg-elevated/70 hover:-translate-y-0.5 transition-all overflow-hidden flex flex-col focus:outline-none focus:ring-2 focus:ring-accent/40 cursor-pointer"
                            >
                              {/* Image area — portrait aspect, fills card top */}
                              <div className="relative w-full aspect-[3/4] bg-bg-base overflow-hidden">
                                {isActive && !hasImg ? (
                                  // 这张图**正在画**:spinner
                                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-text-muted">
                                    <Loader2 size={22} className="animate-spin text-accent" />
                                    <span className="text-[10px]">生成中…</span>
                                  </div>
                                ) : hasImg ? (
                                  <img
                                    src={charImages[imageKey]!.at(-1)}
                                    alt={cardTitle}
                                    loading="lazy"
                                    className="absolute inset-0 w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300"
                                  />
                                ) : isQueued ? (
                                  // 同角色下一张在排队(本角色在跑)
                                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-text-muted">
                                    <Loader2 size={14} className="opacity-50 animate-spin" />
                                    <span className="text-[10px]">同角色排队中…</span>
                                  </div>
                                ) : autoGen && busyChars.size > 0 ? (
                                  // 其他角色在画,这张在等
                                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-text-muted">
                                    <ImageIcon size={22} className="opacity-50" />
                                    <span className="text-[10px]">排队生成中…</span>
                                  </div>
                                ) : (
                                  // 手动模式(无 autoGen):提示用户点击生成
                                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-text-muted">
                                    <ImageIcon size={22} className="opacity-50" />
                                    <span className="text-[10px]">点击生成形象</span>
                                  </div>
                                )}
                                {/* Hover hint */}
                                <div className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded-full bg-black/55 backdrop-blur-sm text-white text-[10px] opacity-0 group-hover:opacity-100 transition">
                                  点击查看详情
                                </div>
                              </div>

                              {/* Text area — flex column 拉伸,按钮用 mt-auto 钉到卡片底部,
                                  不管 brief 有多长 / 是否存在,3 个按钮始终贴底。 */}
                              <div className="p-2.5 flex flex-col flex-1 gap-1.5">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <span
                                    className="w-0.5 h-4 rounded-full shrink-0"
                                    style={{ background: c.palette[0] ?? 'var(--accent)' }}
                                    aria-hidden
                                  />
                                  <h3 className="font-display text-sm font-bold text-text-primary truncate">{cardTitle}</h3>
                                  <span className="ml-auto text-[10px] text-text-muted tabular-nums shrink-0">{c.age}岁</span>
                                </div>
                                <div className="flex items-center gap-1 flex-wrap">
                                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${ROLE_TONE[c.role]}`}>
                                    {primary || ROLE_LABEL_FALLBACK[c.role]}
                                  </span>
                                  {archetype && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-border bg-bg-elevated/60 text-text-secondary truncate max-w-full">
                                      {archetype}
                                    </span>
                                  )}
                                </div>
                                {brief && (
                                  <p className="text-[11px] text-text-secondary leading-relaxed line-clamp-2">{brief}</p>
                                )}
                                {/* 操作按钮:修改 / 标准三视图 / 多维资产图
                                    图标在上 / 文字在下(vertical stack),让 3 个按钮等宽,
                                    不会再因为"多维资产"4 字长度换行。mt-auto 让按钮行
                                    永远贴着卡片底部。注意 onClick 里 e.stopPropagation(),
                                    否则点按钮也会触发卡片整体的预览打开。 */}
                                <div className="grid grid-cols-3 gap-1.5 pt-1 mt-auto" onClick={(e) => e.stopPropagation()}>
                                  <button
                                    type="button"
                                    title="基于此形象给出修改意见(右侧弹输入框)"
                                    disabled={!hasImg || isRegening}
                                    onClick={() => openModPanel(c, card.lookId)}
                                    className="px-1 py-1.5 rounded border border-border bg-bg-surface text-text-secondary text-[11px] leading-none hover:border-accent hover:text-accent disabled:opacity-40 disabled:cursor-not-allowed transition flex flex-col items-center justify-center gap-0.5"
                                  >
                                    <Pencil size={12} />
                                    <span>修改</span>
                                  </button>
                                  <button
                                    type="button"
                                    title="生成标准三视图(front / side / back)"
                                    disabled={!hasImg || isRegening}
                                    onClick={() => void runPresetRegen(c, card.lookId, 'three-view')}
                                    className="px-1 py-1.5 rounded border border-border bg-bg-surface text-text-secondary text-[11px] leading-none hover:border-accent hover:text-accent disabled:opacity-40 disabled:cursor-not-allowed transition flex flex-col items-center justify-center gap-0.5"
                                  >
                                    <LayoutGrid size={12} />
                                    <span>三视图</span>
                                  </button>
                                  <button
                                    type="button"
                                    title="生成多维资产图(多姿态/表情/场景)"
                                    disabled={!hasImg || isRegening}
                                    onClick={() => void runPresetRegen(c, card.lookId, 'multi-asset')}
                                    className="px-1 py-1.5 rounded border border-border bg-bg-surface text-text-secondary text-[11px] leading-none hover:border-accent hover:text-accent disabled:opacity-40 disabled:cursor-not-allowed transition flex flex-col items-center justify-center gap-0.5"
                                  >
                                    <Sparkles size={12} />
                                    <span>多维资产</span>
                                  </button>
                                </div>
                              </div>
                              {/* I2I 重生遮罩:点了三视图/多维资产/按意见重生后,
                                  把整张卡盖住(spinner + 模式对应的提示文字),
                                  防止用户重复点 / 让进度可见。 */}
                              {isRegening && (
                                <div
                                  role="status"
                                  aria-live="polite"
                                  className="absolute inset-0 z-20 bg-black/75 backdrop-blur-sm flex flex-col items-center justify-center gap-3 text-white px-3 text-center"
                                >
                                  <Loader2 size={28} className="animate-spin text-accent" />
                                  <div className="text-sm font-medium leading-snug">{regenLabel}</div>
                                  <div className="text-[10px] text-white/60 leading-snug">生成中请勿关闭页面</div>
                                </div>
                              )}
                            </div>
                          )
                        })
                      })()}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full gap-2">
                      <p className="text-text-muted text-sm">第 {selectedEpisodeIndex} 集 暂无角色数据</p>
                      {hasAnyEp && (
                        <button
                          type="button"
                          onClick={() => void produce('character', extractPrompt)}
                          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-accent-dim text-accent text-xs font-semibold hover:bg-accent hover:text-white transition"
                        >
                          <Sparkles size={11} /> 提取本集角色
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          })()}
          {tab === 'storyboard' && (() => {
            // ==============================================================
            //  新分镜编辑器视图(v2)
            //  - 列:左 plot 描述 / 中 AI 字段 + 分镜图 / 右 视频占位
            //  - 数据源:data.storyboardGroups(由"进入分镜"按钮从当集剧情 AI 切分)
            //  - 每行可单独重新生成,也可一键整组生成
            //  - 分镜组按集数过滤:只展示当前选中集的分镜。
            // ==============================================================
            const epGroups = data.storyboardGroups.filter((g) => g.episodeIndex === selectedEpisodeIndex)
            const hasAnyEp = data.episodeTexts.some((e) => e.epIndex === selectedEpisodeIndex)
            const hasEpChars = data.characters.some((c) => c.episodeIndex === selectedEpisodeIndex)
            if (epGroups.length === 0) {
              const needsChars = !hasEpChars && hasAnyEp
              return (
                <div className="max-w-4xl mx-auto panel p-10 text-center space-y-3">
                  <Camera size={36} className="mx-auto text-text-muted" />
                  <p className="text-text-secondary font-medium">第 {selectedEpisodeIndex} 集 还没有分镜</p>
                  {hasAnyEp ? (
                    <>
                      <p className="text-xs text-text-muted leading-relaxed">
                        {needsChars
                          ? '本集还没有角色。先切到「角色」标签提取本集角色(角色和场景是分镜的素材),再回来点击下方按钮切分本集剧情为分镜组。'
                          : '点击下方按钮,系统会把当集剧本发给 AI 切分成多组分镜,并按剧情 / 镜头自动生成多图融合的分镜图。'}
                      </p>
                      <button
                        type="button"
                        onClick={() => void runEnterStoryboard()}
                        disabled={busyStoryboardGen || needsChars}
                        className="mt-2 inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-accent-dim text-accent text-sm font-semibold hover:bg-accent hover:text-white transition disabled:opacity-40"
                      >
                        {busyStoryboardGen
                          ? <><Loader2 size={13} className="animate-spin" /> AI 切分中…</>
                          : <><Sparkles size={13} /> 进入第 {selectedEpisodeIndex} 集分镜</>}
                      </button>
                      {needsChars && (
                        <button
                          type="button"
                          onClick={() => setTab('character')}
                          className="block mx-auto text-[11px] text-text-muted hover:text-accent transition"
                        >
                          → 先去提取本集角色
                        </button>
                      )}
                    </>
                  ) : (
                    <>
                      <p className="text-xs text-text-muted leading-relaxed">
                        请先在「分集」标签生成第 {selectedEpisodeIndex} 集剧本,然后回来切分分镜。
                      </p>
                      <button
                        type="button"
                        onClick={() => setTab('episodes')}
                        className="mt-2 inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-accent-dim text-accent text-sm font-semibold hover:bg-accent hover:text-white transition"
                      >
                        切到分集剧本 →
                      </button>
                    </>
                  )}
                </div>
              )
            }
            return (
              <div className="max-w-6xl mx-auto space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h2 className="font-display text-lg font-bold inline-flex items-center gap-2">
                    <Camera size={16} /> 分镜 · 第 {selectedEpisodeIndex} 集 · {epGroups.length} 组
                  </h2>
                  <div className="flex items-center gap-2">
                    {busyStoryboardGen && (
                      <span className="inline-flex items-center gap-1 text-xs text-accent">
                        <Loader2 size={12} className="animate-spin" /> AI 切分中…
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => void runEnterStoryboard()}
                      disabled={busyStoryboardGen}
                      className="text-xs px-2.5 py-1 rounded border border-border bg-bg-elevated text-text-secondary hover:border-accent hover:text-accent transition inline-flex items-center gap-1 disabled:opacity-40"
                    >
                      <Sparkles size={11} /> 重新切分
                    </button>
                  </div>
                </div>
                {epGroups.map((g) => {
                  const allShotsHaveImage = g.shots.every((s) => s.imageUrl)
                  const anyBusy = g.shots.some((s) => busyShotImages.has(`${g.id}::${s.id}`))
                  return (
                    <div key={g.id} className="panel p-4 space-y-3">
                      {/* 行 header:序号 / 起始-结束秒 / 场景 / 角色 / 一键生成 */}
                      <div className="flex items-start gap-3 flex-wrap">
                        <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-accent-dim text-accent text-xs font-bold shrink-0">#{g.index}</span>
                        <div className="flex-1 min-w-0 space-y-1.5">
                          <div className="flex items-center gap-2 flex-wrap text-[11px] text-text-muted">
                            <span className="font-mono px-1.5 py-0.5 rounded bg-bg-base border border-border">
                              {g.startSec.toFixed(0)}s → {g.endSec.toFixed(0)}s · {(g.endSec - g.startSec).toFixed(0)}s
                            </span>
                            {g.sceneLocation && (
                              <span className="px-1.5 py-0.5 rounded bg-bg-base border border-border">
                                📍 {g.sceneLocation}
                              </span>
                            )}
                            {g.characterIds.length > 0 && (
                              <span className="px-1.5 py-0.5 rounded bg-bg-base border border-border">
                                👥 {g.characterIds
                                  .map((cid) => data.characters.find((c) => c.id === cid)?.name ?? cid)
                                  .join('、')}
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-text-primary leading-relaxed">{g.plotText}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void generateAllShotsForGroup(g.id)}
                          disabled={anyBusy || allShotsHaveImage}
                          className="text-[11px] px-2.5 py-1 rounded border border-accent text-accent bg-accent-dim hover:bg-accent hover:text-white transition disabled:opacity-40 inline-flex items-center gap-1 shrink-0"
                        >
                          {anyBusy ? <><Loader2 size={11} className="animate-spin" /> 生成中…</>
                            : allShotsHaveImage ? '✓ 已生成'
                            : <><Sparkles size={11} /> 一键生成全部</>}
                        </button>
                      </div>
                      {/* 四列:左 plot / 中-左 分镜图(2 列多行) / 中-右 故事板占位 / 右 视频占位
                          比例:1.2 / 2 / 1.5 / 1 —— 分镜图占大头(2 列多行天然把行拉高),
                          故事板留足未来空间,视频放最右。 */}
                      <div className="grid grid-cols-1 md:grid-cols-[1.2fr_2fr_1.5fr_1fr] gap-3">
                        {/* 左:plot 描述(其实 header 已显示,这里给个折叠补充 + 角色列表) */}
                        <div className="rounded-lg border border-border bg-bg-base/40 p-3 space-y-2">
                          <div className="text-[10px] tracking-widest uppercase text-text-muted">剧情 · Plot</div>
                          <p className="text-xs text-text-secondary leading-relaxed">{g.plotText}</p>
                          {g.characterIds.length > 0 && (
                            <div className="pt-2 mt-1 border-t border-border/60 space-y-1">
                              <div className="text-[10px] tracking-widest uppercase text-text-muted">涉及角色</div>
                              <div className="flex flex-wrap gap-1.5">
                                {g.characterIds.map((cid) => {
                                  const ch = data.characters.find((c) => c.id === cid)
                                  if (!ch) return null
                                  const img = charImages[cid]?.[charImages[cid].length - 1]
                                  return (
                                    <div key={cid} className="flex items-center gap-1.5 px-1.5 py-1 rounded bg-bg-elevated border border-border">
                                      <div className="w-5 h-5 rounded-full overflow-hidden bg-bg-base shrink-0">
                                        {img
                                          ? <img src={img} alt={ch.name} className="w-full h-full object-cover" />
                                          : <div className="w-full h-full flex items-center justify-center text-[8px] text-text-muted">N/A</div>}
                                      </div>
                                      <span className="text-[11px] text-text-primary">{ch.name}</span>
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                        {/* 中-左:分镜图(锁死 2 列,shot 数 = 3 时变成 2 行,行天然变高) */}
                        <div className="rounded-lg border border-border bg-bg-base/40 p-3 space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="text-[10px] tracking-widest uppercase text-text-muted">分镜图 · Shots ({g.shots.length})</div>
                            <div className="text-[10px] text-text-muted">多图融合:角色 + 场景</div>
                          </div>
                          <div className="grid grid-cols-2 gap-2 auto-rows-fr">
                            {g.shots.map((s) => {
                              const isBusy = busyShotImages.has(`${g.id}::${s.id}`)
                              const shotImageKey = `${g.id}::${s.id}`
                              // 优先用历史数组的最新一张;没历史才回落到 g.shots[i].imageUrl
                              // (旧数据没有 shotImages,这条 fallback 让老数据继续能渲染)
                              const generations = shotImages[shotImageKey]
                              const currentUrl = generations && generations.length > 0
                                ? generations[generations.length - 1]
                                : s.imageUrl
                              return (
                                <div key={s.id} className="rounded border border-border bg-bg-elevated overflow-hidden flex flex-col">
                                  <div className="relative aspect-video bg-bg-base group">
                                    {currentUrl ? (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img
                                        src={currentUrl}
                                        alt={s.action}
                                        className="absolute inset-0 w-full h-full object-cover"
                                      />
                                    ) : isBusy ? (
                                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-text-muted">
                                        <Loader2 size={20} className="animate-spin text-accent" />
                                        <span className="text-[10px]">融合中…</span>
                                      </div>
                                    ) : (
                                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-text-muted">
                                        <ImageIcon size={20} className="opacity-50" />
                                        <span className="text-[10px]">点击下方生成</span>
                                      </div>
                                    )}
                                    <span className="absolute top-1.5 left-1.5 text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/60 text-white">
                                      {s.shotTypeLabel}
                                    </span>
                                    {/* 放大按钮:有图时显示,hover 时露出。点击打开预览模态。 */}
                                    {currentUrl && (
                                      <button
                                        type="button"
                                        aria-label="放大查看分镜图"
                                        onClick={() => {
                                          setShotSelectedGenIdx(generations ? generations.length - 1 : 0)
                                          setShotModInput('')
                                          setShotPreview({ groupId: g.id, shotId: s.id })
                                        }}
                                        className="absolute top-1.5 right-1.5 p-1 rounded bg-black/60 text-white opacity-0 group-hover:opacity-100 transition hover:bg-black/80"
                                      >
                                        <Maximize2 size={12} />
                                      </button>
                                    )}
                                  </div>
                                  <div className="p-2 space-y-1">
                                    <p className="text-[11px] text-text-primary line-clamp-2 leading-snug">{s.action}</p>
                                    {s.camera && <p className="text-[10px] text-text-muted line-clamp-1">🎥 {s.camera}</p>}
                                    <button
                                      type="button"
                                      onClick={() => void generateShotImageForGroup(g.id, s.id)}
                                      disabled={isBusy}
                                      className="w-full mt-1 text-[10px] py-1 rounded border border-border bg-bg-surface text-text-secondary hover:border-accent hover:text-accent transition disabled:opacity-40 inline-flex items-center justify-center gap-1"
                                    >
                                      {isBusy
                                        ? <><Loader2 size={9} className="animate-spin" /> 生成中</>
                                        : s.imageUrl
                                          ? <><RefreshCw size={9} /> 重新生成</>
                                          : <><Sparkles size={9} /> 生成本镜头</>}
                                    </button>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                        {/* 中-右:故事板占位 —— 暂时不实现,留空间以后挂镜头时序 / 摄影表 / 动画参考等。
                            视觉上跟视频占位对齐(同一种虚线框 + 小图标 + "未启用"提示),
                            行为上是只读占位,不会有任何点击效果。 */}
                        <div className="rounded-lg border border-border bg-bg-base/40 p-3 space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="text-[10px] tracking-widest uppercase text-text-muted">故事板 · Storyboard</div>
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-bg-elevated border border-border text-text-muted">未启用</span>
                          </div>
                          <div className="aspect-video rounded border border-dashed border-border bg-bg-base flex flex-col items-center justify-center gap-1.5 text-text-muted">
                            <FileText size={20} className="opacity-40" />
                            <span className="text-[10px]">故事板占位</span>
                            <span className="text-[9px] opacity-70">功能暂未开放</span>
                          </div>
                          <p className="text-[10px] text-text-muted leading-relaxed">
                            未来会承载本组镜头的时序、摄影表、动画参考等扩展信息。当前版本留白,不参与生成。
                          </p>
                        </div>
                        {/* 右:视频占位 */}
                        <div className="rounded-lg border border-border bg-bg-base/40 p-3 space-y-2">
                          <div className="text-[10px] tracking-widest uppercase text-text-muted">视频 · Video</div>
                          <div className="aspect-video rounded border border-dashed border-border bg-bg-base flex flex-col items-center justify-center gap-1.5 text-text-muted">
                            <Camera size={20} className="opacity-40" />
                            <span className="text-[10px]">视频占位</span>
                            <span className="text-[9px] opacity-70">({(g.endSec - g.startSec).toFixed(0)}s 暂不生成)</span>
                          </div>
                          <p className="text-[10px] text-text-muted leading-relaxed">
                            未来接 I2V / S2V 模型后,可用本组的分镜图 + 角色 / 场景参考图生成本段视频。
                          </p>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })()}
          {tab === 'timeline' && (() => {
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
                  {completedStages.has('timeline') && <span className="inline-flex items-center gap-0.5 text-xs text-emerald-400"><CheckCircle2 size={12} /> 已完成</span>}
                </div>
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
          })()}
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
          onImportScript={handleImportScript}
          streaming={synopsisStreaming || episodeStreaming}
          onEnterStoryboard={() => void runEnterStoryboard()}
        />
      </div>
      {previewTarget && (() => {
        const c = previewTarget.character
        const lk = previewTarget.lookId == null
          ? null
          : c.looks?.find((x) => x.id === previewTarget.lookId) ?? null
        const imageKey = lk ? `${c.id}::${lk.id}` : c.id
        const generations = charImages[imageKey] ?? []
        const currentIdx = Math.min(selectedGenIdx, Math.max(0, generations.length - 1))
        const currentUrl = generations[currentIdx]
        const faceDesc = lk?.faceDescription || c.faceDescription
        const bodyDesc = lk?.bodyDescription || c.bodyDescription
        const clothDesc = lk?.clothingDescription || c.clothingDescription
        const lookLabelForCall = lk?.label || '默认'
        const cardTitle = lk ? `${c.name} · ${lk.label}` : c.name
        return (
          <div
            className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => { setPreviewTarget(null); setRegenInput('') }}
            role="dialog"
            aria-modal="true"
          >
            <div
              className="relative bg-bg-surface border border-border rounded-2xl overflow-hidden shadow-2xl w-full max-w-[1280px] h-[88vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Top bar */}
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0">
                <div className="min-w-0">
                  <div className="font-display text-base font-bold text-text-primary truncate">{cardTitle}</div>
                  <div className="text-xs text-text-muted">{c.roleLabel} · {c.age} 岁 · 共 {generations.length} 张</div>
                </div>
                <button
                  type="button"
                  onClick={() => { setPreviewTarget(null); setRegenInput('') }}
                  className="p-1.5 rounded-md hover:bg-bg-elevated text-text-muted"
                  aria-label="关闭"
                >
                  <X size={16} />
                </button>
              </div>

              {/* 3 列布局:左 thumbnails / 中 大图 / 右 描述+输入 */}
              <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[120px_1fr_360px] gap-3 p-3">
                {/* === Left: thumbnails of the SAME look, all generations === */}
                <aside className="overflow-y-auto pr-1 space-y-2 min-h-0">
                  <div className="text-[10px] text-text-muted px-1 pb-1 sticky top-0 bg-bg-surface">
                    历史生成（{generations.length}）
                  </div>
                  {generations.length === 0 ? (
                    <div className="aspect-[3/4] rounded border border-dashed border-border flex items-center justify-center text-[10px] text-text-muted text-center px-1">
                      暂无图片
                    </div>
                  ) : (
                    generations.map((u, i) => (
                      <button
                        key={`${u}-${i}`}
                        type="button"
                        onClick={() => setSelectedGenIdx(i)}
                        className={`block w-full rounded border-2 overflow-hidden transition ${
                          i === currentIdx ? 'border-accent' : 'border-border hover:border-accent/60'
                        }`}
                        title={`第 ${i + 1} 张`}
                      >
                        <div className="relative w-full aspect-[3/4] bg-bg-base">
                          <img
                            src={u}
                            alt={`${cardTitle} #${i + 1}`}
                            loading="lazy"
                            className="absolute inset-0 w-full h-full object-cover"
                          />
                          {i === generations.length - 1 && (
                            <span className="absolute top-1 left-1 px-1 py-0.5 rounded bg-accent text-accent-foreground text-[9px] font-semibold">
                              NEW
                            </span>
                          )}
                          <span className="absolute bottom-1 right-1 px-1 py-0.5 rounded bg-black/60 text-white text-[9px] tabular-nums">
                            #{i + 1}
                          </span>
                        </div>
                      </button>
                    ))
                  )}
                </aside>

                {/* === Center: large selected image, fills the box === */}
                <div className="relative bg-bg-base rounded-lg overflow-hidden flex items-center justify-center min-h-0">
                  {currentUrl ? (
                    <img
                      src={currentUrl}
                      alt={cardTitle}
                      className="max-w-full max-h-full object-contain"
                    />
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-text-muted">
                      <ImageIcon size={40} className="opacity-50" />
                      <p className="text-sm">还没有生成形象，请到右侧输入修改意见</p>
                    </div>
                  )}
                  {regenBusy && (
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                      <div className="flex flex-col items-center gap-2 text-white">
                        <Loader2 size={32} className="animate-spin" />
                        <span className="text-sm">正在按你的意见重生…</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* === Right top: description / Right bottom: input dialog === */}
                <div className="flex flex-col min-h-0 gap-3">
                  {/* Right TOP: 描述 */}
                  <div className="flex-1 min-h-0 overflow-y-auto rounded-lg border border-border bg-bg-elevated/40 p-3 space-y-2">
                    <div>
                      <div className="text-[10px] uppercase tracking-wide text-text-muted">当前选中</div>
                      <div className="text-sm font-semibold text-text-primary mt-0.5">
                        {currentUrl ? `第 ${currentIdx + 1} / ${generations.length} 张` : '未生成'}
                      </div>
                    </div>
                    <dl className="space-y-1.5 text-xs">
                      <div><dt className="text-text-muted">性别</dt><dd className="text-text-secondary">{c.gender || '-'}</dd></div>
                      <div><dt className="text-text-muted">年龄</dt><dd className="text-text-secondary">{c.age} 岁</dd></div>
                      <div><dt className="text-text-muted">面部</dt><dd className="text-text-secondary">{faceDesc || '-'}</dd></div>
                      <div><dt className="text-text-muted">身材</dt><dd className="text-text-secondary">{bodyDesc || '-'}</dd></div>
                      <div>
                        <dt className="text-text-muted">服装{lk ? `（${lk.label}）` : ''}</dt>
                        <dd className="text-text-secondary">{clothDesc || '-'}</dd>
                      </div>
                    </dl>
                    {/* 如果角色有多个 look,展示 look 切换 */}
                    {(c.looks?.length ?? 0) > 0 && (
                      <div className="pt-1 flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          onClick={() => { setPreviewTarget({ character: c, lookId: null }); setSelectedGenIdx(0) }}
                          className={`text-[10px] px-2 py-1 rounded-full border ${
                            previewTarget.lookId == null
                              ? 'border-accent bg-accent-dim/40 text-text-primary'
                              : 'border-border bg-bg-elevated/60 text-text-secondary hover:border-accent'
                          }`}
                        >
                          默认
                        </button>
                        {c.looks!.map((x) => (
                          <button
                            key={x.id}
                            type="button"
                            onClick={() => { setPreviewTarget({ character: c, lookId: x.id }); setSelectedGenIdx(0) }}
                            className={`text-[10px] px-2 py-1 rounded-full border ${
                              previewTarget.lookId === x.id
                                ? 'border-accent bg-accent-dim/40 text-text-primary'
                                : 'border-border bg-bg-elevated/60 text-text-secondary hover:border-accent'
                            }`}
                          >
                            {x.label}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="flex gap-1 pt-1">
                      {c.palette.map((p) => (
                        <span key={p} className="w-5 h-5 rounded border border-border" style={{ background: p }} title={p} />
                      ))}
                    </div>
                  </div>

                  {/* Right BOTTOM: 修改入口(点按钮打开右侧 slide-in 面板) */}
                  <div className="shrink-0 rounded-lg border border-border bg-bg-elevated/40 p-3 space-y-2">
                    <div className="text-xs text-text-secondary font-semibold">修改形象</div>
                    <p className="text-[10px] text-text-muted leading-relaxed">
                      点下面的按钮,右侧滑出输入面板,输入修改意见。AI 会保留这张形象的:脸、身材、视觉风格、正视角度、纯白 #FFFFFF 背景、无表情。只改你描述的部分。
                    </p>
                    <button
                      type="button"
                      onClick={() => openModPanel(c, previewTarget.lookId)}
                      disabled={!currentUrl}
                      className="w-full px-3 py-1.5 rounded-md bg-accent text-accent-foreground text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 inline-flex items-center justify-center gap-1.5"
                    >
                      <Pencil size={12} /> 输入修改意见
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ============= 右侧 slide-in 修改面板 =============
          由卡片底部的"修改"按钮触发。不需要进人物卡片预览,直接在这里
          输入意见 → 发送 → 关闭面板,新图替换卡片封面并加入 history。 */}
      {modPanel && (() => {
        const c = modPanel.character
        const lk = modPanel.lookId == null
          ? null
          : c.looks?.find((x) => x.id === modPanel.lookId) ?? null
        const title = lk ? `${c.name} · ${lk.label}` : c.name
        const currentUrl = (charImages[modPanel.imageKey] ?? []).at(-1)
        return (
          <>
            {/* 半透明背景遮罩:点击关闭(modBusy 时不响应) */}
            <div
              className="fixed inset-0 z-40 bg-black/40"
              onClick={closeModPanel}
              aria-hidden
            />
            <aside
              className="fixed top-0 right-0 bottom-0 z-50 w-[400px] max-w-[90vw] bg-bg-surface border-l border-border shadow-2xl flex flex-col"
              role="dialog"
              aria-modal="true"
            >
              {/* Header */}
              <div className="flex items-start justify-between px-4 py-3 border-b border-border shrink-0">
                <div className="min-w-0">
                  <div className="text-xs text-text-muted">修改形象</div>
                  <div className="font-display text-base font-bold text-text-primary truncate">{title}</div>
                  <div className="text-[11px] text-text-muted">{c.roleLabel} · {c.age} 岁</div>
                </div>
                <button
                  type="button"
                  onClick={closeModPanel}
                  disabled={modBusy}
                  className="p-1.5 rounded-md hover:bg-bg-elevated text-text-muted disabled:opacity-30 disabled:cursor-not-allowed"
                  aria-label="关闭"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Body */}
              <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
                {/* 当前参考图(让用户知道自己在改哪张) */}
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-text-muted mb-1.5">当前参考图</div>
                  <div className="relative w-full aspect-[3/4] bg-bg-base rounded-lg overflow-hidden border border-border">
                    {currentUrl ? (
                      <img
                        src={currentUrl}
                        alt={title}
                        className="absolute inset-0 w-full h-full object-contain"
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center text-text-muted text-xs">
                        该形象还没生成
                      </div>
                    )}
                  </div>
                </div>

                {/* 形象描述(给用户参考,也是发给 AI 的素材) */}
                <details className="rounded-lg border border-border bg-bg-elevated/40">
                  <summary className="px-3 py-2 text-xs text-text-secondary cursor-pointer select-none">
                    形象描述(将随修改意见一起发给 AI)
                  </summary>
                  <dl className="px-3 pb-3 pt-1 space-y-1.5 text-[11px]">
                    <div><dt className="text-text-muted">面部</dt><dd className="text-text-secondary">{c.faceDescription || '-'}</dd></div>
                    <div><dt className="text-text-muted">身材</dt><dd className="text-text-secondary">{c.bodyDescription || '-'}</dd></div>
                    <div><dt className="text-text-muted">服装{lk ? `（${lk.label}）` : ''}</dt><dd className="text-text-secondary">{lk?.clothingDescription || c.clothingDescription || '-'}</dd></div>
                  </dl>
                </details>

                {/* 修改意见输入 */}
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-text-muted mb-1.5">修改意见</div>
                  <textarea
                    value={modInput}
                    onChange={(e) => setModInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault()
                        void submitModPanel()
                      }
                    }}
                    placeholder="例如:把头发改成黑色短发 / 加一副黑框眼镜 / 把外套换成红色风衣 / 表情放松一些…"
                    rows={6}
                    disabled={modBusy}
                    className="w-full rounded-md bg-bg-elevated border border-border text-sm text-text-primary p-2 focus:border-accent focus:outline-none resize-none placeholder:text-text-muted disabled:opacity-50"
                  />
                  <p className="text-[10px] text-text-muted mt-1.5 leading-relaxed">
                    AI 会保留:脸、身材、视觉风格、正视角度、纯白 #FFFFFF 背景、无表情。只改你描述的部分。
                  </p>
                </div>

                {/* 错误提示 */}
                {modError && (
                  <div className="px-3 py-2 rounded-md bg-rose-500/10 border border-rose-500/30 text-xs text-rose-400">
                    {modError}
                  </div>
                )}
              </div>

              {/* Footer:发送按钮 */}
              <div className="shrink-0 border-t border-border p-3 flex items-center justify-between gap-2">
                <span className="text-[10px] text-text-muted">⌘/Ctrl + Enter 发送</span>
                <button
                  type="button"
                  onClick={() => void submitModPanel()}
                  disabled={modBusy || !modInput.trim() || !currentUrl}
                  className="px-4 py-1.5 rounded-md bg-accent text-accent-foreground text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 inline-flex items-center gap-1.5"
                >
                  {modBusy ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                  {modBusy ? '生成中…' : '发送修改'}
                </button>
              </div>
            </aside>
          </>
        )
      })()}

      {/* ============= 新增集数 对话框 =============
          顶部下拉最底下的"+ 新增集数"触发。两条路径:
          - AI 生成:走 runScriptEpisode 流式生成(已有集数作为上下文)
          - 导入剧本:读 .txt/.md/.docx,内容直接当本集文本 */}
      {addEpisodeOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
            onClick={closeAddEpisodeDialog}
            aria-hidden
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="新增集数"
            className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
          >
            <div
              className="pointer-events-auto w-full max-w-md rounded-2xl border border-border bg-bg-surface shadow-2xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-5 py-4 border-b border-border flex items-center justify-between">
                <div>
                  <div className="text-xs text-text-muted tracking-wide uppercase">新增集数</div>
                  <div className="font-display text-base font-bold text-text-primary">
                    第 {computeNextEpIndex()} 集
                  </div>
                </div>
                <button
                  type="button"
                  onClick={closeAddEpisodeDialog}
                  disabled={addEpisodeImporting}
                  className="p-1.5 rounded-md hover:bg-bg-elevated text-text-muted disabled:opacity-30 disabled:cursor-not-allowed"
                  aria-label="关闭"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="p-5 space-y-3">
                <p className="text-xs text-text-muted leading-relaxed">
                  {data.episodeTexts.length > 0
                    ? `将在已有 ${data.episodeTexts.length} 集基础上新增第 ${computeNextEpIndex()} 集,前面所有集数会作为 AI 生成的上下文。`
                    : '从第 1 集开始你的剧本。AI 会以"通用剧情"理解(尚未生成梗概),效果可能一般;生成完后可在「剧本」标签补充梗概后重跑。'}
                </p>
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => void handleAddEpisodeAI()}
                    disabled={addEpisodeImporting || episodeStreaming || synopsisStreaming}
                    className="rounded-xl border border-accent bg-accent-dim hover:bg-accent hover:text-white text-accent px-3 py-4 text-sm font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed flex flex-col items-center justify-center gap-1.5"
                  >
                    <Sparkles size={18} />
                    <span>AI 生成</span>
                    <span className="text-[10px] font-normal opacity-80 leading-snug">按已有集数续写</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => addEpisodeFileInputRef.current?.click()}
                    disabled={addEpisodeImporting}
                    className="rounded-xl border border-border bg-bg-elevated hover:border-accent hover:text-accent text-text-secondary px-3 py-4 text-sm font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed flex flex-col items-center justify-center gap-1.5"
                  >
                    {addEpisodeImporting ? <Loader2 size={18} className="animate-spin" /> : <FileText size={18} />}
                    <span>{addEpisodeImporting ? '读取中…' : '导入剧本'}</span>
                    <span className="text-[10px] font-normal opacity-80 leading-snug">.txt / .md / .docx</span>
                  </button>
                </div>
                <input
                  ref={addEpisodeFileInputRef}
                  type="file"
                  accept=".txt,.md,.docx"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    void handleAddEpisodeFilePicked(file)
                  }}
                />
                <p className="text-[10px] text-text-muted leading-relaxed pt-1">
                  提示:多集剧本的统一导入(替换整季)在右侧 AI 助手的「导入剧本」入口,会把全部内容按集拆开。
                </p>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ============= 分镜图 预览 / 修改模态 =============
          跟人物卡片的 previewTarget 模态同一套思路:左侧历史缩略图、中间大图、
          右侧镜头描述 + 修改意见输入 + 发送按钮。
          触发:点 shot 缩略图右上角的"放大"按钮(generateShotImageForGroup 出图后
          才会出现这个按钮)。 */}
      {shotPreview && (() => {
        const { groupId, shotId } = shotPreview
        const group = data.storyboardGroups.find((gg) => gg.id === groupId)
        const shot = group?.shots.find((s) => s.id === shotId)
        if (!group || !shot) return null
        const imageKey = `${groupId}::${shotId}`
        const generations = shotImages[imageKey] ?? (shot.imageUrl ? [shot.imageUrl] : [])
        const currentIdx = Math.min(shotSelectedGenIdx, Math.max(0, generations.length - 1))
        const currentUrl = generations[currentIdx]
        const cardTitle = `${shot.shotTypeLabel} · ${shot.action.slice(0, 24)}${shot.action.length > 24 ? '…' : ''}`
        return (
          <div
            className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => { setShotPreview(null); setShotModInput('') }}
            role="dialog"
            aria-modal="true"
            aria-label="分镜图预览"
          >
            <div
              className="relative bg-bg-surface border border-border rounded-2xl overflow-hidden shadow-2xl w-full max-w-[1280px] h-[88vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Top bar */}
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0">
                <div className="min-w-0">
                  <div className="font-display text-base font-bold text-text-primary truncate">{cardTitle}</div>
                  <div className="text-xs text-text-muted">第 {group.index} 组 · {shot.shotType} · 共 {generations.length} 张</div>
                </div>
                <button
                  type="button"
                  onClick={() => { setShotPreview(null); setShotModInput('') }}
                  className="p-1.5 rounded-md hover:bg-bg-elevated text-text-muted"
                  aria-label="关闭"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[120px_1fr_360px] gap-3 p-3">
                {/* Left: history thumbnails */}
                <aside className="overflow-y-auto pr-1 space-y-2 min-h-0">
                  <div className="text-[10px] text-text-muted px-1 pb-1 sticky top-0 bg-bg-surface">
                    历史生成（{generations.length}）
                  </div>
                  {generations.length === 0 ? (
                    <div className="aspect-video rounded border border-dashed border-border flex items-center justify-center text-[10px] text-text-muted text-center px-1">
                      暂无图片
                    </div>
                  ) : (
                    generations.map((u, i) => (
                      <button
                        key={`${u}-${i}`}
                        type="button"
                        onClick={() => setShotSelectedGenIdx(i)}
                        className={`block w-full rounded border-2 overflow-hidden transition ${
                          i === currentIdx ? 'border-accent' : 'border-border hover:border-accent/60'
                        }`}
                        title={`第 ${i + 1} 张`}
                      >
                        <div className="relative w-full aspect-video bg-bg-base">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={u}
                            alt={`${cardTitle} #${i + 1}`}
                            loading="lazy"
                            className="absolute inset-0 w-full h-full object-cover"
                          />
                          {i === generations.length - 1 && (
                            <span className="absolute top-1 left-1 px-1 py-0.5 rounded bg-accent text-accent-foreground text-[9px] font-semibold">
                              NEW
                            </span>
                          )}
                          <span className="absolute bottom-1 right-1 px-1 py-0.5 rounded bg-black/60 text-white text-[9px] tabular-nums">
                            #{i + 1}
                          </span>
                        </div>
                      </button>
                    ))
                  )}
                </aside>

                {/* Center: large image */}
                <div className="relative bg-bg-base rounded-lg overflow-hidden flex items-center justify-center min-h-0">
                  {currentUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={currentUrl}
                      alt={cardTitle}
                      className="max-w-full max-h-full object-contain"
                    />
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-text-muted">
                      <ImageIcon size={40} className="opacity-50" />
                      <p className="text-sm">还没有分镜图</p>
                    </div>
                  )}
                  {shotModBusy && (
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                      <div className="flex flex-col items-center gap-2 text-white">
                        <Loader2 size={32} className="animate-spin" />
                        <span className="text-sm">正在按你的意见重生…</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Right: description + modify input */}
                <div className="flex flex-col min-h-0 gap-3">
                  <div className="flex-1 min-h-0 overflow-y-auto rounded-lg border border-border bg-bg-elevated/40 p-3 space-y-2">
                    <div>
                      <div className="text-[10px] uppercase tracking-wide text-text-muted">当前选中</div>
                      <div className="text-sm font-semibold text-text-primary mt-0.5">
                        {currentUrl ? `第 ${currentIdx + 1} / ${generations.length} 张` : '未生成'}
                      </div>
                    </div>
                    <dl className="space-y-1.5 text-xs">
                      <div><dt className="text-text-muted">景别</dt><dd className="text-text-secondary">{shot.shotTypeLabel}（{shot.shotType}）</dd></div>
                      <div><dt className="text-text-muted">动作</dt><dd className="text-text-secondary">{shot.action || '-'}</dd></div>
                      {shot.camera && <div><dt className="text-text-muted">机位</dt><dd className="text-text-secondary">🎥 {shot.camera}</dd></div>}
                    </dl>
                    <div className="pt-1">
                      <div className="text-[10px] uppercase tracking-wide text-text-muted">剧情</div>
                      <p className="text-[11px] text-text-secondary leading-relaxed mt-0.5">{group.plotText}</p>
                    </div>
                    {group.characterIds.length > 0 && (
                      <div className="pt-1">
                        <div className="text-[10px] uppercase tracking-wide text-text-muted">涉及角色</div>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {group.characterIds.map((cid) => {
                            const ch = data.characters.find((c) => c.id === cid)
                            return (
                              <span key={cid} className="text-[10px] px-1.5 py-0.5 rounded border border-border bg-bg-elevated text-text-secondary">
                                {ch?.name ?? cid}
                              </span>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="shrink-0 rounded-lg border border-border bg-bg-elevated/40 p-3 space-y-2">
                    <div className="text-xs text-text-secondary font-semibold">修改分镜图</div>
                    <p className="text-[10px] text-text-muted leading-relaxed">
                      AI 会保留当前镜头的:景别、构图、视角、风格。只改你描述的部分(角色表情、道具、光照等)。
                    </p>
                    <textarea
                      value={shotModInput}
                      onChange={(e) => setShotModInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                          e.preventDefault()
                          void handleRegenShot()
                        }
                      }}
                      placeholder="例如:让角色表情更紧张 / 把背景换成雨天 / 加一束侧逆光…"
                      rows={4}
                      disabled={shotModBusy || !currentUrl}
                      className="w-full rounded-md bg-bg-elevated border border-border text-sm text-text-primary p-2 focus:border-accent focus:outline-none resize-none placeholder:text-text-muted disabled:opacity-50"
                    />
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] text-text-muted">⌘/Ctrl + Enter 发送</span>
                      <button
                        type="button"
                        onClick={() => void handleRegenShot()}
                        disabled={shotModBusy || !shotModInput.trim() || !currentUrl}
                        className="px-3 py-1.5 rounded-md bg-accent text-accent-foreground text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 inline-flex items-center gap-1.5"
                      >
                        {shotModBusy ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                        {shotModBusy ? '生成中…' : '发送修改'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
