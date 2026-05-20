import { useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  Loader2,
  Sparkles,
  ArrowRight,
  RefreshCw,
  Save,
  Check,
  Send,
  Bot,
  User as UserIcon,
  History,
  RotateCcw,
  Pencil,
  StopCircle,
} from 'lucide-react'
import { useLanguage } from '../../i18n/LanguageContext'
import {
  streamSynopsis,
  streamEpisodeScenes,
} from '../../lib/scriptAgent.functions'
import { findScript, upsertScriptAndCloud, type SavedScript } from '../../lib/scriptStorage'

// 5 步对话式剧本智能体
type Stage = 'setup' | 'synopsis' | 'episode' | 'episodes' | 'done'
const STAGES: Stage[] = ['setup', 'synopsis', 'episode', 'episodes', 'done']
const STAGE_LABELS: Record<Stage, string> = {
  setup: '① 灵感',
  synopsis: '② 故事梗概',
  episode: '③ 分镜脚本',
  episodes: '④ 多剧集',
  done: '⑤ 完成',
}

type Bubble = {
  id: string
  role: 'user' | 'agent' | 'system'
  text: string
  streaming?: boolean
  stage?: Stage
}

type Props = {
  types: { value: string; key: keyof ReturnType<typeof useLanguage>['t'] }[]
  genres: { value: string; key: keyof ReturnType<typeof useLanguage>['t'] }[]
  tones: { value: string; key: keyof ReturnType<typeof useLanguage>['t'] }[]
  models: { id: string; label: string }[]
  onSaved?: () => void
}

type StreamChunk =
  | { delta: string }
  | { done: true; text: string }
  | { error: string }

