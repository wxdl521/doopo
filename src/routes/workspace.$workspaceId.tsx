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
} from '../data/workspaceGenerators'
import { generateStageAi } from '../lib/aiGenerate.functions'
import { generateImage } from '../lib/openrouterImage.functions'
import { regenerateCharacterLook } from '../lib/characterRegen.functions'
import { getProject, saveWorkspaceData, loadWorkspaceData, type ProjectConfigRow } from '../lib/projects.functions'
import { streamSynopsis, streamEpisodeScenes, refineSynopsis, refineEpisodeScenes } from '../lib/scriptAgent.functions'
import type { ImportedScriptResult } from '../lib/parseImportedScript.functions'
import { resolveProjectStyle, resolveT2IModel, resolveI2IModel } from '../lib/visualStyles'
import { Maximize2, FileText, Camera, Clock, Users, X, Loader2, Sparkles, Send, CheckCircle2, Pencil, Check, Image as ImageIcon, LayoutGrid } from 'lucide-react'
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
        if (Array.isArray(wd.scenes) && wd.scenes.length) setData((d) => ({ ...d, scenes: wd.scenes as GenScene[] }))
        if (Array.isArray(wd.characters) && wd.characters.length) setData((d) => ({ ...d, characters: wd.characters as GenCharacter[] }))
        if (Array.isArray(wd.storyboard) && wd.storyboard.length) setData((d) => ({ ...d, storyboard: wd.storyboard as StoryboardPanel[] }))
        if (wd.timeline) setData((d) => ({ ...d, timeline: wd.timeline as WorkspaceData['timeline'] }))
        if (typeof wd.synopsisText === 'string' && wd.synopsisText) {
          setSynopsisText(wd.synopsisText)
          setSynopsisDraft(wd.synopsisText)
        }
        if (Array.isArray(wd.episodeTexts) && wd.episodeTexts.length) {
          setData((d) => ({ ...d, episodeTexts: wd.episodeTexts as WorkspaceData['episodeTexts'] }))
        }
        if (wd.charImages) setCharImages(wd.charImages as Record<string, string[]>)
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
        // 角色图片生成 prompt 结构(强化版)
        //   OVERVIEW(任务一句话,放最前,模型第一时间看到)
        //   5 条 CRITICAL RULES(强约束,每条都"如果违反=拒绝")
        //   VISUAL STYLE(用户选定的项目风格,显式标注 REQUIRED/MANDATORY)
        //   CHARACTER BRIEF(脸/身材/服装)
        //   FINAL CHECKLIST(交付前自检清单,把关键约束再重复一遍)
        // ====================================================================
        const prompt = [
          // —— 任务总览(让模型在第一秒就知道核心需求)——
          `[MISSION] Generate ONE character reference sheet image of "${cardTitle}" — a ${c.roleLabel}, age ${c.age}. ` +
          `This image is part of a multi-outfit character sheet, so it MUST be (a) rendered in the user's selected visual style "${styleSpec.label}", (b) full-body head-to-toe front view (no other angle), (c) on a 100% pure white #FFFFFF background, (d) expressionless neutral face, (e) with the EXACT same face as all other outfit variants of "${c.name}".`,

          // —— 5 条硬约束(每条都明确"违反=拒绝")——
          `[CRITICAL RULES — output is REJECTED if ANY of these is violated. Do not compromise.]`,

          `RULE 1 — FRONT VIEW (no exceptions): subject MUST be standing upright, facing the camera DEAD-ON. ` +
          `CAMERA POSITION: eye-level, dead horizontal, dead vertical to the character. ` +
          `FORBIDDEN ANGLES (any of these = rejected): 3/4 angle, side view, profile, back view, tilted head, looking up, looking down, top-down/bird's-eye, bottom-up/hero shot, pan left/pan right. ` +
          `Eyes must look directly into the camera lens, both eyes fully visible and open. ` +
          `Arms relaxed naturally at the sides, feet slightly apart.`,

          `RULE 2 — HEAD-TO-TOE FRAMING (no exceptions): the FULL BODY must be visible — from the top of the head to the soles of the feet, with a small margin of whitespace above the head and below the feet. ` +
          `FORBIDDEN CROPPING (any of these = rejected): cropping at the knees, cropping at the waist, cropping at the thighs, cropping at the chest, head cut off, feet cut off. ` +
          `The whole figure is in view, top to bottom.`,

          `RULE 3 — NEUTRAL FACIAL EXPRESSION (no exceptions): expressionless face, like a passport photo. ` +
          `FORBIDDEN EXPRESSIONS (any of these = rejected): smile, smirk, grin, frown, scowl, angry eyes, sad eyes, laughing, crying, pouting, raised eyebrow, looking sideways, eyes closed, eyes squinting, teeth showing. ` +
          `The character is standing still, not posing emotionally.`,

          `RULE 4 — PURE WHITE #FFFFFF BACKGROUND (no exceptions): the entire background outside the character's silhouette MUST be a single uniform #FFFFFF color (hex #FFFFFF, RGB 255,255,255). ` +
          `FORBIDDEN BACKGROUND ARTIFACTS (any of these = rejected): off-white, cream, ivory, beige, light grey, mid grey, dark grey, black, gradient, vignette, pattern, scenery, furniture, props, ground texture, horizon line, floor, wall, sky, shadow cast onto any surface, floor reflection, color cast. ` +
          `The background is FLAT WHITE, period. Nothing else.`,

          `RULE 5 — FACE LOCK ACROSS ALL OUTFIT VARIANTS (no exceptions): "${c.name}" has multiple outfit variants. The ONLY difference between "${c.name} · 默认" and "${c.name} · ${ls.label}" (and any other variant) MUST be the outfit. ` +
          `FORBIDDEN FACE CHANGES (any of these across variants = rejected): different face shape, different eye shape, different eye color, different nose, different mouth, different eyebrow shape, different skin tone, different hairstyle, different hair color, different hair length, different facial proportions, different age appearance. ` +
          `When the user places multiple variants side by side, the faces must be PIXEL-IDENTICAL except for clothing. Treat the face description below as the single source of truth for all variants.`,

          // —— 项目视觉风格(用户选定的,REQUIRED)——
          `[VISUAL STYLE — USER-SELECTED, REQUIRED, MANDATORY. Do not drift to any other style. The user explicitly picked this style for this project; outputting any other style = rejected.]`,
          `Style name: ${styleSpec.label}`,
          `Style (REQUIRED, MANDATORY — render the character in this exact style): ${styleSpec.positive}`,
          `AVOID (will conflict with the style above, do not produce any of these): ${styleSpec.negative}`,
          `If the requested style is "realistic", do NOT add anime/anime-cel elements. If the requested style is "anime-jp", do NOT make the image photorealistic. The art medium, line treatment, color palette, and lighting MUST match the selected style exactly.`,

          // —— 角色描述 ——
          `[CHARACTER BRIEF]`,
          `Name: ${c.name} (${c.roleLabel}, age ${c.age})`,
          `Variant label: ${ls.label}`,
          paletteLine,

          `=== FACE — copy this description into the image EXACTLY, do not alter, do not stylize beyond what the visual style requires ===`,
          ls.data.faceDescription,
          `=== END FACE — the text above is the ONLY face spec; ignore any other face hint ===`,

          `=== BODY — must remain IDENTICAL across all outfit variants of "${c.name}" ===`,
          ls.data.bodyDescription,
          `=== END BODY ===`,

          `=== OUTFIT FOR THIS VARIANT (${ls.label}) — this is the ONLY thing that may differ between variants ===`,
          ls.data.clothingDescription,
          `=== END OUTFIT ===`,

          // —— 交付前自检清单(再重复一次最关键的约束)——
          `[FINAL CHECKLIST — before submitting the image, verify ALL of the following are TRUE. If ANY is FALSE, the image is rejected and must be regenerated.]`,
          `[ ] Style matches "${styleSpec.label}" exactly`,
          `[ ] Front view, eye-level camera, no top-down, no bottom-up, no side view, no 3/4, no profile`,
          `[ ] Full body head-to-toe visible — no cropping at knees, waist, chest, head, or feet`,
          `[ ] Face is expressionless/neutral — no smile, no frown, no emotion, no eyes closed`,
          `[ ] Background is 100% pure white #FFFFFF — no off-white, no grey, no scenery, no floor, no shadow`,
          `[ ] Face matches the FACE description above EXACTLY (this is a multi-outfit sheet; face must be identical across all "${c.name}" variants)`,
          `[ ] No text, no watermark, no logos, no other people, no extra limbs, no deformed hands`,

          `Begin.`,
        ].filter(Boolean).join('\n\n')
        const res = await callImage({ data: { prompt, model: resolveT2IModel(project?.sceneModel), noFallback: true } })
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

  // Auto-generate real images for newly produced characters / storyboard panels.
  // 并行策略:不同角色 → Promise.all 并行;同一角色的多个 look → 内部串行
  // (在 processCharacter 里用 for 循环,保证脸锁定一致)。
  // 并发上限:同时最多 2 个角色在画。
  //   原因:完全无上限时,Qwen 会同时给 N 个 429,代码 fallback 到不同 model,
  //   产生风格/构图/背景不一致的图。2 个并发 + 429 重试同 model 是甜点:
  //   既比完全串行快一倍,又几乎不会撞 rate limit。
  const CHAR_GEN_MAX_PARALLEL = 2
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
    // 简单并发队列:同时最多 CHAR_GEN_MAX_PARALLEL 个角色在画
    let active = 0
    const queue = [...charactersToStart]
    const pump = () => {
      while (active < CHAR_GEN_MAX_PARALLEL && queue.length > 0) {
        const c = queue.shift()!
        active++
        setBusyChars((s) => new Set([...s, c.id]))
        void processCharacter(c).finally(() => {
          active--
          pump()
        })
      }
    }
    pump()
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
        timeline: data.timeline,
        synopsisText: synopsisText || synopsisDraft,
        episodeTexts: data.episodeTexts,
        charImages,
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
      <WorkspaceTopbar tab={tab} onTabChange={setTab} episodeCount={data.episodeTexts.length} selectedEpisodeIndex={selectedEpisodeIndex} onEpisodeIndexChange={setSelectedEpisodeIndex} onSaveAssets={handleSaveAssets} onSave={handleSaveWorkspace} saving={savingWorkspace} saved={savedWorkspace} completedStages={completedStages} />
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
            const hasChars = data.characters.length > 0
            const hasScenes = data.scenes.length > 0

            if (!hasChars && !hasScenes) {
              return (
                <div className="max-w-4xl mx-auto panel p-10 text-center">
                  <p className="text-text-muted text-sm">{t.ws_character_empty}</p>
                </div>
              )
            }

            const order: Record<GenCharacter['role'], number> = { lead: 0, supporting: 1, villain: 2 }
            const sorted = [...data.characters].sort((a, b) => order[a.role] - order[b.role])
            const SCENE_TIME_LABELS: Record<string, string> = { DAY: '日', NIGHT: '夜', DUSK: '黄昏', DAWN: '黎明' }

            return (
              <div className="-m-6 h-[calc(100vh-3rem)] flex flex-col">
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

                <div className="flex-1 overflow-y-auto min-h-0">
                  {charViewTab === 'scenes' ? (
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
                    <div className="px-6 py-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
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
                              className="group text-left rounded-xl border border-border bg-bg-elevated/40 hover:border-accent hover:bg-bg-elevated/70 hover:-translate-y-0.5 transition-all overflow-hidden flex flex-col focus:outline-none focus:ring-2 focus:ring-accent/40 cursor-pointer"
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

                              {/* Text area */}
                              <div className="p-2.5 space-y-1.5">
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
                                    注意 onClick 里 e.stopPropagation(),否则点按钮也会触发卡片整体的预览打开 */}
                                <div className="grid grid-cols-3 gap-1 pt-1" onClick={(e) => e.stopPropagation()}>
                                  <button
                                    type="button"
                                    title="基于此形象给出修改意见(右侧弹输入框)"
                                    disabled={!hasImg}
                                    onClick={() => openModPanel(c, card.lookId)}
                                    className="px-1.5 py-1 rounded border border-border bg-bg-surface text-text-secondary text-[10px] hover:border-accent hover:text-accent disabled:opacity-40 disabled:cursor-not-allowed transition inline-flex items-center justify-center gap-1"
                                  >
                                    <Pencil size={10} /> 修改
                                  </button>
                                  <button
                                    type="button"
                                    title="生成标准三视图(front / side / back)"
                                    disabled={!hasImg}
                                    onClick={() => void runPresetRegen(c, card.lookId, 'three-view')}
                                    className="px-1.5 py-1 rounded border border-border bg-bg-surface text-text-secondary text-[10px] hover:border-accent hover:text-accent disabled:opacity-40 disabled:cursor-not-allowed transition inline-flex items-center justify-center gap-1"
                                  >
                                    <LayoutGrid size={10} /> 三视图
                                  </button>
                                  <button
                                    type="button"
                                    title="生成多维资产图(多姿态/表情/场景)"
                                    disabled={!hasImg}
                                    onClick={() => void runPresetRegen(c, card.lookId, 'multi-asset')}
                                    className="px-1.5 py-1 rounded border border-border bg-bg-surface text-text-secondary text-[10px] hover:border-accent hover:text-accent disabled:opacity-40 disabled:cursor-not-allowed transition inline-flex items-center justify-center gap-1"
                                  >
                                    <Sparkles size={10} /> 多维资产
                                  </button>
                                </div>
                              </div>
                            </div>
                          )
                        })
                      })()}
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-full">
                      <p className="text-text-muted text-sm">暂无角色数据，请先提取角色和场景。</p>
                    </div>
                  )}
                </div>
              </div>
            )
          })()}
          {tab === 'storyboard' && (() => {
            if (data.storyboard.length === 0) {
              return (
                <div className="max-w-4xl mx-auto panel p-10 text-center">
                  <p className="text-text-muted text-sm">{t.ws_storyboard_empty}</p>
                </div>
              )
            }
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
                  {completedStages.has('storyboard') && <span className="inline-flex items-center gap-0.5 text-xs text-emerald-400"><CheckCircle2 size={12} /> 已完成</span>}
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
    </div>
  )
}
