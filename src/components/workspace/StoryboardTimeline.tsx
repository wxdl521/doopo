import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Play,
  Pause,
  RotateCcw,
  Clock,
  Film,
  Loader2,
  AlertCircle,
  GripVertical,
  CloudCheck,
  CloudOff,
  Download,
} from "lucide-react";
import type { StoryboardGroup } from "../../data/workspaceGenerators";

/**
 * 检测 URL 是否已入库到用户自己的 Supabase Storage(workspace-media bucket)。
 * 已入库 = 永久有效,不会 24h 过期。
 * 跟 workspaceMedia.functions.ts 的 isAlreadyPersisted 同语义,客户端用于徽章展示。
 */
function isPersistedUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    const path = u.pathname || "";
    return /\/(?:storage\/v1\/)?object\/(?:public|sign)\/workspace-media\//.test(path);
  } catch {
    return false;
  }
}

/**
 * 2026/06:Storyboard → Timeline 拼接播放视图。
 *
 *  - 多个分镜组生成的视频按"clipOrder"顺序拼接播放，时长取视频 metadata；
 *    metadata 尚未加载时才按分镜/生成请求时长兜底。
 *  - 顶部主视频播放器会预加载所有片段；切换时只切换可见层，不替换 video src，
 *    避免下一个片段重新缓冲导致黑帧。
 *  - 底部按帧时间轴:横向 clip 缩略图条 + 可拖拽竖线 playhead。
 *  - 支持两种拖拽(都用 Pointer Events,零依赖):
 *      1) 拖 playhead → 跳转播放进度
 *      2) 拖 clip  → 重新排序(松手时落点 < 中心 > 判定目标 index)
 *
 *  不做的事:不做转场、裁切、调时长、关键帧 —— 仅"类似剪辑的播放+拖拽"预览体验。
 */

export type GroupVideoMap = Record<
  string,
  { url: string; status: "running" | "succeeded" | "failed"; durationSec?: number }
>;

type Props = {
  groups: StoryboardGroup[];
  groupVideos: GroupVideoMap;
  /** 用户可调整的播放顺序(groupId 数组)。父组件管理以便持久化/重置。 */
  clipOrder: string[];
  onClipReorder: (nextOrder: string[]) => void;
  /** 旧数据没有真实 metadata 时的兜底时长。 */
  clipDurationSec?: number;
  /** 浏览器读到视频 metadata 后，回写真实时长以便持久化。 */
  onVideoDurationDetected?: (groupId: string, durationSec: number) => void;
  /** i18n 文案 */
  i18n: {
    title: string;
    hint: string;
    play: string;
    pause: string;
    resetOrder: string;
    noVideo: string;
    generating: string;
    failed: string;
    empty: string;
    reorderChanged: string;
  };
};

const DEFAULT_CLIP_DUR = 10;

