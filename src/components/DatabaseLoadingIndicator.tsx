import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { DATA_REQUEST_EVENT, getPendingDataRequests } from "@/lib/dataRequestLoading";

/** A non-blocking global indicator for direct Supabase browser requests. */
export default function DatabaseLoadingIndicator() {
  const [pending, setPending] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onRequest = (event: Event) => {
      const delta = (event as CustomEvent<number>).detail;
      setPending((count) => Math.max(0, count + delta));
    };
    window.addEventListener(DATA_REQUEST_EVENT, onRequest);
    // Child effects can start Supabase requests before this indicator's effect
    // subscribes. Read the shared counter once so their in-flight work is shown.
    setPending(getPendingDataRequests());
    return () => window.removeEventListener(DATA_REQUEST_EVENT, onRequest);
  }, []);

  useEffect(() => {
    if (pending === 0) {
      setVisible(false);
      return;
    }
    const timer = window.setTimeout(() => setVisible(true), 150);
    return () => window.clearTimeout(timer);
  }, [pending]);

  if (!visible) return null;

  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-[100] rounded-full border border-accent/30 bg-bg-surface/95 px-3 py-2 text-xs text-text-secondary shadow-lg backdrop-blur"
      role="status"
      aria-live="polite"
    >
      <span className="flex items-center gap-2">
        <Loader2 size={14} className="animate-spin text-accent" />
        正在同步数据…
      </span>
    </div>
  );
}
