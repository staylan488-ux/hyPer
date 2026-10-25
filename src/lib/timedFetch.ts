// Default deadline for Supabase database and auth requests. Without one a
// half-dead connection can leave a load or save waiting for minutes; with it
// the request fails like any other network error ({ error, status: 0 } from
// the query builder) and the existing error paths take over.
export const REQUEST_TIMEOUT_MS = 30_000;
// A token refresh blocks every database request. Leave time for the SDK's
// own retry (200 ms initially) within the 8 s set-save attempt. This bounds
// each transport attempt, not the SDK's full refresh/retry cycle.
export const REFRESH_REQUEST_TIMEOUT_MS = 5_000;
// save_split_snapshot writes a whole program in one call.
export const LONG_REQUEST_TIMEOUT_MS = 120_000;

const LONG_RPC_PATHS = new Set(['/rest/v1/rpc/save_split_snapshot']);

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/**
 * The deadline for a Supabase request, chosen by URL path, or null for none.
 * Edge functions (WHOOP connect/sync, food lookup) and anything outside the
 * database and auth APIs keep running until the platform gives up.
 */
export function requestTimeoutMs(input: RequestInfo | URL): number | null {
  let url: URL;
  try {
    url = new URL(requestUrl(input));
  } catch {
    return null;
  }
  const { pathname } = url;
  if (pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
    return REFRESH_REQUEST_TIMEOUT_MS;
  }
  if (LONG_RPC_PATHS.has(pathname)) return LONG_REQUEST_TIMEOUT_MS;
  if (pathname.startsWith('/rest/v1/') || pathname.startsWith('/auth/v1/')) return REQUEST_TIMEOUT_MS;
  return null;
}

/**
 * fetch with a per-request deadline, for the Supabase client's global.fetch.
 * A caller's own signal (the 8 s set-save abort, for example) still aborts
 * first. Built on a plain AbortController because AbortSignal.any and
 * AbortSignal.timeout need newer iOS than the app supports.
 */
export const timedFetch: typeof fetch = async (input, init) => {
  const timeoutMs = requestTimeoutMs(input);
  if (timeoutMs === null) return fetch(input, init);

  const callerSignal = init?.signal
    ?? (typeof Request !== 'undefined' && input instanceof Request ? input.signal : undefined);
  // The SDK may reach fetch only after a long session lookup. Do not send a
  // write whose save attempt was already cancelled while it waited there.
  if (callerSignal?.aborted) throw callerSignal.reason ?? new DOMException('Request aborted', 'AbortError');

  const controller = new AbortController();
  let rejectAborted!: (reason: unknown) => void;
  const aborted = new Promise<never>((_, reject) => { rejectAborted = reject; });
  const abort = (reason: unknown) => {
    // Reject independently: a suspended WebView transport or response stream
    // may never acknowledge abort. Only aborting it leaves auth-js's shared
    // refresh promise pending, so stop/startAutoRefresh cannot recover it.
    rejectAborted(reason);
    controller.abort(reason);
  };
  const forwardAbort = () => abort(callerSignal?.reason ?? new DOMException('Request aborted', 'AbortError'));
  callerSignal?.addEventListener('abort', forwardAbort);

  // An AbortError (not a TimeoutError), so the query builder neither retries
  // the request nor treats it differently from any other aborted request.
  const timer = setTimeout(() => {
    abort(new DOMException(`Request timed out after ${timeoutMs / 1000} s`, 'AbortError'));
  }, timeoutMs);

  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(input, { ...init, signal: controller.signal });
        // fetch resolves at headers. Include the entire body in the hard
        // deadline too. A late response stays in this losing branch and can
        // never reach auth-js to overwrite a newer session.
        if (response.body) await response.clone().arrayBuffer();
        return response;
      })(),
      aborted,
    ]);
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', forwardAbort);
  }
};
