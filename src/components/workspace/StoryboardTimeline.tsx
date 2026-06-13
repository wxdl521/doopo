import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Play, Pause, RotateCcw, Clock, Film, Loader2, AlertCircle, GripVertical, CloudCheck, CloudOff,
} from 'lucide-react'
import type { StoryboardGroup } from '../../data/workspaceGenerators'

/**
 * 检测 URL 是否已入库到用户自己的 Supabase Storage(workspace-media bucket)。
 * 已入库 = 永久有效,不会 24h 过期。
 * 跟 workspaceMedia.functions.ts 的 isAlreadyPersisted 同语义,客户端用于徽章展示。
 */
function isPersistedUrl(url: string | undefined | null): boolean {
  if (!url) return false
  try {
    const u = new URL(url)
    const path = u.pathname || ''
    return path.includes('/storage/v1/object/public/workspace-media/')
        || path.includes('/object/public/workspace-media/')
  } catch {
    return false
  }
}

/**
 * 2026/06:Storyboard → Timeline 拼接播放视图。
 *
 *  - 多个分镜组生成的视频按"clipOrder"顺序拼接播放,每个 clip 默认 10s。
 *  - 顶部主视频播放器,只渲染当前 active clip 的 <video>(其他隐藏 mount,
 *    切换 src 时不重建 DOM,降低闪烁)。
 *  - 底部按帧时间轴:横向 clip 缩略图条 + 可拖拽竖线 playhead。
 *  - 支持两种拖拽(都用 Pointer Events,零依赖):
 *      1) 拖 playhead → 跳转播放进度
 *      2) 拖 clip  → 重新排序(松手时落点 < 中心 > 判定目标 index)
 *
 *  不做的事:不做转场、裁切、调时长、关键帧 —— 仅"类似剪辑的播放+拖拽"预览体验。
 */

export type GroupVideoMap = Record<string, { url: string; status: 'running' | 'succeeded' | 'failed' }>

type Props = {
  groups: StoryboardGroup[]
  groupVideos: GroupVideoMap
  /** 用户可调整的播放顺序(groupId 数组)。父组件管理以便持久化/重置。 */
  clipOrder: string[]
  onClipReorder: (nextOrder: string[]) => void
  /** 默认每个 clip 长度(秒)。当前分镜视频固定 10s。 */
  clipDurationSec?: number
  /** i18n 文案 */
  i18n: {
    title: string
    hint: string
    play: string
    pause: string
    resetOrder: string
    noVideo: string
    generating: string
    failed: string
    empty: string
    reorderChanged: string
  }
}

const DEFAULT_CLIP_DUR = 10

