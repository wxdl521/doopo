import { useEffect, useRef, useState } from 'react'
import { Plus, Send, ChevronDown, X, Check, PanelRightClose, PanelRightOpen, ChevronUp, Paperclip, FileIcon, FileText, Users, Grid3x3, Clock, Sparkles } from 'lucide-react'
import { useLanguage } from '../../i18n/LanguageContext'
import type { WorkspaceTab } from './WorkspaceTopbar'

type Attachment = { id: string; name: string; size: number; type: string; url?: string }

type CtaKey = 'extract' | 'design' | 'storyboard' | 'to_script' | 'to_character' | 'to_timeline' | 'refine' | 'preview' | 'save_assets' | 'generate_script' | 'script_continue' | 'script_episode' | 'script_next' | 'select_episodes' | 'episode_modify'

type Message =
  | { id: string; kind: 'user'; text: string; attachments?: Attachment[] }
  | { id: string; kind: 'workflow'; steps: string[]; doneCount: number; summary?: { title: string; detail: string; next: string }; ctas?: { key: CtaKey; label: string; target: WorkspaceTab }[] }

type WorkflowDef = {
  steps: string[]
  summary: { title: string; detail: string; next: string }
  ctas: { key: CtaKey; label: string; target: WorkspaceTab }[]
}

function buildWorkflow(stage: WorkspaceTab, t: any): WorkflowDef {
  switch (stage) {
    case 'canvas':
      return {
        steps: [t.zp_step_canvas_load, t.zp_step_canvas_expand, t.zp_step_canvas_outline, t.zp_step_canvas_chars],
        summary: { title: t.zp_summary_canvas_done, detail: t.zp_summary_canvas_detail, next: t.zp_summary_canvas_next },
        ctas: [
          { key: 'generate_script', label: t.zp_cta_generate_script, target: 'script' },
        ],
      }
    case 'character':
      return {
        steps: [t.zp_step_char_load, t.zp_step_char_parse, t.zp_step_char_extract, t.zp_step_char_persona, t.zp_step_char_render],
        summary: { title: t.zp_summary_char_done, detail: t.zp_summary_char_detail, next: t.zp_summary_char_next },
        ctas: [
          { key: 'save_assets', label: t.zp_cta_save_assets, target: 'character' },
          { key: 'design', label: t.zp_cta_design, target: 'character' },
          { key: 'storyboard', label: t.zp_cta_storyboard, target: 'storyboard' },
          { key: 'refine', label: t.zp_cta_refine, target: 'character' },
        ],
      }
    case 'storyboard':
      return {
        steps: [t.zp_step_sb_load, t.zp_step_sb_parse, t.zp_step_sb_plan, t.zp_step_sb_compose, t.zp_step_sb_render],
        summary: { title: t.zp_summary_sb_done, detail: t.zp_summary_sb_detail, next: t.zp_summary_sb_next },
        ctas: [
          { key: 'to_timeline', label: t.zp_cta_to_timeline, target: 'timeline' },
          { key: 'refine', label: t.zp_cta_refine, target: 'storyboard' },
        ],
      }
    case 'timeline':
      return {
        steps: [t.zp_step_tl_load, t.zp_step_tl_align, t.zp_step_tl_audio, t.zp_step_tl_transition, t.zp_step_tl_preview],
        summary: { title: t.zp_summary_tl_done, detail: t.zp_summary_tl_detail, next: t.zp_summary_tl_next },
        ctas: [
          { key: 'preview', label: t.zp_cta_preview, target: 'timeline' },
          { key: 'refine', label: t.zp_cta_refine, target: 'timeline' },
        ],
      }
    case 'script':
      return {
        steps: [t.zp_step_load_workflow, t.zp_step_load_spec, t.zp_step_query_tools, t.zp_step_check_prev, t.zp_step_write_script],
        summary: { title: t.zp_summary_done, detail: t.zp_summary_detail, next: t.zp_summary_next },
        ctas: [
          { key: 'script_next', label: t.zp_cta_script_next, target: 'script' },
          { key: 'script_continue', label: t.zp_cta_script_continue, target: 'script' },
          { key: 'script_episode', label: t.zp_cta_script_episode, target: 'script' },
          { key: 'select_episodes', label: t.zp_cta_select_episodes, target: 'episodes' },
        ],
      }
    case 'episodes':
      return {
        steps: [t.zp_step_episodes_load, t.zp_step_episodes_preview, t.zp_step_episodes_pacing, t.zp_step_episodes_extract, t.zp_step_episodes_next],
        summary: { title: t.zp_summary_episodes_done, detail: t.zp_summary_episodes_detail, next: t.zp_summary_episodes_next },
        ctas: [
          { key: 'episode_modify', label: t.zp_cta_episode_modify, target: 'episodes' },
          { key: 'extract', label: t.zp_cta_extract, target: 'character' },
        ],
      }
    default:
      return {
        steps: [t.zp_step_load_workflow, t.zp_step_load_spec, t.zp_step_query_tools, t.zp_step_check_prev, t.zp_step_write_script],
        summary: { title: t.zp_summary_done, detail: t.zp_summary_detail, next: t.zp_summary_next },
        ctas: [
          { key: 'script_next', label: t.zp_cta_script_next, target: 'script' },
          { key: 'script_continue', label: t.zp_cta_script_continue, target: 'script' },
          { key: 'script_episode', label: t.zp_cta_script_episode, target: 'script' },
          { key: 'select_episodes', label: t.zp_cta_select_episodes, target: 'episodes' },
        ],
      }
  }
}

