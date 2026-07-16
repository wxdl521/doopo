/**
 * Client-side request counter for direct Supabase browser reads and writes.
 * Keep this scoped to Supabase: Server Functions also power AI generation and
 * must not be presented to the user as database synchronization.
 */
export const DATA_REQUEST_EVENT = "doopoo:data-request";

let pendingRequests = 0;

export function getPendingDataRequests() {
  return pendingRequests;
}

function updatePendingRequests(delta: 1 | -1) {
  pendingRequests = Math.max(0, pendingRequests + delta);
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<number>(DATA_REQUEST_EVENT, { detail: delta }));
}

export async function trackDataRequest<T>(request: () => Promise<T>): Promise<T> {
  updatePendingRequests(1);
  try {
    return await request();
  } finally {
    updatePendingRequests(-1);
  }
}

export function trackDataFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return trackDataRequest(() => fetch(input, init));
}
