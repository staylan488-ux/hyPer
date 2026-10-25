// A small on-device trail of auth timing events, for diagnosing stalls like a
// set save stuck behind a token refresh after iOS resumes the app. It stays on
// the device: memory plus a capped localStorage copy, never sent anywhere.
// Entries carry event names, outcomes and durations only — never tokens,
// emails, user ids or server messages.
export const AUTH_DIAGNOSTICS_STORAGE_KEY = 'hyper:auth-diagnostics';
export const AUTH_DIAGNOSTICS_LIMIT = 50;

export type AuthDiagnosticEvent =
  | 'refresh:start'
  | 'refresh:end'
  | 'resume'
  | 'resume:end'
  | 'pause'
  | 'recovery:end'
  | 'keychain:timeout'
  | 'keychain:error'
  | 'set-save:timeout';

export interface AuthDiagnostic {
  at: string;
  event: AuthDiagnosticEvent;
  outcome?: string;
  durationMs?: number;
  detail?: string;
}

let entries: AuthDiagnostic[] | null = null;

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage ?? null;
  } catch {
    return null;
  }
}

function load(): AuthDiagnostic[] {
  if (entries) return entries;
  entries = [];
  try {
    const parsed: unknown = JSON.parse(storage()?.getItem(AUTH_DIAGNOSTICS_STORAGE_KEY) ?? '[]');
    if (Array.isArray(parsed)) entries = parsed.slice(-AUTH_DIAGNOSTICS_LIMIT) as AuthDiagnostic[];
  } catch {
    // A corrupt copy starts a fresh trail.
  }
  return entries;
}

export function recordAuthDiagnostic(
  event: AuthDiagnosticEvent,
  fields: Omit<AuthDiagnostic, 'at' | 'event'> = {},
): void {
  try {
    const entry: AuthDiagnostic = { at: new Date().toISOString(), event, ...fields };
    const list = load();
    list.push(entry);
    if (list.length > AUTH_DIAGNOSTICS_LIMIT) list.splice(0, list.length - AUTH_DIAGNOSTICS_LIMIT);
    try {
      storage()?.setItem(AUTH_DIAGNOSTICS_STORAGE_KEY, JSON.stringify(list));
    } catch {
      // Memory still holds the trail when storage is full or unavailable.
    }
    if (import.meta.env.DEV && import.meta.env.MODE !== 'test') console.info('[auth]', event, fields);
  } catch {
    // Diagnostics must never affect the app.
  }
}

export function readAuthDiagnostics(): AuthDiagnostic[] {
  return [...load()];
}

export function clearAuthDiagnostics(): void {
  entries = [];
  try {
    storage()?.removeItem(AUTH_DIAGNOSTICS_STORAGE_KEY);
  } catch {
    // ignore
  }
}

// A short, PII-free label for a failure: the error's class name or status.
export function describeAuthError(error: unknown): string {
  if (error && typeof error === 'object') {
    const { name, status } = error as { name?: unknown; status?: unknown };
    if (typeof status === 'number') return `${typeof name === 'string' ? name : 'Error'}:${status}`;
    if (typeof name === 'string') return name;
  }
  return 'unknown';
}

function isRefreshRequest(input: RequestInfo | URL): boolean {
  try {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    return url.pathname.endsWith('/auth/v1/token') && url.searchParams.get('grant_type') === 'refresh_token';
  } catch {
    return false;
  }
}

// Wraps the Supabase client's fetch to time every token refresh, including the
// SDK's own background ticks, without touching request or response.
export function withRefreshDiagnostics(fetchImpl: typeof fetch): typeof fetch {
  return async (input, init) => {
    if (!isRefreshRequest(input)) return fetchImpl(input, init);
    const startedAt = Date.now();
    recordAuthDiagnostic('refresh:start');
    try {
      const response = await fetchImpl(input, init);
      recordAuthDiagnostic('refresh:end', {
        outcome: response.ok ? 'ok' : `http:${response.status}`,
        durationMs: Date.now() - startedAt,
      });
      return response;
    } catch (error) {
      recordAuthDiagnostic('refresh:end', { outcome: describeAuthError(error), durationMs: Date.now() - startedAt });
      throw error;
    }
  };
}