export default function StoryboardTimeline({
  groups,
  groupVideos,
  clipOrder,
  onClipReorder,
  clipDurationSec = DEFAULT_CLIP_DUR,
  i18n,
}: Props) {
  // ----- 派生数据 -----
  // 按 clipOrder 排列的 clip,包含 group + video 元数据
  type Clip = {
    groupId: string
    group: StoryboardGroup
    video: GroupVideoMap[string] | undefined
    /** 当前 clip 是否已生成可播放视频(用做 active candidate) */
    playable: boolean
    /** 缩略图:优先用第一张分镜图,没有就用 storyboard 图 */
    thumb: string | undefined
    /** 是否已入库到用户自己的 Supabase Storage(永久有效) */
    persisted: boolean
  }
  const clips: Clip[] = useMemo(() => {
    return clipOrder
      .map((id) => groups.find((g) => g.id === id))
      .filter((g): g is StoryboardGroup => !!g)
      .map((g) => {
        const v = groupVideos[g.id]
        const firstShotImg = g.shots.find((s) => s.imageUrl)?.imageUrl
        const thumb = firstShotImg
        return {
          groupId: g.id,
          group: g,
          video: v,
          playable: !!v && v.status === 'succeeded',
          thumb,
          persisted: isPersistedUrl(v?.url),
        }
      })
  }, [clipOrder, groups, groupVideos])

  const playableClips = useMemo(() => clips.filter((c) => c.playable), [clips])
  const totalSec = clips.length * clipDurationSec
  const playableTotalSec = playableClips.length * clipDurationSec

  // ----- 播放状态 -----
  const [activeClipIndex, setActiveClipIndex] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentSec, setCurrentSec] = useState(0)
  const [userReordered, setUserReordered] = useState(false)

  // ----- Refs -----
  const trackRef = useRef<HTMLDivElement | null>(null)
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({})
  /** playhead 拖拽快照 */
  const playheadDrag = useRef<{ startX: number; startSec: number } | null>(null)
  /** clip 拖拽快照 */
  const clipDrag = useRef<{
    clipId: string
    fromIndex: number
    pointerId: number
  } | null>(null)
  /** clip 拖拽时的目标 index(用于视觉预览),null 表示尚未移出原始槽 */
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const [draggingClipId, setDraggingClipId] = useState<string | null>(null)

  // active 视频 id
  const activeClip = playableClips[activeClipIndex] ?? null

  // ----- 自动播放头同步(active video 推进时,把 currentSec 同步过来) -----
  useEffect(() => {
    if (!activeClip) return
    const v = videoRefs.current[activeClip.groupId]
    if (!v) return
    if (isPlaying) {
      // 切到新的 clip 时,把 currentSec 对齐到该 clip 的"绝对起始"
      const offset = playableClips.findIndex((c) => c.groupId === activeClip.groupId) * clipDurationSec
      v.currentTime = Math.max(0, currentSec - offset)
      void v.play().catch(() => {/* 用户没交互时 autoplay 可能被拒,忽略 */})
    } else {
      v.pause()
    }
  // 仅在 activeClip / isPlaying 切换时同步,避免每帧重跑
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeClip?.groupId, isPlaying])

  // ----- 推进播放(currentSec + activeClipIndex 联动) -----
  useEffect(() => {
    if (!isPlaying) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      setCurrentSec((cur) => {
        const next = cur + dt
        if (next >= totalSec) {
          // 全部播完 → 停在末尾并暂停
          setIsPlaying(false)
          return totalSec
        }
        return next
      })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [isPlaying, totalSec])

  // currentSec → activeClipIndex 联动(自动切到下一个)
  useEffect(() => {
    if (playableClips.length === 0) return
    const idx = Math.min(
      playableClips.length - 1,
      Math.floor(currentSec / clipDurationSec),
    )
    if (idx !== activeClipIndex) setActiveClipIndex(idx)
  }, [currentSec, playableClips, clipDurationSec, activeClipIndex])

  // ----- seek -----
  const seekTo = useCallback((sec: number) => {
    const clamped = Math.max(0, Math.min(totalSec, sec))
    setCurrentSec(clamped)
    if (playableClips.length === 0) return
    const nextIdx = Math.min(
      playableClips.length - 1,
      Math.floor(clamped / clipDurationSec),
    )
    setActiveClipIndex(nextIdx)
    const nextClip = playableClips[nextIdx]
    const nextVid = nextClip ? videoRefs.current[nextClip.groupId] : null
    if (nextVid) {
      const offset = nextIdx * clipDurationSec
      nextVid.currentTime = Math.max(0, clamped - offset)
    }
  }, [totalSec, playableClips, clipDurationSec])

  // ----- 切到 tab / 重置时,自动对齐到 0 -----
  useEffect(() => {
    setCurrentSec(0)
    setActiveClipIndex(0)
    setIsPlaying(false)
  }, [clipOrder.join(','), groups.length])

  // ----- playhead 拖拽 -----
  const onPlayheadPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)
    playheadDrag.current = { startX: e.clientX, startSec: currentSec }
    if (isPlaying) setIsPlaying(false)
  }
  const onPlayheadPointerMove = (e: React.PointerEvent) => {
    const d = playheadDrag.current
    const track = trackRef.current
    if (!d || !track) return
    const rect = track.getBoundingClientRect()
    const dxSec = ((e.clientX - d.startX) / rect.width) * totalSec
    seekTo(d.startSec + dxSec)
  }
  const onPlayheadPointerUp = (e: React.PointerEvent) => {
    const target = e.currentTarget as HTMLElement
    try { target.releasePointerCapture(e.pointerId) } catch { /* may already be released */ }
    playheadDrag.current = null
  }

  // ----- clip 拖拽重排 -----
  const onClipPointerDown = (e: React.PointerEvent, clipId: string, index: number) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)
    clipDrag.current = { clipId, fromIndex: index, pointerId: e.pointerId }
    setDraggingClipId(clipId)
    setDragOverIndex(index)
  }
  const onClipPointerMove = (e: React.PointerEvent) => {
    const d = clipDrag.current
    const track = trackRef.current
    if (!d || !track) return
    const rect = track.getBoundingClientRect()
    const relX = e.clientX - rect.left
    const slotW = rect.width / clips.length
    // 中心点命中目标 slot
    const target = Math.max(0, Math.min(clips.length - 1, Math.floor((relX + slotW / 2) / slotW)))
    if (target !== dragOverIndex) setDragOverIndex(target)
  }
  const onClipPointerUp = (e: React.PointerEvent) => {
    const d = clipDrag.current
    const target = e.currentTarget as HTMLElement
    try { target.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
    if (d && dragOverIndex != null && dragOverIndex !== d.fromIndex) {
      const next = [...clipOrder]
      const [moved] = next.splice(d.fromIndex, 1)
      next.splice(dragOverIndex, 0, moved)
      onClipReorder(next)
      setUserReordered(true)
    }
    clipDrag.current = null
    setDraggingClipId(null)
    setDragOverIndex(null)
  }
  const onClipPointerCancel = (e: React.PointerEvent) => {
    const target = e.currentTarget as HTMLElement
    try { target.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
    clipDrag.current = null
    setDraggingClipId(null)
    setDragOverIndex(null)
  }

  // ----- 计算"被拖 clip 之外其他 clip 的预演位移" -----
  // 视觉规则:
  //   from < target: 区间 (from+1 .. target] 的 clip 左移 1 槽
  //   from > target: 区间 [target .. from-1] 的 clip 右移 1 槽
  //   from === target: 不动
  function previewOffset(currentIndex: number): number {
    const d = clipDrag.current
    if (!d || dragOverIndex == null) return 0
    if (d.fromIndex === dragOverIndex) return 0
    if (currentIndex === d.fromIndex) return 0 // 被拖的 clip 不参与预演
    if (d.fromIndex < dragOverIndex) {
      if (currentIndex > d.fromIndex && currentIndex <= dragOverIndex) return -1
    } else {
      if (currentIndex >= dragOverIndex && currentIndex < d.fromIndex) return 1
    }
    return 0
  }

  // ----- 工具 -----
  const formatTime = (sec: number) => {
    const s = Math.max(0, Math.floor(sec))
    const m = Math.floor(s / 60)
    const r = s % 60
    return `${m}:${r.toString().padStart(2, '0')}`
  }

  const togglePlay = () => {
    if (playableClips.length === 0) return
    if (currentSec >= totalSec - 0.05) setCurrentSec(0)
    setIsPlaying((p) => !p)
  }

  const resetOrder = () => {
    onClipReorder(groups.map((g) => g.id))
    setUserReordered(false)
  }

  // ----- 渲染:空态 -----
  if (clips.length === 0) {
    return (
      <div className="max-w-4xl mx-auto panel p-10 text-center">
        <Film size={32} className="mx-auto text-text-muted mb-3" />
        <p className="text-text-muted text-sm">{i18n.empty}</p>
      </div>
    )
  }

  const playheadPercent = totalSec > 0 ? Math.min(100, (currentSec / totalSec) * 100) : 0

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="font-display text-lg font-bold inline-flex items-center gap-2">
          <Clock size={16} /> {i18n.title} · {totalSec.toFixed(0)}s
          {playableTotalSec < totalSec && (
            <span className="text-xs text-text-muted font-normal">
              (可播放 {playableTotalSec.toFixed(0)}s)
            </span>
          )}
        </h2>
        {/* 持久化状态汇总 */}
        {playableClips.length > 0 && (
          <div className="text-[10px] text-text-muted flex items-center gap-2 -mt-1">
            <span className="inline-flex items-center gap-1">
              <CloudCheck size={11} className="text-emerald-400" />
              已入库 {clips.filter((c) => c.playable && c.persisted).length}
            </span>
            <span className="inline-flex items-center gap-1">
              <CloudOff size={11} className="text-amber-400" />
              临时 {clips.filter((c) => c.playable && !c.persisted).length} (24h 后过期)
            </span>
          </div>
        )}
        <div className="flex items-center gap-2">
          {userReordered && (
            <button
              type="button"
              onClick={resetOrder}
              className="text-xs px-2.5 py-1 rounded border border-border bg-bg-elevated text-text-secondary hover:border-accent hover:text-accent transition inline-flex items-center gap-1"
            >
              <RotateCcw size={11} /> {i18n.resetOrder}
            </button>
          )}
        </div>
      </div>

      {/* 主视频播放器 */}
      <div className="panel p-3">
        <div className="relative w-full max-w-3xl mx-auto bg-black rounded-lg overflow-hidden aspect-video">
          {activeClip ? (
            <video
              ref={(el) => { videoRefs.current[activeClip.groupId] = el }}
              src={activeClip.video?.url}
              className="absolute inset-0 w-full h-full"
              playsInline
              muted={false}
              onEnded={() => {
                // 推进 currentSec 到下一个 clip 的起始
                setCurrentSec((cur) => Math.min(totalSec, cur + clipDurationSec))
                const nextIdx = activeClipIndex + 1
                if (nextIdx < playableClips.length) setActiveClipIndex(nextIdx)
                else setIsPlaying(false)
              }}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-text-muted text-sm">
              <div className="text-center space-y-2">
                <Film size={32} className="mx-auto opacity-50" />
                <p>{i18n.noVideo}</p>
              </div>
            </div>
          )}
          {/* 当前播放的 clip 标签 */}
          {activeClip && (
            <div className="absolute top-2 left-2 px-2 py-0.5 rounded bg-black/60 backdrop-blur text-[10px] text-white font-mono">
              #{activeClip.group.index} · {activeClip.group.sceneLocation || ''}
            </div>
          )}
        </div>

        {/* 控制条 */}
        <div className="flex items-center gap-3 mt-3 px-1">
          <button
            type="button"
            onClick={togglePlay}
            disabled={playableClips.length === 0}
            className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-accent text-white hover:bg-accent/90 transition disabled:opacity-40"
            aria-label={isPlaying ? i18n.pause : i18n.play}
          >
            {isPlaying ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
          </button>
          <div className="flex-1 font-mono text-xs text-text-secondary tabular-nums">
            {formatTime(currentSec)} / {formatTime(totalSec)}
          </div>
          <div className="text-[10px] text-text-muted">
            {clips.length} 个片段 · 已生成 {playableClips.length} / {clips.length}
          </div>
        </div>
      </div>

      {/* 时间轴(Ruler + Track) */}
      <div className="panel p-3 space-y-2">
        {/* 提示 */}
        <div className="text-[10px] text-text-muted px-1">{i18n.hint}</div>

        {/* 标尺 */}
        <div className="relative h-4 px-1 text-[10px] font-mono text-text-muted select-none">
          {Array.from({ length: clips.length + 1 }).map((_, i) => {
            const sec = i * clipDurationSec
            const left = clips.length > 0 ? (i / clips.length) * 100 : 0
            return (
              <span
                key={i}
                className="absolute -translate-x-1/2"
                style={{ left: `${left}%` }}
              >
                {sec}s
              </span>
            )
          })}
        </div>

        {/* Track 容器(横向 flex,每个 clip 等宽) */}
        <div
          ref={trackRef}
          className="relative flex w-full bg-bg-elevated/40 rounded overflow-hidden select-none"
          style={{ height: 72 }}
        >
          {clips.map((c, i) => {
            const isDragging = draggingClipId === c.groupId
            const offset = previewOffset(i)
            return (
              <div
                key={c.groupId}
                onPointerDown={(e) => onClipPointerDown(e, c.groupId, i)}
                onPointerMove={onClipPointerMove}
                onPointerUp={onClipPointerUp}
                onPointerCancel={onClipPointerCancel}
                className={`relative shrink-0 grow basis-0 border-r last:border-r-0 border-border/60 cursor-grab active:cursor-grabbing transition-transform ${
                  isDragging ? 'opacity-60 scale-[1.02] z-10' : ''
                }`}
                style={{
                  transform: `translateX(${offset * 100}%)`,
                  transition: isDragging ? 'none' : 'transform 200ms ease',
                }}
                title={`#${c.group.index} · ${c.group.sceneLocation || '未命名场景'}${c.playable ? '' : ' · 未生成视频'}`}
              >
                {/* 缩略图背景 */}
                {c.thumb ? (
                  <img
                    src={c.thumb}
                    alt=""
                    draggable={false}
                    className="absolute inset-0 w-full h-full object-cover opacity-70"
                  />
                ) : (
                  <div className="absolute inset-0 bg-gradient-to-br from-bg-elevated to-bg-base" />
                )}
                {/* 渐变蒙版 */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
                {/* 编号 + 状态 */}
                <div className="absolute top-1 left-1 right-1 flex items-center justify-between text-[10px] font-mono text-white/90">
                  <span className="inline-flex items-center gap-0.5 bg-black/50 px-1 rounded">
                    <GripVertical size={9} /> #{c.group.index}
                  </span>
                  <div className="flex items-center gap-1">
                    {/* 已入库 / 临时徽章 —— 持久化与否影响跨 session 可用性 */}
                    {c.playable && (
                      <span
                        className={`inline-flex items-center gap-0.5 px-1 rounded ${
                          isPersistedUrl(c.video?.url)
                            ? 'bg-emerald-500/70 text-white'
                            : 'bg-amber-500/70 text-white'
                        }`}
                        title={isPersistedUrl(c.video?.url)
                          ? '已入库到你的存储,永久有效'
                          : '临时链接,24h 后过期(点左上角保存可入库)'}
                      >
                        {isPersistedUrl(c.video?.url)
                          ? <CloudCheck size={9} />
                          : <CloudOff size={9} />}
                      </span>
                    )}
                    {!c.playable && (
                      <span className="inline-flex items-center gap-0.5 bg-black/60 px-1 rounded text-amber-300">
                        {c.video?.status === 'running' ? (
                          <Loader2 size={9} className="animate-spin" />
                        ) : c.video?.status === 'failed' ? (
                          <AlertCircle size={9} />
                        ) : (
                          <Film size={9} />
                        )}
                      </span>
                    )}
                  </div>
                </div>
                {/* 底部 sceneLocation 标签 */}
                <div className="absolute bottom-1 left-1 right-1 text-[10px] text-white/80 truncate">
                  {c.group.sceneLocation || `第 ${i + 1} 段`}
                </div>
                {/* 当前 active 高亮 */}
                {activeClip?.groupId === c.groupId && (
                  <div className="absolute inset-0 ring-2 ring-accent pointer-events-none rounded-sm" />
                )}
              </div>
            )
          })}

          {/* Playhead 竖线(覆盖整个 track) */}
          <div
            onPointerDown={onPlayheadPointerDown}
            onPointerMove={onPlayheadPointerMove}
            onPointerUp={onPlayheadPointerUp}
            className="absolute top-0 bottom-0 w-0.5 bg-accent cursor-ew-resize z-20"
            style={{ left: `${playheadPercent}%`, boxShadow: '0 0 8px var(--color-accent)' }}
            aria-label="playhead"
          >
            {/* playhead 顶部把手 */}
            <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-accent border-2 border-white" />
          </div>
        </div>

        {/* 改动提示 */}
        {userReordered && (
          <div className="text-[10px] text-accent px-1">{i18n.reorderChanged}</div>
        )}
      </div>
    </div>
  )
}