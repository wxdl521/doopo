/**
 * Client-side request counter for direct Supabase browser reads and writes.
 * Keep this scoped to Supabase: Server Functions also power AI generation and
 * must not be presented to the user as database synchronization.
 */
export const DATA_REQUEST_EVENT = "doopoo:data-request";

let pendingRequests = 0;
let totalRequests = 0;
let completedRequests = 0;

export type DataRequestProgress = {
  pending: number;
  total: number;
  completed: number;
};

export function getPendingDataRequests() {
  return pendingRequests;
}

export function getDataRequestProgress(): DataRequestProgress {
  return {
    pending: pendingRequests,
    total: totalRequests,
    completed: completedRequests,
  };
}

function updatePendingRequests(delta: 1 | -1) {
  if (delta === 1) {
    if (pendingRequests === 0) {
      totalRequests = 0;
      completedRequests = 0;
    }
    pendingRequests += 1;
    totalRequests += 1;
  } else if (pendingRequests > 0) {
    pendingRequests -= 1;
    completedRequests += 1;
  }
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<DataRequestProgress>(DATA_REQUEST_EVENT, { detail: getDataRequestProgress() }),
  );
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