export default function ZopiaChatPanel({
  stage, onJumpStage, onProduce, collapsed, onToggleCollapsed, initialInput, onSaveAssets, locked, selectedEpisodeIndex,
}: {
  stage: WorkspaceTab
  onJumpStage: (t: WorkspaceTab) => void
  onProduce?: (t: WorkspaceTab, userPrompt?: string) => void | Promise<void> | Promise<unknown>
  collapsed: boolean
  onToggleCollapsed: () => void
  initialInput?: string
  onSaveAssets?: () => void | Promise<void>
  locked?: boolean
  selectedEpisodeIndex?: number
}) {
  const { t } = useLanguage()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [showUpgrade, setShowUpgrade] = useState(true)
  const [ctasCollapsed, setCtasCollapsed] = useState(false)
  const [pendingCta, setPendingCta] = useState<null | {
    cta: { key: CtaKey; label: string; target: WorkspaceTab }
    spec: {
      baseText: string
      targetStage: WorkspaceTab
      jumpAfter: boolean
      fields: { key: string; label: string; default: string; options: { value: string; label: string }[] }[]
    }
    values: Record<string, string>
    previewing: boolean
  }>(null)
  const [episodeEditMode, setEpisodeEditMode] = useState<number | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [synopsisEditMode, setSynopsisEditMode] = useState(false)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 999999, behavior: 'smooth' })
  }, [messages])

  // 从首页带入的预填文本：仅在首次有值时填入输入框
  useEffect(() => {
    if (initialInput && initialInput.trim()) {
      setInput(initialInput)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialInput])

  const intro: Record<WorkspaceTab, string> = {
    canvas: t.zp_intro_canvas,
    script: t.zp_intro_script,
    episodes: t.zp_intro_episodes,
    character: t.zp_intro_character,
    storyboard: t.zp_intro_storyboard,
    timeline: t.zp_intro_timeline,
  }

  const presets: Record<WorkspaceTab, string[]> = {
    canvas: [t.zp_preset_idea, t.zp_preset_design],
    script: [t.zp_preset_suspense, t.zp_preset_campus, t.zp_preset_idea, t.zp_preset_design],
    episodes: [t.zp_preset_episodes_refine, t.zp_preset_episodes_extract],
    character: [t.zp_preset_lead, t.zp_preset_villain, t.zp_preset_supporting],
    storyboard: [t.zp_preset_board, t.zp_preset_expand],
    timeline: [t.zp_preset_arrange, t.zp_preset_transition],
  }

  function newChat() {
    setMessages([])
    setInput('')
    attachments.forEach((a) => a.url && URL.revokeObjectURL(a.url))
    setAttachments([])
  }

  function onFilesPicked(files: FileList | null) {
    if (!files || files.length === 0) return
    const next: Attachment[] = []
    Array.from(files).forEach((f) => {
      next.push({
        id: `${Date.now()}-${f.name}-${Math.random().toString(36).slice(2, 7)}`,
        name: f.name,
        size: f.size,
        type: f.type,
        url: f.type.startsWith('image/') ? URL.createObjectURL(f) : undefined,
      })
    })
    setAttachments((prev) => [...prev, ...next])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => {
      const target = prev.find((a) => a.id === id)
      if (target?.url) URL.revokeObjectURL(target.url)
      return prev.filter((a) => a.id !== id)
    })
  }

  function formatSize(bytes: number) {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }

  function send(text: string, opts?: { targetStage?: WorkspaceTab; jumpAfter?: boolean; simple?: boolean }) {
    let trimmed = text.trim()
    if (!trimmed && attachments.length === 0) return

    // If in synopsis edit mode, prepend the instruction prefix
    // and use simple mode (streaming shows in main area)
    let isSynopsisModify = false
    if (synopsisEditMode && trimmed) {
      trimmed = `修改剧本梗概\n${trimmed}`
      setSynopsisEditMode(false)
      isSynopsisModify = true
    }

    // If in episode edit mode, prepend "修改第 X 集剧本\n" prefix
    // and use simple mode (no workflow animation, streaming shows in main area)
    let isEpisodeModify = false
    if (episodeEditMode != null && trimmed) {
      trimmed = `修改第 ${episodeEditMode} 集剧本\n${trimmed}`
      setEpisodeEditMode(null)
      isEpisodeModify = true
    }

    const inferredJump = opts?.jumpAfter ?? false
    const targetStage = opts?.targetStage ?? stage
    const userMsg: Message = {
      id: `u-${Date.now()}`,
      kind: 'user',
      text: trimmed,
      attachments: attachments.length ? attachments : undefined,
    }

    // Simple mode: only add user message, no workflow animation or summary
    // Used for episode/synopsis modifications where streaming content appears in the main area
    if (opts?.simple || isEpisodeModify || isSynopsisModify) {
      // Show a "modifying" status message in chat
      const statusId = `s-${Date.now()}`
      const statusLabel = isEpisodeModify ? '正在修改剧本…' : '正在修改故事梗概…'
      setMessages((m) => [...m, userMsg, { id: statusId, kind: 'workflow', steps: [statusLabel], doneCount: 0 }])
      setInput('')
      setAttachments([])
      // Wait for produce to complete, then update status with CTAs
      const produceResult = onProduce?.(targetStage, trimmed)
      Promise.resolve(produceResult).then(() => {
        const ctas: { key: CtaKey; label: string; target: WorkspaceTab }[] = isEpisodeModify
          ? [
              { key: 'episode_modify', label: '修改本集剧本', target: 'episodes' },
              { key: 'extract', label: '提取本集角色和场景', target: 'character' },
            ]
          : []
        setMessages((prev) => prev.map((msg) =>
          msg.id === statusId && msg.kind === 'workflow'
            ? { ...msg, doneCount: 1, summary: { title: '修改完成', detail: isEpisodeModify ? '剧本已更新，可在上方查看修改后的内容。' : '故事梗概已更新。', next: isEpisodeModify ? '可以继续修改或提取角色和场景。' : '如需继续调整，请直接输入修改意见。' }, ctas }
            : msg,
        ))
      })
      return
    }

    const wfId = `w-${Date.now()}`
    const wf = buildWorkflow(targetStage, t)
    setMessages((m) => [...m, userMsg, { id: wfId, kind: 'workflow', steps: wf.steps, doneCount: 0 }])
    setInput('')
    setAttachments([])

    const stepDelay = 700
    const lastStepIndex = wf.steps.length - 1
    wf.steps.forEach((_, i) => {
      if (i === lastStepIndex) return
      setTimeout(() => {
        setMessages((prev) => prev.map((msg) => (msg.id === wfId && msg.kind === 'workflow' ? { ...msg, doneCount: i + 1 } : msg)))
      }, (i + 1) * stepDelay)
    })

    const minDuration = wf.steps.length * stepDelay
    const startedAt = Date.now()

    // Always wait for onProduce to finish before completing workflow
    const produceResult = onProduce?.(targetStage, trimmed)
    Promise.resolve(produceResult)
      .then(async () => {
        // If produce returned a promise (streaming script), wait for it
        if (produceResult) {
          await Promise.resolve(produceResult)
        }
        const elapsed = Date.now() - startedAt
        const wait = Math.max(0, minDuration - elapsed)
        setTimeout(() => {
          setMessages((prev) => prev.map((msg) =>
            msg.id === wfId && msg.kind === 'workflow'
              ? { ...msg, doneCount: wf.steps.length, summary: wf.summary, ctas: wf.ctas }
              : msg,
          ))
          if (inferredJump) onJumpStage(targetStage)
        }, wait)
      })
  }

  const quickActions: { key: string; icon: typeof FileText; target: WorkspaceTab; label: string; userText: string }[] = [
    { key: 'qs', icon: FileText, target: 'script', label: t.zp_quick_script, userText: t.zp_user_quick_script },
    { key: 'qc', icon: Users, target: 'character', label: t.zp_quick_character, userText: t.zp_user_quick_character },
    { key: 'qb', icon: Grid3x3, target: 'storyboard', label: t.zp_quick_storyboard, userText: t.zp_user_quick_storyboard },
    { key: 'qt', icon: Clock, target: 'timeline', label: t.zp_quick_timeline, userText: t.zp_user_quick_timeline },
  ]

  type ParamField = { key: string; label: string; options: { value: string; label: string }[]; default: string; multiSelect?: boolean }
  type ParamSpec = { baseText: string; targetStage: WorkspaceTab; jumpAfter: boolean; fields: ParamField[] }

  function getParamSpec(c: { key: CtaKey; target: WorkspaceTab }): ParamSpec | null {
    switch (c.key) {
      case 'extract':
        return {
          baseText: t.zp_user_cta_extract, targetStage: 'character', jumpAfter: true,
          fields: [
            { key: 'scope', label: t.zp_param_f_scope, default: 'supp', options: [
              { value: 'main', label: t.zp_opt_scope_main },
              { value: 'supp', label: t.zp_opt_scope_supp },
              { value: 'all', label: t.zp_opt_scope_all },
            ]},
            { key: 'scenes', label: t.zp_param_f_include_scenes, default: 'yes', options: [
              { value: 'yes', label: t.zp_opt_yes }, { value: 'no', label: t.zp_opt_no },
            ]},
          ],
        }
      case 'design':
      case 'to_character':
        return {
          baseText: c.key === 'design' ? t.zp_user_cta_design : t.zp_user_cta_to_character,
          targetStage: 'character', jumpAfter: true,
          fields: [
            { key: 'style', label: t.zp_param_f_style, default: 'real', options: [
              { value: 'real', label: t.zp_opt_style_real },
              { value: 'anime', label: t.zp_opt_style_anime },
              { value: 'illust', label: t.zp_opt_style_illust },
              { value: 'ink', label: t.zp_opt_style_ink },
            ]},
            { key: 'views', label: t.zp_param_f_views, default: '3', options: [
              { value: '3', label: t.zp_opt_views_3 },
              { value: '5', label: t.zp_opt_views_5 },
              { value: 'full', label: t.zp_opt_views_full },
            ]},
            { key: 'count', label: t.zp_param_f_count, default: '5', options: [
              { value: '3', label: t.zp_opt_count_3 },
              { value: '5', label: t.zp_opt_count_5 },
              { value: '8', label: t.zp_opt_count_8 },
            ]},
            { key: 'depth', label: t.zp_param_f_depth, default: 'basic', options: [
              { value: 'basic', label: t.zp_opt_depth_basic },
              { value: 'deep', label: t.zp_opt_depth_deep },
            ]},
          ],
        }
      case 'storyboard':
        return {
          baseText: t.zp_user_cta_storyboard, targetStage: 'storyboard', jumpAfter: true,
          fields: [
            { key: 'shots', label: t.zp_param_f_shots, default: '12', options: [
              { value: '8', label: t.zp_opt_shots_8 },
              { value: '12', label: t.zp_opt_shots_12 },
              { value: '24', label: t.zp_opt_shots_24 },
            ]},
            { key: 'aspect', label: t.zp_param_f_aspect, default: '9_16', options: [
              { value: '16_9', label: t.zp_opt_aspect_16_9 },
              { value: '9_16', label: t.zp_opt_aspect_9_16 },
              { value: '4_3', label: t.zp_opt_aspect_4_3 },
            ]},
            { key: 'lock', label: t.zp_param_f_lock, default: 'strict', options: [
              { value: 'strict', label: t.zp_opt_lock_strict },
              { value: 'loose', label: t.zp_opt_lock_loose },
            ]},
          ],
        }
      case 'to_script':
        return {
          baseText: t.zp_user_cta_to_script, targetStage: 'script', jumpAfter: true,
          fields: [
            { key: 'tone', label: t.zp_param_f_tone, default: 'suspense', options: [
              { value: 'suspense', label: t.zp_opt_tone_suspense },
              { value: 'heal', label: t.zp_opt_tone_heal },
              { value: 'comedy', label: t.zp_opt_tone_comedy },
              { value: 'campus', label: t.zp_opt_tone_campus },
            ]},
            { key: 'len', label: t.zp_param_f_length, default: 'm', options: [
              { value: 's', label: t.zp_opt_len_s },
              { value: 'm', label: t.zp_opt_len_m },
              { value: 'l', label: t.zp_opt_len_l },
            ]},
          ],
        }
      case 'generate_script':
        return {
          baseText: t.zp_user_cta_generate_script, targetStage: 'script', jumpAfter: false,
          fields: [
            { key: 'type', label: t.script_type, default: 'Short', options: [
              { value: 'Micro', label: t.script_type_micro },
              { value: 'Short', label: t.script_type_short },
              { value: 'Feature', label: t.script_type_feature },
              { value: 'Ad', label: t.script_type_ad },
            ]},
            { key: 'genre', label: t.script_genre, default: 'Drama', multiSelect: true, options: [
              { value: 'Sci-Fi', label: t.script_genre_scifi },
              { value: 'Romance', label: t.script_genre_romance },
              { value: 'Thriller', label: t.script_genre_thriller },
              { value: 'Comedy', label: t.script_genre_comedy },
              { value: 'Drama', label: t.script_genre_drama },
              { value: 'Horror', label: t.script_genre_horror },
              { value: 'Fantasy', label: t.script_genre_fantasy },
              { value: 'Historical', label: t.script_genre_historical },
            ]},
            { key: 'tone', label: t.script_tone, default: 'Serious', multiSelect: true, options: [
              { value: 'Serious', label: t.script_tone_serious },
              { value: 'Comedy', label: t.script_tone_comedy },
              { value: 'Suspense', label: t.script_tone_suspense },
              { value: 'Romance', label: t.script_tone_romance },
              { value: 'Horror', label: t.script_tone_horror },
            ]},
            { key: 'expectedEpisodes', label: '预计集数', default: '30', options: [
              { value: '30', label: '30 集' },
              { value: '60', label: '60 集' },
              { value: '100', label: '100 集' },
              { value: '150', label: '150 集' },
            ]},
            { key: 'totalMinutes', label: '总时长（分钟）', default: '90', options: [
              { value: '30', label: '30 分钟' },
              { value: '60', label: '60 分钟' },
              { value: '90', label: '90 分钟' },
              { value: '180', label: '180 分钟' },
            ]},
          ],
        }
      case 'script_continue':
        return {
          baseText: t.zp_user_cta_script_continue, targetStage: 'script', jumpAfter: false,
          fields: [
            { key: 'targetEp', label: '连跑至第', default: '10', options: [
              { value: '5', label: '第 5 集' },
              { value: '10', label: '第 10 集' },
              { value: '20', label: '第 20 集' },
              { value: '30', label: '第 30 集' },
            ]},
            { key: 'sceneCount', label: '每集分镜数', default: '5', options: [
              { value: '3', label: '3 个' },
              { value: '5', label: '5 个' },
              { value: '7', label: '7 个' },
              { value: '9', label: '9 个' },
            ]},
          ],
        }
      case 'script_next':
        return {
          baseText: t.zp_user_cta_script_next, targetStage: 'script', jumpAfter: false,
          fields: [
            { key: 'sceneCount', label: '每集分镜数', default: '5', options: [
              { value: '3', label: '3 个' },
              { value: '5', label: '5 个' },
              { value: '7', label: '7 个' },
              { value: '9', label: '9 个' },
            ]},
          ],
        }
      case 'script_episode':
        return {
          baseText: t.zp_user_cta_script_episode, targetStage: 'script', jumpAfter: false,
          fields: [],
        }
      case 'to_timeline':
        return {
          baseText: t.zp_user_cta_to_timeline, targetStage: 'timeline', jumpAfter: true,
          fields: [
            { key: 'density', label: t.zp_param_f_density, default: 'std', options: [
              { value: 'tight', label: t.zp_opt_density_tight },
              { value: 'std', label: t.zp_opt_density_std },
              { value: 'loose', label: t.zp_opt_density_loose },
            ]},
            { key: 'audio', label: t.zp_param_f_audio, default: 'full', options: [
              { value: 'full', label: t.zp_opt_audio_full },
              { value: 'mute', label: t.zp_opt_audio_mute },
            ]},
          ],
        }
      case 'refine':
        return {
          baseText: t.zp_user_cta_refine, targetStage: c.target, jumpAfter: false,
          fields: [
            { key: 'focus', label: t.zp_param_f_focus, default: 'visual', options: [
              { value: 'pace', label: t.zp_opt_focus_pace },
              { value: 'dialog', label: t.zp_opt_focus_dialog },
              { value: 'visual', label: t.zp_opt_focus_visual },
              { value: 'emotion', label: t.zp_opt_focus_emotion },
            ]},
            { key: 'strength', label: t.zp_param_f_strength, default: 'mid', options: [
              { value: 'light', label: t.zp_opt_strength_light },
              { value: 'mid', label: t.zp_opt_strength_mid },
              { value: 'strong', label: t.zp_opt_strength_strong },
            ]},
          ],
        }
      default:
        return null
    }
  }

  function handleCta(c: { key: CtaKey; label: string; target: WorkspaceTab }) {
    if (c.key === 'preview') { onJumpStage(c.target); return }
    if (c.key === 'save_assets') { onSaveAssets?.(); return }
    if (c.key === 'select_episodes') { send(t.zp_user_cta_select_episodes, { targetStage: 'episodes', jumpAfter: true }); return }
    if (c.key === 'script_episode') {
      setSynopsisEditMode(true)
      setInput('')
      setTimeout(() => textareaRef.current?.focus(), 50)
      setTimeout(() => scrollRef.current?.scrollTo({ top: 999999, behavior: 'smooth' }), 50)
      return
    }
    if (c.key === 'episode_modify') {
      const epIdx = selectedEpisodeIndex ?? 1
      setEpisodeEditMode(epIdx)
      setInput('')
      setTimeout(() => textareaRef.current?.focus(), 50)
      setTimeout(() => scrollRef.current?.scrollTo({ top: 999999, behavior: 'smooth' }), 50)
      return
    }
    // extract: from episodes tab → directly send (skip param panel), extract characters + scenes from current episode
    if (c.key === 'extract' && stage === 'episodes') {
      const epIdx = selectedEpisodeIndex ?? 1
      send(`从第 ${epIdx} 集提取角色和场景`, { targetStage: 'character', jumpAfter: true })
      return
    }
    const spec = getParamSpec(c)
    if (!spec) return
    const defaults: Record<string, string> = {}
    spec.fields.forEach((f) => { defaults[f.key] = f.default })
    setPendingCta({ cta: c, spec, values: defaults, previewing: false })
  }

  function stageTag(c: { key: CtaKey; target: WorkspaceTab }, targetStage: WorkspaceTab): string {
    if (c.key === 'refine') return t.zp_tag_refine
    const map: Record<WorkspaceTab, string> = {
      canvas: t.zp_tag_canvas,
      script: t.zp_tag_script,
      episodes: t.zp_tag_episodes,
      character: t.zp_tag_character,
      storyboard: t.zp_tag_storyboard,
      timeline: t.zp_tag_timeline,
    }
    return map[targetStage]
  }

  function buildPrompt(spec: ParamSpec, values: Record<string, string>, tag: string): string {
    // For streaming script CTAs, build the full prompt with all parameters inline
    if (spec.fields[0]?.key === 'type') {
      const lines = spec.fields.map((f) => {
        const v = values[f.key]
        let display: string
        if (f.multiSelect && Array.isArray(v)) {
          display = v.map((val) => f.options.find((o) => o.value === val)?.label ?? val).join('、')
        } else {
          display = f.options.find((o) => o.value === v)?.label ?? v ?? ''
        }
        return `- ${f.label}: ${display}`
      })
      return `【${tag}】${spec.baseText}\n${lines.join('\n')}`
    }
    // Order is fixed by spec.fields declaration order — canonical per stage.
    const lines = spec.fields.map((f) => {
      const opt = f.options.find((o) => o.value === values[f.key])
      return `- ${f.label}: ${opt?.label ?? values[f.key] ?? ''}`
    })
    return `【${tag}】${spec.baseText}\n${t.zp_prompt_params_header}\n${lines.join('\n')}`
  }

  function confirmPendingCta() {
    if (!pendingCta) return
    const { spec, values, cta } = pendingCta
    const tag = stageTag(cta, spec.targetStage)

    // For generate_script, use send() workflow to show loading animation, jump after completion
    if (cta.key === 'generate_script') {
      setPendingCta(null)
      const text = buildPrompt(spec, values, tag)
      send(text, { targetStage: 'script', jumpAfter: true })
      return
    }

    // For script_next (generate one episode), send with scene count
    if (cta.key === 'script_next') {
      setPendingCta(null)
      const sceneCount = values.sceneCount ?? '5'
      const text = `生成本集分镜\n分镜数：${sceneCount}`
      send(text, { targetStage: 'script', jumpAfter: false })
      return
    }

    // For script_continue (auto-run episodes), send with target and scene count
    if (cta.key === 'script_continue') {
      setPendingCta(null)
      const targetEp = values.targetEp ?? '10'
      const sceneCount = values.sceneCount ?? '5'
      const text = `自动连跑多集\n连跑至第 ${targetEp} 集\n分镜数：${sceneCount}`
      send(text, { targetStage: 'script', jumpAfter: false })
      return
    }

    const text = buildPrompt(spec, values, tag)
    setPendingCta(null)
    send(text, { targetStage: spec.targetStage, jumpAfter: spec.jumpAfter })
  }


  if (collapsed) {
    return (
      <div className="w-12 border-l border-border bg-bg-surface flex flex-col items-center py-3 shrink-0">
        <button onClick={onToggleCollapsed} className="p-2 rounded-md hover:bg-bg-elevated text-text-muted" title={t.zp_expand}>
          <PanelRightOpen size={18} />
        </button>
      </div>
    )
  }

  const hasMessages = messages.length > 0

  return (
    <aside className="w-[384px] border-l border-border bg-bg-surface flex flex-col shrink-0 min-h-0">
      {/* Header */}
      <div className="h-12 border-b border-border flex items-center px-3 gap-2 shrink-0">
        <button onClick={onToggleCollapsed} className="p-1 rounded-md hover:bg-bg-elevated text-text-muted" title={t.zp_collapse}>
          <PanelRightClose size={16} />
        </button>
        <div className="flex-1 px-2 py-1 rounded-md bg-bg-elevated border border-border text-xs inline-flex items-center justify-between">
          <span>{t.zp_chat_dropdown}</span>
          <ChevronDown size={12} />
        </div>
        <button onClick={newChat} className="px-2 py-1 rounded-md bg-bg-elevated border border-border text-xs inline-flex items-center gap-1 hover:border-accent">
          <Plus size={12} /> {t.zp_new_chat}
        </button>
      </div>

      {/* Body */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4 min-h-0">
        {!hasMessages ? (
          <div className="space-y-3">
            <p className="text-text-secondary leading-relaxed">{intro[stage]}</p>
            {stage === 'script' && <p className="text-text-secondary text-sm">{t.zp_intro_script_hint}</p>}
            <ul className="text-text-secondary text-sm list-disc list-inside space-y-1">
              {presets[stage].map((p) => (
                <li key={p}>"{p}"</li>
              ))}
            </ul>
            <h3 className="font-display text-2xl font-bold text-text-primary mt-6">{t.zp_today_help}</h3>
            <div className="space-y-2 pt-2">
              {presets[stage].map((p, i) => (
                <button key={p} onClick={() => send(p)}
                  className={`w-full text-left px-4 py-3 rounded-lg border text-sm transition ${
                    i === 0
                      ? 'bg-accent-dim/40 border-accent text-text-primary hover:bg-accent-dim/60'
                      : 'bg-bg-elevated border-border hover:border-accent'
                  }`}>
                  {p}
                </button>
              ))}
            </div>

            <div className="pt-4">
              <div className="text-xs text-text-muted inline-flex items-center gap-1 mb-2">
                <Sparkles size={12} className="text-accent" /> {t.zp_quick_title}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {quickActions.map((q) => {
                  const Icon = q.icon
                  return (
                    <button
                      key={q.key}
                      onClick={() => send(q.userText, { targetStage: q.target, jumpAfter: true })}
                      className="px-3 py-2.5 rounded-lg border border-border bg-bg-elevated hover:border-accent hover:bg-accent-dim/20 text-xs text-left inline-flex items-center gap-2 transition"
                    >
                      <Icon size={14} className="text-accent shrink-0" />
                      <span className="truncate">{q.label}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            <p className="text-xs text-text-muted pt-3">{t.zp_unsatisfied}</p>
          </div>
        ) : (
          messages.map((m) => {
            if (m.kind === 'user') {
              return (
                <div key={m.id} className="flex justify-end">
                  <div className="max-w-[85%] space-y-2">
                    {m.attachments && m.attachments.length > 0 && (
                      <div className="flex flex-wrap gap-2 justify-end">
                        {m.attachments.map((a) => (
                          <div key={a.id} className="rounded-lg overflow-hidden border border-border bg-bg-elevated text-xs flex items-center gap-2 max-w-[180px]">
                            {a.url ? (
                              <img src={a.url} alt={a.name} className="w-12 h-12 object-cover" />
                            ) : (
                              <div className="w-10 h-10 flex items-center justify-center text-text-muted shrink-0"><FileIcon size={16} /></div>
                            )}
                            <div className="pr-2 py-1 min-w-0">
                              <div className="truncate">{a.name}</div>
                              <div className="text-text-muted">{formatSize(a.size)}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {m.text && <div className="px-3 py-2 rounded-2xl bg-bg-elevated text-sm whitespace-pre-wrap break-words">{m.text}</div>}
                  </div>
                </div>
              )
            }
            return (
              <div key={m.id} className="space-y-2">
                {m.steps.map((s, i) => {
                  const done = i < m.doneCount
                  const active = i === m.doneCount && !m.summary
                  return (
                    <div key={i} className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm ${done ? 'border-border bg-bg-elevated/60' : 'border-border bg-bg-elevated/30'}`}>
                      <span className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${done ? 'bg-emerald-500/20 text-emerald-400' : 'bg-bg-surface text-text-muted'}`}>
                        {done ? <Check size={12} /> : active ? <span className="w-2 h-2 rounded-full bg-accent animate-pulse" /> : null}
                      </span>
                      <span className={done ? 'text-text-primary' : 'text-text-muted'}>{s}</span>
                    </div>
                  )
                })}
                {m.summary && (
                  <div className="space-y-2 pt-1">
                    <p className="text-sm text-text-primary">{m.summary.title}</p>
                    <p className="text-sm text-text-secondary leading-relaxed">{m.summary.detail}</p>
                    <p className="text-sm text-text-secondary leading-relaxed">{m.summary.next}</p>
                  </div>
                )}
                {m.ctas && (
                  <div className="space-y-2 pt-2 relative">
                    {m.ctas.slice(0, ctasCollapsed ? 1 : undefined).map((c, idx) => (
                      <button key={c.key}
                        onClick={() => handleCta(c)}
                        className={`w-full px-4 py-3 rounded-lg border text-sm font-semibold transition ${
                          idx === 0 ? 'bg-accent-dim/40 border-accent text-text-primary hover:bg-accent-dim/60' : 'bg-bg-elevated border-border hover:border-accent'
                        }`}>
                        {c.label}
                      </button>
                    ))}
                    <button onClick={() => setCtasCollapsed((v) => !v)} className="absolute right-1 -top-1 w-6 h-6 rounded-full bg-bg-elevated border border-border flex items-center justify-center text-text-muted hover:text-accent">
                      {ctasCollapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
                    </button>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* CTA parameter sheet */}
      {pendingCta && (
        pendingCta.previewing ? (
          <div className="mx-3 mb-2 rounded-xl border border-accent/50 bg-bg-elevated p-3 shrink-0 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-sm font-semibold text-text-primary inline-flex items-center gap-1">
                  <Sparkles size={12} className="text-accent" /> {t.zp_preview_title}
                </div>
                <p className="text-xs text-text-muted mt-0.5">{t.zp_preview_desc}</p>
              </div>
              <button onClick={() => setPendingCta(null)} className="text-text-muted hover:text-text-primary -mt-1" title={t.zp_param_cancel}>
                <X size={14} />
              </button>
            </div>
            <pre className="max-h-[260px] overflow-y-auto whitespace-pre-wrap break-words text-xs text-text-secondary bg-bg-surface border border-border rounded-md p-2 font-mono leading-relaxed">
              {buildPrompt(pendingCta.spec, pendingCta.values, stageTag(pendingCta.cta, pendingCta.spec.targetStage))}
            </pre>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button onClick={() => setPendingCta((p) => p ? { ...p, previewing: false } : p)} className="px-3 py-1.5 rounded-md border border-border text-xs text-text-secondary hover:border-accent">
                {t.zp_preview_back}
              </button>
              <button onClick={confirmPendingCta} className="px-3 py-1.5 rounded-md bg-accent text-accent-foreground text-xs font-semibold hover:opacity-90">
                {t.zp_preview_send}
              </button>
            </div>
          </div>
        ) : (
        <div className="mx-3 mb-2 rounded-xl border border-accent/50 bg-bg-elevated p-3 shrink-0 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-sm font-semibold text-text-primary inline-flex items-center gap-1">
                <Sparkles size={12} className="text-accent" /> {t.zp_param_title}
              </div>
              <p className="text-xs text-text-muted mt-0.5">{t.zp_param_desc}</p>
            </div>
            <button onClick={() => setPendingCta(null)} className="text-text-muted hover:text-text-primary -mt-1" title={t.zp_param_cancel}>
              <X size={14} />
            </button>
          </div>
          <div className="space-y-2.5 max-h-[280px] overflow-y-auto pr-1">
            {pendingCta.spec.fields.map((f) => (
              <div key={f.key} className="space-y-1">
                <div className="text-xs text-text-secondary">{f.label}</div>
                <div className="flex flex-wrap gap-1.5">
                  {f.options.map((o) => {
                    const val = pendingCta.values[f.key]
                    const isMulti = f.multiSelect
                    const active = isMulti
                      ? Array.isArray(val) && val.includes(o.value)
                      : val === o.value
                    return (
                      <button
                        key={o.value}
                        onClick={() => setPendingCta((p) => p ? {
                          ...p,
                          values: {
                            ...p.values,
                            [f.key]: isMulti
                              ? Array.isArray(val)
                                ? val.includes(o.value)
                                  ? val.filter((v: string) => v !== o.value)
                                  : [...val, o.value]
                                : [o.value]
                              : o.value
                          }
                        } : p)}
                        className={`px-2.5 py-1 rounded-full border text-xs transition ${
                          active ? 'bg-accent-dim/60 border-accent text-text-primary' : 'bg-bg-surface border-border text-text-secondary hover:border-accent'
                        }`}
                      >
                        {o.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-end gap-2 pt-1">
            <button onClick={() => setPendingCta(null)} className="px-3 py-1.5 rounded-md border border-border text-xs text-text-secondary hover:border-accent">
              {t.zp_param_cancel}
            </button>
            <button onClick={() => setPendingCta((p) => p ? { ...p, previewing: true } : p)} className="px-3 py-1.5 rounded-md bg-accent text-accent-foreground text-xs font-semibold hover:opacity-90">
              {t.zp_param_preview}
            </button>
          </div>
        </div>
        )
      )}

      {/* Upgrade hint */}
      {showUpgrade && (
        <div className="mx-3 mb-2 px-3 py-2 rounded-lg bg-accent-dim/40 border border-accent/40 text-xs flex items-center justify-between shrink-0">
          <span className="text-text-primary">✦ {t.zp_upgrade_hint}</span>
          <button onClick={() => setShowUpgrade(false)} className="text-text-muted hover:text-text-primary"><X size={12} /></button>
        </div>
      )}

      {/* Input */}
      <div className="p-3 border-t border-border shrink-0">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => onFilesPicked(e.target.files)}
        />
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {attachments.map((a) => (
              <div key={a.id} className="group relative rounded-md border border-border bg-bg-elevated pl-2 pr-7 py-1 text-xs flex items-center gap-2 max-w-[180px]">
                {a.url ? (
                  <img src={a.url} alt={a.name} className="w-6 h-6 object-cover rounded" />
                ) : (
                  <FileIcon size={12} className="text-text-muted shrink-0" />
                )}
                <span className="truncate">{a.name}</span>
                <button
                  type="button"
                  onClick={() => removeAttachment(a.id)}
                  className="absolute right-1 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-bg-surface border border-border flex items-center justify-center text-text-muted hover:text-text-primary"
                  title={t.zp_remove_attachment}
                >
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        )}
        {(synopsisEditMode || episodeEditMode != null) && (
          <div className="mb-2 flex items-center justify-between px-3 py-2 rounded-lg bg-accent-dim/40 border border-accent/50 text-xs">
            <span className="text-accent inline-flex items-center gap-1">
              <Sparkles size={12} />
              {synopsisEditMode
                ? '正在修改故事梗概 — 输入修改意见后回车发送'
                : `正在修改第 ${episodeEditMode} 集剧本 — 输入修改意见后回车发送`}
            </span>
            <button
              onClick={() => { setSynopsisEditMode(false); setEpisodeEditMode(null) }}
              className="text-text-muted hover:text-text-primary"
            >
              <X size={12} />
            </button>
          </div>
        )}
        <div className={`rounded-xl border bg-bg-elevated focus-within:border-accent ${(synopsisEditMode || episodeEditMode != null) ? 'border-accent/60' : 'border-border'}`}>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send(input)
              }
              if (e.key === 'Escape') {
                if (synopsisEditMode) setSynopsisEditMode(false)
                if (episodeEditMode != null) setEpisodeEditMode(null)
              }
            }}
            rows={2}
            placeholder={
              locked
                ? t.zp_input_placeholder_locked
                : synopsisEditMode
                  ? '输入修改意见，例如：把女主角改成更强势的性格，增加悬疑元素…'
                  : episodeEditMode != null
                    ? `输入对第 ${episodeEditMode} 集的修改意见，例如：加强结尾悬念，让对白更紧凑…`
                    : t.zp_input_placeholder
            }
            disabled={locked}
            className={`w-full bg-transparent px-3 py-2 text-sm resize-none focus:outline-none placeholder:text-text-muted disabled:text-text-muted ${(synopsisEditMode || episodeEditMode != null) ? 'placeholder:text-accent/60' : ''}`}
          />
          <div className="flex items-center justify-between px-2 pb-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-8 h-8 rounded-md bg-bg-surface border border-border flex items-center justify-center text-text-muted hover:text-accent"
              title={t.zp_attach}
            >
              <Paperclip size={14} />
            </button>
            <button
              onClick={() => send(input)}
              disabled={(!input.trim() && attachments.length === 0) || locked}
              className="w-9 h-9 rounded-full bg-accent text-accent-foreground flex items-center justify-center disabled:opacity-40 hover:opacity-90"
              title={t.zp_send}
            >
              <Send size={14} />
            </button>
          </div>
        </div>
      </div>
    </aside>
  )
}
