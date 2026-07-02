// Frontend-side helper: print server-returned image meta to the browser console
// so users can quote requestId / azureRequestId when reporting issues.

type AnyImageResult = {
  url?: string;
  error?: string | null;
  model?: string;
  meta?: {
    requestId?: string;
    azureRequestId?: string;
    region?: string;
    processingMs?: number;
    durationMs?: number;
    status?: number;
    deployment?: string;
    endpoint?: string;
    apiVersion?: string;
    retries?: number;
  } | null;
};

export function logImageMeta(label: string, res: AnyImageResult | null | undefined): void {
  if (!res) return;
  const meta = res.meta;
  const tag = res.error ? "❌" : res.url ? "✓" : "∅";
  const head = `[image ${tag}] ${label} model=${res.model ?? "-"}`;
  if (meta) {
    // Group so devs can expand for full headers; collapsed by default to keep console quiet.

    console.groupCollapsed(
      `${head} rid=${meta.requestId ?? "-"} status=${meta.status ?? "-"} dur=${meta.durationMs ?? "-"}ms`,
    );

    console.log("meta", meta);
    if (res.error) console.warn("error", res.error);

    console.groupEnd();
  } else if (res.error) {
    console.warn(head, res.error);
  } else {
    console.info(head);
  }
}
