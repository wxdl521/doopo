// ====================================================================
//  转绘 v2 阶段一 —— 逐集分析进度面板
//
//  轮询 getEpisodeAnalysisProgressFn（3s 间隔），全部集到达终态
//  （succeeded / failed，且无 running）后停止。失败集提供
//  「重跑失败单元」按钮（submitEpisodeAnalysisFn 带 unitIds，由上层执行）。
// ====================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import {
  getEpisodeAnalysisProgressFn,
  type EpisodeProgress,
} from "@/lib/restyle/restyleVideoAnalysis.functions";

const POLL_INTERVAL_MS = 3_000;

const STATUS_STYLE: Record<string, { label: string; className: string }> = {
  pending: { label: "待分析", className: "border-border bg-bg-elevated text-text-muted" },
  running: { label: "分析中", className: "border-sky-500/40 bg-sky-500/10 text-sky-400" },
  succeeded: {
    label: "已完成",
    className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  },
  failed: { label: "失败", className: "border-red-500/40 bg-red-500/10 text-red-400" },
};

export function AnalysisStatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLE[status] ?? {
    label: status,
    className: "border-border bg-bg-elevated text-text-muted",
  };
  return (
    <Badge variant="outline" className={cn("text-xs", style.className)}>
      {style.label}
    </Badge>
  );
}

export interface AnalysisProgressPanelProps {
  projectId: string;
  /** 重跑失败单元；返回错误信息或 null（成功）。 */
  onRetryFailed: (episode: EpisodeProgress) => Promise<string | null>;
  /** 上层媒体准备中的集（还没提交分析），一并展示。 */
  pendingEpisodeIds?: string[];
  /** 变化时强制刷新一次（如刚提交完分析）。 */
  refreshKey?: number;
}

export default function AnalysisProgressPanel({
  projectId,
  onRetryFailed,
  refreshKey = 0,
}: AnalysisProgressPanelProps) {
  const callProgress = useServerFn(getEpisodeAnalysisProgressFn);
  const [episodes, setEpisodes] = useState<EpisodeProgress[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [retryError, setRetryError] = useState<Record<string, string>>({});
  const timerRef = useRef<number | null>(null);

  const fetchOnce = useCallback(async () => {
    const result = await callProgress({ data: { projectId } });
    if (!result.ok) {
      setLoadError(result.error ?? "进度查询失败。");
      return true; // 查询失败不阻塞后续轮询
    }
    setLoadError(null);
    setEpisodes(result.episodes);
    // 全部终态：没有任何 running / 有单元但仍 pending 的集
    const allTerminal = result.episodes.every(
      (ep) => ep.status !== "running" && !(ep.status === "pending" && ep.unitsTotal > 0),
    );
    return allTerminal;
  }, [callProgress, projectId]);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const stop = await fetchOnce();
      if (cancelled) return;
      if (!stop) {
        timerRef.current = window.setTimeout(tick, POLL_INTERVAL_MS);
      }
    };
    void tick();
    return () => {
      cancelled = true;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [fetchOnce, refreshKey]);

  const handleRetry = async (episode: EpisodeProgress) => {
    setRetryingId(episode.episodeId);
    setRetryError((prev) => ({ ...prev, [episode.episodeId]: "" }));
    try {
      const error = await onRetryFailed(episode);
      if (error) setRetryError((prev) => ({ ...prev, [episode.episodeId]: error }));
      else await fetchOnce();
    } finally {
      setRetryingId(null);
    }
  };

  if (episodes.length === 0 && !loadError) {
    return <p className="text-xs text-text-muted">暂无集数据，上传视频后开始分析。</p>;
  }

  return (
    <div className="space-y-3">
      {loadError && <p className="text-xs text-red-400">进度查询失败：{loadError}</p>}
      {episodes.map((episode) => {
        const percent =
          episode.unitsTotal > 0
            ? Math.round((episode.unitsSucceeded / episode.unitsTotal) * 100)
            : 0;
        return (
          <Card key={episode.episodeId} className="border-border bg-bg-elevated/40">
            <CardHeader className="flex-row items-center justify-between space-y-0 px-4 py-3">
              <CardTitle className="text-sm font-medium text-text-secondary">
                第 {episode.episodeNo ?? "?"} 集
              </CardTitle>
              <AnalysisStatusBadge status={episode.status} />
            </CardHeader>
            <CardContent className="space-y-2 px-4 pb-4">
              <div className="flex items-center gap-3">
                <Progress value={percent} className="h-1.5 flex-1" />
                <span className="shrink-0 text-xs text-text-muted">
                  单元 {episode.unitsSucceeded}/{episode.unitsTotal}
                  {episode.unitsFailed > 0 && (
                    <span className="text-red-400">（失败 {episode.unitsFailed}）</span>
                  )}
                </span>
              </div>
              {episode.error && (
                <p className="whitespace-pre-wrap text-xs text-red-400">{episode.error}</p>
              )}
              {retryError[episode.episodeId] && (
                <p className="whitespace-pre-wrap text-xs text-red-400">
                  {retryError[episode.episodeId]}
                </p>
              )}
              {episode.status === "failed" && episode.unitsFailed > 0 && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={retryingId === episode.episodeId}
                  onClick={() => void handleRetry(episode)}
                >
                  {retryingId === episode.episodeId ? "重跑中…" : "重跑失败单元"}
                </Button>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