export default function StoryboardTimeline({
  groups,
  groupVideos,
  clipOrder,
  onClipReorder,
  clipDurationSec = DEFAULT_CLIP_DUR,
  onVideoDurationDetected,
  i18n,
}: Props) {
  // ----- 派生数据 -----
  // 按 clipOrder 排列的 clip,包含 group + video 元数据
  type Clip = {
    groupId: string;
    group: StoryboardGroup;
    video: GroupVideoMap[string] | undefined;
    /** 当前 clip 是否已生成可播放视频(用做 active candidate) */
    playable: boolean;
    /** 缩略图:优先用第一张分镜图,没有就用 storyboard 图 */
    thumb: string | undefined;
    /** 是否已入库到用户自己的 Supabase Storage(永久有效) */
    persisted: boolean;
    /** 文件实际时长优先，未加载 metadata 时回退为生成请求/分镜时长。 */
    durationSec: number;
    /** 该片段在完整时间轴中的起始秒数。 */
    startSec: number;
  };
  const [measuredDurations, setMeasuredDurations] = useState<Record<string, number>>({});
  const clips: Clip[] = useMemo(() => {
    let cursor = 0;
    return clipOrder
      .map((id) => groups.find((g) => g.id === id))
      .filter((g): g is StoryboardGroup => !!g)
      .map((g) => {
        const v = groupVideos[g.id];
        const firstShotImg = g.shots.find((s) => s.imageUrl)?.imageUrl;
        const thumb = firstShotImg;
        const storyboardDuration =
          typeof g.startSec === "number" && typeof g.endSec === "number" && g.endSec > g.startSec
            ? g.endSec - g.startSec
            : clipDurationSec;
        const durationSec = Math.max(
          0.1,
          measuredDurations[g.id] ?? v?.durationSec ?? storyboardDuration ?? clipDurationSec,
        );
        const clip = {
          groupId: g.id,
          group: g,
          video: v,
          playable: !!v && v.status === "succeeded",
          thumb,
          persisted: isPersistedUrl(v?.url),
          durationSec,
          startSec: cursor,
        };
        cursor += durationSec;
        return clip;
      });
  }, [clipOrder, groups, groupVideos, measuredDurations, clipDurationSec]);

  const playableClips = useMemo(() => clips.filter((c) => c.playable), [clips]);
  const totalSec = clips.reduce((sum, clip) => sum + clip.durationSec, 0);
  const playableTotalSec = playableClips.reduce((sum, clip) => sum + clip.durationSec, 0);
  const clipOrderKey = clipOrder.join(",");

  // ----- 播放状态 -----
  const [activeClipIndex, setActiveClipIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentSec, setCurrentSec] = useState(0);
  const [userReordered, setUserReordered] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // ----- Refs -----
  const trackRef = useRef<HTMLDivElement | null>(null);
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  /** playhead 拖拽快照 */
  const playheadDrag = useRef<{ startX: number; startSec: number } | null>(null);
  /** clip 拖拽快照 */
  const clipDrag = useRef<{
    clipId: string;
    fromIndex: number;
    pointerId: number;
  } | null>(null);
  /** clip 拖拽时的目标 index(用于视觉预览),null 表示尚未移出原始槽 */
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [draggingClipId, setDraggingClipId] = useState<string | null>(null);

  // active 视频 id
  const activeClip = playableClips[activeClipIndex] ?? null;

  // ----- 自动播放头同步(active video 推进时,把 currentSec 同步过来) -----
  useEffect(() => {
    if (!activeClip) return;
    const v = videoRefs.current[activeClip.groupId];
    if (!v) return;
    if (isPlaying) {
      // 切片的起点来自完整轨道(而非 playableClips 的数组下标)，避免中间有
      // 未生成片段时播放头和视频错位。
      const relative = Math.max(
        0,
        Math.min(activeClip.durationSec, currentSec - activeClip.startSec),
      );
      if (Math.abs(v.currentTime - relative) > 0.15) v.currentTime = relative;
      void v.play().catch(() => {
        /* 用户没交互时 autoplay 可能被拒,忽略 */
      });
    } else {
      v.pause();
    }
    // 仅在 activeClip / isPlaying 切换时同步,避免每帧重跑
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeClip?.groupId, activeClip?.startSec, activeClip?.durationSec, isPlaying]);

  // 切段或暂停时立即停掉非当前媒体，避免它们在隐藏层继续播放音频。
  useEffect(() => {
    for (const [groupId, video] of Object.entries(videoRefs.current)) {
      if (groupId !== activeClip?.groupId) video?.pause();
    }
  }, [activeClip?.groupId, isPlaying]);

  // ----- seek -----
  const seekTo = useCallback(
    (sec: number) => {
      const clamped = Math.max(0, Math.min(totalSec, sec));
      if (playableClips.length === 0) return;
      const targetClip = clips.find(
        (clip) => clamped >= clip.startSec && clamped < clip.startSec + clip.durationSec,
      );
      // 点击尚未生成的片段时，跳至后续最近可播放片段；没有后续时回退到前一个。
      const nextClip =
        (targetClip && playableClips.find((clip) => clip.groupId === targetClip.groupId)) ||
        playableClips.find((clip) => clip.startSec >= clamped) ||
        playableClips.at(-1);
      if (!nextClip) return;
      const nextIdx = playableClips.findIndex((clip) => clip.groupId === nextClip.groupId);
      const nextSec = Math.max(
        nextClip.startSec,
        Math.min(clamped, nextClip.startSec + nextClip.durationSec),
      );
      setCurrentSec(nextSec);
      setActiveClipIndex(nextIdx);
      const nextVid = nextClip ? videoRefs.current[nextClip.groupId] : null;
      if (nextVid) {
        nextVid.currentTime = Math.max(0, nextSec - nextClip.startSec);
      }
    },
    [totalSec, playableClips, clips],
  );

  // ----- 切到 tab / 重置时,自动对齐到 0 -----
  useEffect(() => {
    setCurrentSec(0);
    setActiveClipIndex(0);
    setIsPlaying(false);
  }, [clipOrderKey, groups.length]);

  // ----- playhead 拖拽 -----
  const onPlayheadPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    playheadDrag.current = { startX: e.clientX, startSec: currentSec };
    if (isPlaying) setIsPlaying(false);
  };
  const onPlayheadPointerMove = (e: React.PointerEvent) => {
    const d = playheadDrag.current;
    const track = trackRef.current;
    if (!d || !track) return;
    const rect = track.getBoundingClientRect();
    const dxSec = ((e.clientX - d.startX) / rect.width) * totalSec;
    seekTo(d.startSec + dxSec);
  };
  const onPlayheadPointerUp = (e: React.PointerEvent) => {
    const target = e.currentTarget as HTMLElement;
    try {
      target.releasePointerCapture(e.pointerId);
    } catch {
      /* may already be released */
    }
    playheadDrag.current = null;
  };

  // ----- clip 拖拽重排 -----
  const onClipPointerDown = (e: React.PointerEvent, clipId: string, index: number) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    clipDrag.current = { clipId, fromIndex: index, pointerId: e.pointerId };
    setDraggingClipId(clipId);
    setDragOverIndex(index);
  };
  const onClipPointerMove = (e: React.PointerEvent) => {
    const d = clipDrag.current;
    const track = trackRef.current;
    if (!d || !track) return;
    const rect = track.getBoundingClientRect();
    const rel = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const sec = rel * totalSec;
    // 片段宽度按实际时长比例渲染，拖拽命中也必须按同一时间坐标计算。
    const hit = clips.findIndex((clip) => sec < clip.startSec + clip.durationSec);
    const target = hit === -1 ? clips.length - 1 : hit;
    if (target !== dragOverIndex) setDragOverIndex(target);
  };
  const onClipPointerUp = (e: React.PointerEvent) => {
    const d = clipDrag.current;
    const target = e.currentTarget as HTMLElement;
    try {
      target.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (d && dragOverIndex != null && dragOverIndex !== d.fromIndex) {
      const next = [...clipOrder];
      const [moved] = next.splice(d.fromIndex, 1);
      next.splice(dragOverIndex, 0, moved);
      onClipReorder(next);
      setUserReordered(true);
    }
    clipDrag.current = null;
    setDraggingClipId(null);
    setDragOverIndex(null);
  };
  const onClipPointerCancel = (e: React.PointerEvent) => {
    const target = e.currentTarget as HTMLElement;
    try {
      target.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    clipDrag.current = null;
    setDraggingClipId(null);
    setDragOverIndex(null);
  };

  // ----- 计算"被拖 clip 之外其他 clip 的预演位移" -----
  // 视觉规则:
  //   from < target: 区间 (from+1 .. target] 的 clip 左移 1 槽
  //   from > target: 区间 [target .. from-1] 的 clip 右移 1 槽
  //   from === target: 不动
  function previewOffset(currentIndex: number): number {
    const d = clipDrag.current;
    if (!d || dragOverIndex == null) return 0;
    if (d.fromIndex === dragOverIndex) return 0;
    if (currentIndex === d.fromIndex) return 0; // 被拖的 clip 不参与预演
    if (d.fromIndex < dragOverIndex) {
      if (currentIndex > d.fromIndex && currentIndex <= dragOverIndex) return -1;
    } else {
      if (currentIndex >= dragOverIndex && currentIndex < d.fromIndex) return 1;
    }
    return 0;
  }

  // ----- 工具 -----
  const formatTime = (sec: number) => {
    const s = Math.max(0, Math.floor(sec));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${r.toString().padStart(2, "0")}`;
  };

  const togglePlay = () => {
    if (playableClips.length === 0) return;
    if (currentSec >= totalSec - 0.05) {
      setCurrentSec(playableClips[0].startSec);
      setActiveClipIndex(0);
    }
    setIsPlaying((p) => !p);
  };

  const resetOrder = () => {
    onClipReorder(groups.map((g) => g.id));
    setUserReordered(false);
  };

  /**
   * 浏览器端逐条播放到 canvas，再用 MediaRecorder 录制为一个可下载的 WebM。
   * 这避免把大体积的 ffmpeg.wasm 打进 Cloudflare Worker；源视频必须允许浏览器跨域读取。
   */
  const exportTimelineVideo = async () => {
    if (playableClips.length === 0 || exporting) return;
    if (typeof MediaRecorder === "undefined" || typeof HTMLCanvasElement === "undefined") {
      setExportError("当前浏览器不支持视频渲染导出，请使用最新版 Chrome 或 Edge。");
      return;
    }

    setExporting(true);
    setExportError(null);
    setIsPlaying(false);
    const source = document.createElement("video");
    source.crossOrigin = "anonymous";
    source.playsInline = true;
    source.preload = "auto";
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    let animationFrame = 0;
    let audioContext: AudioContext | undefined;

    try {
      if (!context) throw new Error("无法创建视频渲染画布。");
      const ready = (video: HTMLVideoElement) =>
        new Promise<void>((resolve, reject) => {
          video.oncanplay = () => resolve();
          video.onerror = () => reject(new Error("视频加载失败，无法导出。"));
        });

      source.src = playableClips[0].video!.url;
      source.load();
      await ready(source);
      canvas.width = source.videoWidth || 1280;
      canvas.height = source.videoHeight || 720;

      const canvasStream = canvas.captureStream(30);
      const outputTracks = [...canvasStream.getVideoTracks()];
      try {
        audioContext = new AudioContext();
        const destination = audioContext.createMediaStreamDestination();
        audioContext.createMediaElementSource(source).connect(destination);
        await audioContext.resume();
        outputTracks.push(...destination.stream.getAudioTracks());
      } catch {
        // 音轨获取失败时仍导出画面；跨域源常会限制 Web Audio。
      }

      const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
        ? "video/webm;codecs=vp9,opus"
        : "video/webm";
      const recorder = new MediaRecorder(new MediaStream(outputTracks), { mimeType });
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      const finished = new Promise<Blob>((resolve) => {
        recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
      });
      const drawFrame = () => {
        context.drawImage(source, 0, 0, canvas.width, canvas.height);
        animationFrame = requestAnimationFrame(drawFrame);
      };

      recorder.start();
      drawFrame();
      for (const clip of playableClips) {
        source.src = clip.video!.url;
        source.load();
        await ready(source);
        source.currentTime = 0;
        await new Promise<void>((resolve, reject) => {
          source.onended = () => resolve();
          source.onerror = () => reject(new Error("渲染时有视频片段加载失败。"));
          void source.play().catch(reject);
        });
      }
      cancelAnimationFrame(animationFrame);
      recorder.stop();
      const blob = await finished;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `doopoo-timeline-${new Date().toISOString().slice(0, 10)}.webm`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (error) {
      cancelAnimationFrame(animationFrame);
      setExportError(error instanceof Error ? error.message : "视频渲染导出失败。");
    } finally {
      source.pause();
      source.removeAttribute("src");
      source.load();
      await audioContext?.close().catch(() => {});
      setExporting(false);
    }
  };

  // ----- 渲染:空态 -----
  if (clips.length === 0) {
    return (
      <div className="max-w-4xl mx-auto panel p-10 text-center">
        <Film size={32} className="mx-auto text-text-muted mb-3" />
        <p className="text-text-muted text-sm">{i18n.empty}</p>
      </div>
    );
  }

  const playheadPercent = totalSec > 0 ? Math.min(100, (currentSec / totalSec) * 100) : 0;

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
          <button
            type="button"
            onClick={() => void exportTimelineVideo()}
            disabled={playableClips.length === 0 || exporting}
            className="text-xs px-2.5 py-1 rounded border border-accent bg-accent-dim text-accent hover:bg-accent hover:text-white transition inline-flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
            title="按当前时间轴顺序渲染为一个 WebM 视频并下载"
          >
            {exporting ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />}
            {exporting ? "渲染导出中…" : "渲染并导出"}
          </button>
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
      {exportError && <p className="text-xs text-rose-500 -mt-2">{exportError}</p>}

      {/* 主视频播放器 */}
      <div className="panel p-3">
        <div className="relative w-full max-w-3xl mx-auto bg-black rounded-lg overflow-hidden aspect-video">
          {activeClip ? (
            playableClips.map((clip, index) => (
              <video
                key={clip.groupId}
                ref={(el) => {
                  videoRefs.current[clip.groupId] = el;
                }}
                src={clip.video?.url}
                preload="auto"
                className={`absolute inset-0 w-full h-full transition-opacity duration-0 ${
                  index === activeClipIndex ? "opacity-100" : "opacity-0 pointer-events-none"
                }`}
                playsInline
                muted={false}
                onLoadedMetadata={(event) => {
                  const duration = event.currentTarget.duration;
                  if (!Number.isFinite(duration) || duration <= 0) return;
                  setMeasuredDurations((current) => {
                    if (Math.abs((current[clip.groupId] ?? 0) - duration) < 0.05) return current;
                    return { ...current, [clip.groupId]: duration };
                  });
                  onVideoDurationDetected?.(clip.groupId, duration);
                }}
                onTimeUpdate={(event) => {
                  if (!isPlaying || activeClip.groupId !== clip.groupId) return;
                  setCurrentSec(clip.startSec + event.currentTarget.currentTime);
                }}
                onEnded={() => {
                  if (activeClip.groupId !== clip.groupId) return;
                  // 下一条已经预加载，只切换可见层并立即播放，不会经过黑屏缓冲。
                  const clipEnd = Math.min(totalSec, clip.startSec + clip.durationSec);
                  setCurrentSec(clipEnd);
                  const nextIdx = index + 1;
                  if (nextIdx < playableClips.length) {
                    const next = playableClips[nextIdx];
                    setCurrentSec(next.startSec);
                    setActiveClipIndex(nextIdx);
                  } else {
                    setIsPlaying(false);
                  }
                }}
              />
            ))
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
              #{activeClip.group.index} · {activeClip.group.sceneLocation || ""}
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
        <input
          type="range"
          min={0}
          max={Math.max(totalSec, 0.1)}
          step={0.01}
          value={Math.min(currentSec, totalSec)}
          onChange={(event) => seekTo(Number(event.target.value))}
          disabled={playableClips.length === 0}
          className="mt-2 w-full h-1.5 accent-accent cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="视频播放进度"
        />
      </div>

      {/* 时间轴(Ruler + Track) */}
      <div className="panel p-3 space-y-2">
        {/* 提示 */}
        <div className="text-[10px] text-text-muted px-1">{i18n.hint}</div>

        {/* 标尺 */}
        <div className="relative h-4 px-1 text-[10px] font-mono text-text-muted select-none">
          {[...clips, { startSec: totalSec }].map((clip, i) => {
            const left = totalSec > 0 ? (clip.startSec / totalSec) * 100 : 0;
            return (
              <span key={i} className="absolute -translate-x-1/2" style={{ left: `${left}%` }}>
                {clip.startSec.toFixed(1).replace(/\.0$/, "")}s
              </span>
            );
          })}
        </div>

        {/* Track 容器(横向 flex,每个 clip 等宽) */}
        <div
          ref={trackRef}
          className="relative flex w-full bg-bg-elevated/40 rounded overflow-hidden select-none"
          style={{ height: 72 }}
        >
          {clips.map((c, i) => {
            const isDragging = draggingClipId === c.groupId;
            const offset = previewOffset(i);
            return (
              <div
                key={c.groupId}
                onPointerDown={(e) => onClipPointerDown(e, c.groupId, i)}
                onPointerMove={onClipPointerMove}
                onPointerUp={onClipPointerUp}
                onPointerCancel={onClipPointerCancel}
                className={`relative shrink-0 border-r last:border-r-0 border-border/60 cursor-grab active:cursor-grabbing transition-transform ${
                  isDragging ? "opacity-60 scale-[1.02] z-10" : ""
                }`}
                style={{
                  width: `${totalSec > 0 ? (c.durationSec / totalSec) * 100 : 0}%`,
                  transform: `translateX(${offset * 100}%)`,
                  transition: isDragging ? "none" : "transform 200ms ease",
                }}
                title={`#${c.group.index} · ${c.group.sceneLocation || "未命名场景"}${c.playable ? "" : " · 未生成视频"}`}
              >
                {/* 缩略图背景 */}
                {c.thumb ? (
                  <img
                    src={c.thumb}
                    alt=""
                    draggable={false}
                    className="absolute inset-0 w-full h-full object-cover opacity-70"
                  />
                ) : c.playable && c.video?.url ? (
                  <video
                    src={c.video.url}
                    muted
                    playsInline
                    preload="metadata"
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
                            ? "bg-emerald-500/70 text-white"
                            : "bg-amber-500/70 text-white"
                        }`}
                        title={
                          isPersistedUrl(c.video?.url)
                            ? "已入库到你的存储,永久有效"
                            : "临时链接,24h 后过期(点左上角保存可入库)"
                        }
                      >
                        {isPersistedUrl(c.video?.url) ? (
                          <CloudCheck size={9} />
                        ) : (
                          <CloudOff size={9} />
                        )}
                      </span>
                    )}
                    {!c.playable && (
                      <span className="inline-flex items-center gap-0.5 bg-black/60 px-1 rounded text-amber-300">
                        {c.video?.status === "running" ? (
                          <Loader2 size={9} className="animate-spin" />
                        ) : c.video?.status === "failed" ? (
                          <AlertCircle size={9} />
                        ) : (
                          <Film size={9} />
                        )}
                      </span>
                    )}
                  </div>
                </div>
                {/* 组号始终可见，场景名作为补充。 */}
                <div className="absolute bottom-1 left-1 right-1 text-[10px] text-white/80 truncate">
                  第 {c.group.index} 分镜组{c.group.sceneLocation ? ` · ${c.group.sceneLocation}` : ""}
                </div>
                {/* 当前 active 高亮 */}
                {activeClip?.groupId === c.groupId && (
                  <div className="absolute inset-0 ring-2 ring-accent pointer-events-none rounded-sm" />
                )}
              </div>
            );
          })}

          {/* Playhead 竖线(覆盖整个 track) */}
          <div
            onPointerDown={onPlayheadPointerDown}
            onPointerMove={onPlayheadPointerMove}
            onPointerUp={onPlayheadPointerUp}
            className="absolute top-0 bottom-0 w-0.5 bg-accent cursor-ew-resize z-20"
            style={{ left: `${playheadPercent}%`, boxShadow: "0 0 8px var(--color-accent)" }}
            aria-label="playhead"
          >
            {/* playhead 顶部把手 */}
            <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-accent border-2 border-white" />
          </div>
        </div>

        {/* 改动提示 */}
        {userReordered && <div className="text-[10px] text-accent px-1">{i18n.reorderChanged}</div>}
      </div>
    </div>
  );
}