export default function ScriptComposer({ types, genres, tones, models, onSaved }: Props) {
  const { t, lang } = useLanguage()
  const navigate = useNavigate()
  const callSynopsis = useServerFn(streamSynopsis)
  const callEpisode = useServerFn(streamEpisodeScenes)

  const [stage, setStage] = useState<Stage>('setup')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 输入
  const [type, setType] = useState('Short')
  const [genre, setGenre] = useState('Drama')
  const [tone, setTone] = useState('Serious')
  const [model, setModel] = useState(models[0]?.id ?? '')
  const [theme, setTheme] = useState('')
  const [plot, setPlot] = useState('')
  const [expectedEpisodes, setExpectedEpisodes] = useState(100)
  const [sceneCount, setSceneCount] = useState(15)

  // 流式聚合结果
  const [synopsisText, setSynopsisText] = useState('')
  const [episodes, setEpisodes] = useState<EpisodeItem[]>([])
  // 下一集要生成的集号 / 分镜数
  const [nextEpIndex, setNextEpIndex] = useState(2)
  const [nextSceneCount, setNextSceneCount] = useState(15)
  // 自动连续生成至第 N 集
  const [targetEpisode, setTargetEpisode] = useState(10)
  const [autoRunning, setAutoRunning] = useState(false)
  const stopAutoRef = useRef(false)

  // 聊天气泡
  const [bubbles, setBubbles] = useState<Bubble[]>([
    {
      id: 'welcome',
      role: 'agent',
      text: '你好，我是剧本智能体 🎬\n先告诉我你的灵感：题材、主题、剧情概要，我会一步步陪你打磨成完整剧本。',
    },
  ])
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [bubbles])

  const pushBubble = (b: Omit<Bubble, 'id'>) => {
    const id = `b-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    setBubbles((prev) => [...prev, { ...b, id }])
    return id
  }

  // —— 逐字"打字机"渲染：把上游每次的大块 delta 拆成小片，平滑追加 ——
  const pendingRef = useRef<Map<string, { buf: string; done: boolean }>>(new Map())
  const flushTimerRef = useRef<number | null>(null)

  const ensureFlushTimer = () => {
    if (flushTimerRef.current != null) return
    flushTimerRef.current = window.setInterval(() => {
      const map = pendingRef.current
      if (map.size === 0) {
        if (flushTimerRef.current != null) window.clearInterval(flushTimerRef.current)
        flushTimerRef.current = null
        return
      }
      setBubbles((prev) =>
        prev.map((b) => {
          const slot = map.get(b.id)
          if (!slot) return b
          if (slot.buf.length === 0) {
            if (slot.done) {
              map.delete(b.id)
              return { ...b, streaming: false }
            }
            return b
          }
          // 缓冲越大流速越快，避免落后太多；同时保证最低一次 2 字
          const take = Math.min(slot.buf.length, Math.max(2, Math.ceil(slot.buf.length / 12)))
          const chunk = slot.buf.slice(0, take)
          slot.buf = slot.buf.slice(take)
          const next: Bubble = { ...b, text: b.text + chunk }
          if (slot.buf.length === 0 && slot.done) {
            map.delete(b.id)
            next.streaming = false
          }
          return next
        }),
      )
    }, 24) as unknown as number
  }

  useEffect(() => {
    return () => {
      if (flushTimerRef.current != null) {
        window.clearInterval(flushTimerRef.current)
        flushTimerRef.current = null
      }
    }
  }, [])

  const appendDelta = (id: string, delta: string) => {
    if (!delta) return
    const map = pendingRef.current
    const slot = map.get(id) ?? { buf: '', done: false }
    slot.buf += delta
    map.set(id, slot)
    ensureFlushTimer()
  }
  const finishBubble = (id: string) => {
    const map = pendingRef.current
    const slot = map.get(id)
    if (slot) {
      slot.done = true
      ensureFlushTimer()
    } else {
      setBubbles((prev) => prev.map((b) => (b.id === id ? { ...b, streaming: false } : b)))
    }
  }

  const errMsg = (e: string) => {
    if (e === 'rate_limit') return t.script_pipeline_rate_limit
    if (e === 'no_credits') return t.script_pipeline_no_credits
    return `${t.script_pipeline_failed}: ${e}`
  }

  // 通用：消费 async iterable 流（serverFn 直接返回的 AsyncIterable）
  async function consume(
    stream: AsyncIterable<StreamChunk>,
    bubbleId: string,
    onText: (text: string) => void,
  ): Promise<{ ok: boolean; text: string }> {
    let acc = ''
    try {
      for await (const chunk of stream) {
        if ('error' in chunk) {
          setError(errMsg(chunk.error))
          finishBubble(bubbleId)
          return { ok: false, text: acc }
        }
        if ('delta' in chunk) {
          acc += chunk.delta
          appendDelta(bubbleId, chunk.delta)
        } else if ('done' in chunk) {
          if (chunk.text && chunk.text.length > acc.length) {
            const tail = chunk.text.slice(acc.length)
            if (tail) appendDelta(bubbleId, tail)
            acc = chunk.text
          }
          onText(acc)
          finishBubble(bubbleId)
          return { ok: true, text: acc }
        }
      }
      // 流自然结束但未 yield done
      onText(acc)
      finishBubble(bubbleId)
      return { ok: true, text: acc }
    } catch (e) {
      setError(e instanceof Error ? e.message : '流读取失败')
      finishBubble(bubbleId)
      return { ok: false, text: acc }
    }
  }

  // ============ 阶段动作 ============

  const runSynopsis = async () => {
    if (!theme.trim() || !plot.trim()) return
    setError(null)
    setLoading(true)
    pushBubble({
      role: 'user',
      text: `🎯 灵感\n类型：${type} · 题材：${genre} · 风格：${tone}\n主题：${theme}\n剧情：${plot}\n预计集数：${expectedEpisodes}`,
    })
    const id = pushBubble({ role: 'agent', text: '', streaming: true, stage: 'synopsis' })
    const stream = (await callSynopsis({
      data: { lang, type, genre, tone, theme, plot, expectedEpisodes, model },
    })) as AsyncIterable<StreamChunk>
    const res = await consume(stream, id, setSynopsisText)
    setLoading(false)
    if (res.ok) setStage('synopsis')
  }

  const runEpisode = async () => {
    if (!synopsisText) return
    setError(null)
    setLoading(true)
    pushBubble({ role: 'user', text: `✅ 确认梗概，第 1 集分镜数：${sceneCount}` })
    const id = pushBubble({ role: 'agent', text: '', streaming: true, stage: 'episode' })
    const stream = (await callEpisode({
      data: { lang, epIndex: 1, sceneCount, synopsisText, model },
    })) as AsyncIterable<StreamChunk>
    const res = await consume(stream, id, (text) => {
      setEpisodes([{ epIndex: 1, text }])
    })
    setLoading(false)
    if (res.ok) {
      setStage('episodes')
      setNextEpIndex(2)
      setTargetEpisode((v) => Math.max(v, Math.min(expectedEpisodes, 10)))
    }
  }

  // 多剧集：生成指定集（可被自动连跑复用，使用入参避免闭包陈旧）
  async function generateEpisode(opts: {
    epIndex: number
    sceneCount: number
    prevText: string
    prevEpIndex: number | null
  }): Promise<{ ok: boolean; text: string }> {
    pushBubble({
      role: 'user',
      text: `▶︎ 生成第 ${opts.epIndex} 集（分镜数：${opts.sceneCount}）`,
    })
    const id = pushBubble({ role: 'agent', text: '', streaming: true, stage: 'episodes' })
    const contextSynopsis = opts.prevText
      ? `${synopsisText}\n\n【上一集（第 ${opts.prevEpIndex} 集）摘要参考】\n${opts.prevText.slice(-2000)}`
      : synopsisText
    const stream = (await callEpisode({
      data: {
        lang,
        epIndex: opts.epIndex,
        sceneCount: opts.sceneCount,
        synopsisText: contextSynopsis,
        model,
      },
    })) as AsyncIterable<StreamChunk>
    return consume(stream, id, (text) => {
      setEpisodes((prev) => {
        const others = prev.filter((e) => e.epIndex !== opts.epIndex)
        return [...others, { epIndex: opts.epIndex, text }].sort((a, b) => a.epIndex - b.epIndex)
      })
    })
  }

  const runNextEpisode = async () => {
    if (!synopsisText) return
    setError(null)
    setLoading(true)
    const last = episodes[episodes.length - 1]
    const res = await generateEpisode({
      epIndex: nextEpIndex,
      sceneCount: nextSceneCount,
      prevText: last?.text ?? '',
      prevEpIndex: last?.epIndex ?? null,
    })
    setLoading(false)
    if (res.ok) setNextEpIndex(nextEpIndex + 1)
  }

  // 自动连续生成：从当前 nextEpIndex 一路生成到 targetEpisode
  const runUntilTarget = async () => {
    if (!synopsisText) return
    const target = Math.max(nextEpIndex, Math.min(expectedEpisodes, targetEpisode))
    if (target < nextEpIndex) return
    setError(null)
    setAutoRunning(true)
    setLoading(true)
    stopAutoRef.current = false
    pushBubble({
      role: 'system',
      text: `🚀 开始自动连续生成第 ${nextEpIndex} ~ ${target} 集（共 ${target - nextEpIndex + 1} 集）`,
    })
    let cur = nextEpIndex
    let prevText = episodes[episodes.length - 1]?.text ?? ''
    let prevIdx: number | null = episodes[episodes.length - 1]?.epIndex ?? null
    let generatedEpisodes = [...episodes]
    try {
      while (cur <= target) {
        if (stopAutoRef.current) {
          pushBubble({ role: 'system', text: `⏸ 已停止，已完成至第 ${cur - 1} 集。` })
          break
        }
        const res = await generateEpisode({
          epIndex: cur,
          sceneCount: nextSceneCount,
          prevText,
          prevEpIndex: prevIdx,
        })
        if (!res.ok) {
          pushBubble({ role: 'system', text: `❌ 第 ${cur} 集生成失败，已中断自动连跑。` })
          break
        }
        generatedEpisodes = [
          ...generatedEpisodes.filter((e) => e.epIndex !== cur),
          { epIndex: cur, text: res.text },
        ].sort((a, b) => a.epIndex - b.epIndex)
        prevText = res.text
        prevIdx = cur
        setNextEpIndex(cur + 1)
        cur += 1
        if ((cur - 1) % 3 === 0) void persist(false, generatedEpisodes)
      }
      if (cur > target && !stopAutoRef.current) {
        pushBubble({ role: 'system', text: `🎉 已完成自动连续生成至第 ${target} 集。` })
        void persist(false, generatedEpisodes)
      }
    } finally {
      setAutoRunning(false)
      setLoading(false)
    }
  }

  const stopAuto = () => {
    stopAutoRef.current = true
  }

  // 中途保存 / 完成保存（可被多次调用，复用同一 id）
  const savedIdRef = useRef<string | null>(null)
  const persist = async (markDone: boolean, episodesSnapshot = episodes) => {
    const id = `scr-${Date.now()}`
    const finalId = savedIdRef.current ?? id
    savedIdRef.current = finalId
    const titleMatch = synopsisText.match(/《([^》]+)》/)
    const title = titleMatch?.[1] ?? theme ?? '未命名剧本'
    const existing = findScript(finalId)
    const item: SavedScript = {
      id: finalId,
      title,
      plot,
      type,
      genre,
      tone,
      model,
      synopsisText,
      episodesText: episodesSnapshot.length > 0 ? episodesSnapshot : undefined,
      expectedEpisodes,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    await upsertScriptAndCloud(item)
    onSaved?.()
    if (markDone) setStage('done')
    pushBubble({
      role: 'system',
      text: markDone
        ? `✅ 已完成并保存到剧本库：《${title}》（共 ${episodes.length} 集）`
        : `💾 已保存进度到剧本库：《${title}》（当前 ${episodes.length} 集）`,
    })
    return finalId
  }

  const reset = () => {
    setStage('setup')
    setSynopsisText('')
    setEpisodes([])
    setNextEpIndex(2)
    savedIdRef.current = null
    setBubbles([
      {
        id: 'welcome',
        role: 'agent',
        text: '新一轮创作开始 🎬\n请输入你的新灵感。',
      },
    ])
    setError(null)
  }

  // ============ 渲染 ============

  const stageIdx = STAGES.indexOf(stage)

  return (
    <div className="panel p-5 sm:p-6 space-y-4">
      {/* 头部 + 阶段指示 */}
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-semibold text-text-primary flex items-center gap-2">
          <Sparkles size={16} className="text-accent" />
          剧本智能体
        </h2>
        <span className="text-xs text-text-muted">对话式 5 步流程 · 流式输出</span>
        <div className="ml-auto flex flex-wrap items-center gap-1">
          {STAGES.map((s, i) => {
            const done = i < stageIdx
            const active = i === stageIdx
            return (
              <div key={s} className="flex items-center gap-1">
                <span
                  className={`px-2 py-0.5 rounded-full text-[11px] ${
                    active
                      ? 'bg-accent text-bg-base font-medium'
                      : done
                        ? 'bg-accent-dim text-accent'
                        : 'bg-bg-elevated text-text-muted'
                  }`}
                >
                  {done ? <Check size={10} className="inline -mt-0.5" /> : null} {STAGE_LABELS[s]}
                </span>
                {i < STAGES.length - 1 && (
                  <ArrowRight size={10} className="text-text-muted" />
                )}
              </div>
            )
          })}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 text-red-300 text-sm px-3 py-2">
          {error}
        </div>
      )}

      {/* 聊天区 */}
      <div
        ref={scrollRef}
        className="rounded-xl border border-border bg-bg-base/40 max-h-[560px] min-h-[280px] overflow-y-auto p-3 space-y-3"
      >
        {bubbles.map((b) => (
          <ChatBubble key={b.id} bubble={b} />
        ))}
        {loading && (
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <Loader2 size={12} className="animate-spin" />
            智能体思考中…
          </div>
        )}
      </div>

      {/* 阶段输入栏 */}
      {stage === 'setup' && (
        <SetupBar
          type={type}
          setType={setType}
          genre={genre}
          setGenre={setGenre}
          tone={tone}
          setTone={setTone}
          model={model}
          setModel={setModel}
          theme={theme}
          setTheme={setTheme}
          plot={plot}
          setPlot={setPlot}
          expectedEpisodes={expectedEpisodes}
          setExpectedEpisodes={setExpectedEpisodes}
          types={types}
          genres={genres}
          tones={tones}
          models={models}
          t={t}
          loading={loading}
          onSubmit={runSynopsis}
        />
      )}

      {stage === 'synopsis' && (
        <ActionBar>
          <label className="text-xs text-text-muted">第 1 集分镜数</label>
          <NumberField
            value={sceneCount}
            min={5}
            max={30}
            fallback={15}
            onCommit={setSceneCount}
            className="w-20 rounded-lg bg-bg-elevated border border-border text-sm text-text-primary px-2 py-1.5 focus:outline-none focus:border-accent/50"
          />
          <button
            onClick={runSynopsis}
            disabled={loading}
            className="btn-ghost text-xs disabled:opacity-40"
          >
            <RefreshCw size={12} /> 重新生成梗概
          </button>
          <button
            onClick={runEpisode}
            disabled={loading || !synopsisText}
            className="btn-primary text-xs ml-auto disabled:opacity-40"
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
            确认 · 生成第 1 集分镜
          </button>
        </ActionBar>
      )}

      {stage === 'episode' && (
        <ActionBar>
          <button
            onClick={runEpisode}
            disabled={loading}
            className="btn-ghost text-xs disabled:opacity-40"
          >
            <RefreshCw size={12} /> 重写本集分镜
          </button>
          <button
            onClick={() => {
              setStage('episodes')
              setNextEpIndex(2)
              pushBubble({
                role: 'system',
                text: '已进入"多剧集"阶段：可指定下一集分镜数并逐集生成，随时保存进度。',
              })
            }}
            disabled={loading || !synopsisText}
            className="btn-primary text-xs ml-auto disabled:opacity-40"
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
            进入多剧集阶段
          </button>
        </ActionBar>
      )}

      {stage === 'episodes' && (
        <ActionBar>
          <span className="text-xs text-text-muted">
            已生成 {episodes.length} 集 · 下一集：第 {nextEpIndex} 集
          </span>
          <label className="text-xs text-text-muted ml-2">分镜数</label>
          <NumberField
            value={nextSceneCount}
            min={5}
            max={30}
            fallback={15}
            onCommit={setNextSceneCount}
            className="w-16 rounded-lg bg-bg-elevated border border-border text-sm text-text-primary px-2 py-1.5 focus:outline-none focus:border-accent/50"
          />
          <button
            onClick={runNextEpisode}
            disabled={loading || autoRunning}
            className="btn-ghost text-xs disabled:opacity-40"
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
            生成第 {nextEpIndex} 集
          </button>
          <label className="text-xs text-text-muted ml-2">连跑至第</label>
          <NumberField
            value={targetEpisode}
            min={1}
            max={expectedEpisodes}
            fallback={nextEpIndex}
            onCommit={setTargetEpisode}
            className="w-16 rounded-lg bg-bg-elevated border border-border text-sm text-text-primary px-2 py-1.5 focus:outline-none focus:border-accent/50"
          />
          <span className="text-xs text-text-muted">集（共 {expectedEpisodes}）</span>
          {autoRunning ? (
            <button onClick={stopAuto} className="btn-ghost text-xs text-red-300">
              <StopCircle size={12} /> 停止
            </button>
          ) : (
            <button
              onClick={runUntilTarget}
              disabled={loading || targetEpisode < nextEpIndex}
              className="btn-ghost text-xs disabled:opacity-40"
            >
              <Sparkles size={12} /> 自动连续生成
            </button>
          )}
          <button
            onClick={() => void persist(false)}
            disabled={loading || autoRunning || episodes.length === 0}
            className="btn-ghost text-xs ml-auto disabled:opacity-40"
          >
            <Save size={12} /> 保存进度
          </button>
          <button
            onClick={async () => {
              const id = await persist(true)
              navigate({ to: '/scripts/$scriptId', params: { scriptId: id } })
            }}
            disabled={loading || autoRunning || episodes.length === 0}
            className="btn-primary text-xs disabled:opacity-40"
          >
            <Check size={13} /> 完成并查看
          </button>
        </ActionBar>
      )}

      {(stage === 'episodes' || stage === 'done') && episodes.length > 0 && (
        <EpisodeEditor
          episodes={episodes as EpisodeItem[]}
          setEpisodes={setEpisodes as React.Dispatch<React.SetStateAction<EpisodeItem[]>>}
          onSaveSnapshot={() => void persist(false)}
        />
      )}

      {stage === 'done' && (
        <div className="flex justify-center pt-2">
          <button onClick={reset} className="btn-ghost text-xs">
            <Sparkles size={12} /> 开始新的创作
          </button>
        </div>
      )}
    </div>
  )
}

// ============ 子组件 ============

function ChatBubble({ bubble }: { bubble: Bubble }) {
  const isUser = bubble.role === 'user'
  const isSystem = bubble.role === 'system'
  if (isSystem) {
    return (
      <div className="text-center text-xs text-text-muted py-1">{bubble.text}</div>
    )
  }
  const isAgent = bubble.role === 'agent'
  return (
    <div className={`flex gap-2 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div
        className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center ${
          isUser ? 'bg-accent/20 text-accent' : 'bg-bg-elevated text-text-muted'
        }`}
      >
        {isUser ? <UserIcon size={13} /> : <Bot size={13} />}
      </div>
      <div
        className={`max-w-[88%] rounded-xl px-3 py-2 text-sm leading-relaxed break-words ${
          isUser
            ? 'bg-accent text-bg-base'
            : 'bg-bg-elevated/60 text-text-primary border border-border/60 prose prose-invert prose-sm max-w-none prose-headings:mt-3 prose-headings:mb-2 prose-p:my-2 prose-li:my-0.5 prose-strong:text-accent'
        }`}
      >
        {isAgent ? (
          bubble.text ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{bubble.text}</ReactMarkdown>
          ) : bubble.streaming ? (
            '…'
          ) : null
        ) : (
          <span className="whitespace-pre-wrap">{bubble.text}</span>
        )}
        {bubble.streaming && <span className="inline-block w-1.5 h-3 ml-0.5 bg-accent animate-pulse align-middle" />}
      </div>
    </div>
  )
}

function ActionBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border pt-3">
      {children}
    </div>
  )
}

// ============ 分集编辑器 ============

type EpisodeVersion = { text: string; savedAt: string; label?: string }
type EpisodeItem = { epIndex: number; text: string; versions?: EpisodeVersion[] }

function EpisodeEditor({
  episodes,
  setEpisodes,
  onSaveSnapshot,
}: {
  episodes: EpisodeItem[]
  setEpisodes: React.Dispatch<React.SetStateAction<EpisodeItem[]>>
  onSaveSnapshot: () => void
}) {
  return (
    <div className="space-y-3 pt-3 border-t border-border">
      <div className="flex items-center gap-2">
        <Pencil size={14} className="text-accent" />
        <h3 className="font-semibold text-text-primary text-sm">分集编辑 · 直接修改台词与画面描述</h3>
        <span className="text-xs text-text-muted">共 {episodes.length} 集 · 每次保存生成一个版本</span>
      </div>
      <div className="space-y-3">
        {episodes.map((ep) => (
          <EpisodeCard
            key={ep.epIndex}
            ep={ep}
            onChange={(text) =>
              setEpisodes((prev) =>
                prev.map((e) => (e.epIndex === ep.epIndex ? { ...e, text } : e)),
              )
            }
            onSaveVersion={(label) => {
              setEpisodes((prev) =>
                prev.map((e) => {
                  if (e.epIndex !== ep.epIndex) return e
                  const versions = e.versions ? [...e.versions] : []
                  versions.unshift({
                    text: e.text,
                    savedAt: new Date().toISOString(),
                    label: label || `v${versions.length + 1}`,
                  })
                  return { ...e, versions }
                }),
              )
              // 立刻持久化到剧本库
              setTimeout(onSaveSnapshot, 0)
            }}
            onRevert={(versionIndex) => {
              setEpisodes((prev) =>
                prev.map((e) => {
                  if (e.epIndex !== ep.epIndex) return e
                  const v = e.versions?.[versionIndex]
                  if (!v) return e
                  return { ...e, text: v.text }
                }),
              )
            }}
          />
        ))}
      </div>
    </div>
  )
}

function EpisodeCard({
  ep,
  onChange,
  onSaveVersion,
  onRevert,
}: {
  ep: EpisodeItem
  onChange: (text: string) => void
  onSaveVersion: (label?: string) => void
  onRevert: (versionIndex: number) => void
}) {
  const [showHistory, setShowHistory] = useState(false)
  const [versionLabel, setVersionLabel] = useState('')
  return (
    <div className="rounded-xl border border-border bg-bg-base/40 p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-text-primary">第 {ep.epIndex} 集</span>
        <span className="text-[11px] text-text-muted">
          {ep.text.length} 字 · {ep.versions?.length ?? 0} 个历史版本
        </span>
        <div className="ml-auto flex items-center gap-1">
          <input
            value={versionLabel}
            onChange={(e) => setVersionLabel(e.target.value)}
            placeholder="版本备注（可选）"
            className="w-36 rounded-md bg-bg-elevated border border-border text-xs text-text-primary px-2 py-1 focus:outline-none focus:border-accent/50 placeholder:text-text-muted"
          />
          <button
            onClick={() => {
              onSaveVersion(versionLabel.trim() || undefined)
              setVersionLabel('')
            }}
            className="btn-primary text-xs"
          >
            <Save size={12} /> 保存版本
          </button>
          <button
            onClick={() => setShowHistory((v) => !v)}
            disabled={!ep.versions?.length}
            className="btn-ghost text-xs disabled:opacity-40"
          >
            <History size={12} /> 历史
          </button>
        </div>
      </div>
      <textarea
        value={ep.text}
        onChange={(e) => onChange(e.target.value)}
        rows={12}
        className="w-full rounded-lg bg-bg-elevated border border-border text-sm text-text-primary p-3 leading-7 font-mono focus:outline-none focus:border-accent/50 resize-y min-h-[200px]"
      />
      {showHistory && ep.versions && ep.versions.length > 0 && (
        <ul className="space-y-1 pt-1 border-t border-border">
          {ep.versions.map((v, i) => (
            <li
              key={i}
              className="flex items-center gap-2 text-xs text-text-muted rounded-md px-2 py-1 hover:bg-bg-elevated/60"
            >
              <span className="text-text-primary font-medium">{v.label ?? `v${ep.versions!.length - i}`}</span>
              <span>{new Date(v.savedAt).toLocaleString()}</span>
              <span className="text-text-muted/70">{v.text.length} 字</span>
              <button
                onClick={() => onRevert(i)}
                className="ml-auto inline-flex items-center gap-1 text-accent hover:underline"
              >
                <RotateCcw size={11} /> 回滚到此版本
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function SetupBar(props: {
  type: string
  setType: (v: string) => void
  genre: string
  setGenre: (v: string) => void
  tone: string
  setTone: (v: string) => void
  model: string
  setModel: (v: string) => void
  theme: string
  setTheme: (v: string) => void
  plot: string
  setPlot: (v: string) => void
  expectedEpisodes: number
  setExpectedEpisodes: (v: number) => void
  types: Props['types']
  genres: Props['genres']
  tones: Props['tones']
  models: Props['models']
  t: ReturnType<typeof useLanguage>['t']
  loading: boolean
  onSubmit: () => void
}) {
  const { t } = props
  return (
    <div className="space-y-3 pt-1">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <SelectField
          label={t.script_type}
          value={props.type}
          onChange={props.setType}
          options={props.types.map((x) => ({ value: x.value, label: t[x.key] as string }))}
        />
        <SelectField
          label={t.script_genre}
          value={props.genre}
          onChange={props.setGenre}
          options={props.genres.map((x) => ({ value: x.value, label: t[x.key] as string }))}
        />
        <SelectField
          label={t.script_tone}
          value={props.tone}
          onChange={props.setTone}
          options={props.tones.map((x) => ({ value: x.value, label: t[x.key] as string }))}
        />
        <div>
          <label className="text-xs text-text-muted mb-1 block">预计集数</label>
          <NumberField
            value={props.expectedEpisodes}
            min={1}
            max={200}
            fallback={100}
            onCommit={props.setExpectedEpisodes}
            className="w-full rounded-lg bg-bg-elevated border border-border text-sm text-text-primary px-2 py-2 focus:outline-none focus:border-accent/50"
          />
        </div>
      </div>
      <SelectField
        label={t.script_model}
        value={props.model}
        onChange={props.setModel}
        options={props.models.map((m) => ({ value: m.id, label: m.label }))}
      />
      <div>
        <label className="text-xs text-text-muted mb-1 block">{t.script_theme}</label>
        <input
          value={props.theme}
          onChange={(e) => props.setTheme(e.target.value)}
          placeholder="例如：天雷圣子 / 重生甜妻 / 都市最强医仙"
          className="w-full rounded-lg bg-bg-elevated border border-border text-sm text-text-primary px-3 py-2 focus:outline-none focus:border-accent/50 placeholder:text-text-muted"
        />
      </div>
      <div>
        <label className="text-xs text-text-muted mb-1 block">{t.script_plot}</label>
        <textarea
          value={props.plot}
          onChange={(e) => props.setPlot(e.target.value)}
          rows={3}
          placeholder="一句话或几句话说清主角处境、爽点钩子……"
          className="w-full rounded-lg bg-bg-elevated border border-border text-sm text-text-primary p-3 resize-none focus:outline-none focus:border-accent/50 placeholder:text-text-muted"
        />
      </div>
      <button
        onClick={props.onSubmit}
        disabled={props.loading || !props.theme.trim() || !props.plot.trim()}
        className="w-full btn-primary justify-center disabled:opacity-40"
      >
        {props.loading ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
        生成故事梗概（流式输出）
      </button>
    </div>
  )
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <div>
      <label className="text-xs text-text-muted mb-1 block">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg bg-bg-elevated border border-border text-sm text-text-primary px-2 py-2 focus:outline-none focus:border-accent/50"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}

// ============ 数字输入框（修复边输边 clamp / 清空跳默认值 bug）============
function NumberField({
  value,
  min,
  max,
  fallback,
  onCommit,
  className,
}: {
  value: number
  min: number
  max: number
  fallback?: number
  onCommit: (v: number) => void
  className?: string
}) {
  const [text, setText] = useState<string>(String(value))
  // 外部 value 变化时（如自动连跑推进 nextEpIndex）同步
  useEffect(() => {
    setText(String(value))
  }, [value])
  const commit = () => {
    if (text === '' || text === '-') {
      const v = fallback ?? value
      setText(String(v))
      if (v !== value) onCommit(v)
      return
    }
    const n = Number(text)
    if (!Number.isFinite(n)) {
      setText(String(value))
      return
    }
    const clamped = Math.max(min, Math.min(max, Math.floor(n)))
    setText(String(clamped))
    if (clamped !== value) onCommit(clamped)
  }
  return (
    <input
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      value={text}
      onChange={(e) => {
        const v = e.target.value
        // 允许空串与纯数字，编辑过程中不 clamp，避免无法输入 10/20 等
        if (v === '' || /^\d+$/.test(v)) setText(v)
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
      className={className}
    />
  )
}