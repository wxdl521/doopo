import { Funnel, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import {
  DATA_REQUEST_EVENT,
  getDataRequestProgress,
  type DataRequestProgress,
} from "@/lib/dataRequestLoading";

/** A non-blocking global indicator for direct Supabase browser requests. */
export default function DatabaseLoadingIndicator() {
  const [progress, setProgress] = useState<DataRequestProgress>(() => getDataRequestProgress());
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onRequest = (event: Event) => {
      setProgress((event as CustomEvent<DataRequestProgress>).detail);
    };
    window.addEventListener(DATA_REQUEST_EVENT, onRequest);
    // Child effects can start Supabase requests before this indicator's effect
    // subscribes. Read the shared progress once so their in-flight work is shown.
    setProgress(getDataRequestProgress());
    return () => window.removeEventListener(DATA_REQUEST_EVENT, onRequest);
  }, []);

  useEffect(() => {
    if (progress.pending === 0) {
      setVisible(false);
      return;
    }
    const timer = window.setTimeout(() => setVisible(true), 150);
    return () => window.clearTimeout(timer);
  }, [progress.pending]);

  if (!visible) return null;

  const progressPercent = progress.total
    ? Math.round((progress.completed / progress.total) * 100)
    : 0;

  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-[100] flex min-w-64 items-center gap-3 rounded-xl border border-accent/30 bg-bg-surface/95 px-3 py-2.5 text-xs text-text-secondary shadow-lg backdrop-blur"
      role="status"
      aria-live="polite"
    >
      <span className="relative grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent">
        <Funnel size={17} className="animate-pulse" aria-hidden="true" />
        <Loader2 size={10} className="absolute bottom-0.5 animate-spin" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-3 font-medium text-text-primary">
          <span>正在从数据库加载</span>
          <span className="tabular-nums text-accent">
            {progress.completed}/{progress.total}
          </span>
        </span>
        <span
          className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-bg-elevated"
          role="progressbar"
          aria-label="数据库加载进度"
          aria-valuemin={0}
          aria-valuemax={progress.total}
          aria-valuenow={progress.completed}
          aria-valuetext={`已完成 ${progress.completed} 项，共 ${progress.total} 项，剩余 ${progress.pending} 项`}
        >
          <span
            className="block h-full rounded-full bg-accent transition-[width] duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </span>
        <span className="mt-1 block text-[11px] text-text-muted">
          漏斗处理中，剩余 {progress.pending} 项调用
        </span>
      </span>
    </div>
  );
}
