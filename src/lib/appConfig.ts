import { withTimeout } from '@/lib/withTimeout';

/**
 * The server's public switches (`app_public_config()`, readable signed in or
 * out): whether sign-up is open, whether food analysis is on, and the oldest
 * app version allowed. See docs/sign-up-and-limits.md.
 *
 * Anything unclear (offline, slow, an error, a server without the function)
 * reads as null, and null changes nothing: the app never blocks or hides a
 * feature on a guess.
 */
export interface PublicConfig {
  signupMode: 'open' | 'invite_only';
  aiEnabled: boolean;
  /** "2.0.4", or null when every version is allowed. */
  minAppVersion: string | null;
}

interface ConfigAnswer {
  data: unknown;
  error: { code?: string; message?: string } | null;
}

const CHECK_TIMEOUT_MS = 15_000;
const VERSION = /^\d+(\.\d+){0,2}$/;

export function parsePublicConfig(data: unknown): PublicConfig | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const answer = data as { signup_mode?: unknown; ai_enabled?: unknown; min_app_version?: unknown };
  if (answer.signup_mode !== 'open' && answer.signup_mode !== 'invite_only') return null;
  if (typeof answer.ai_enabled !== 'boolean') return null;
  const min = answer.min_app_version;
  if (min !== null && min !== undefined && (typeof min !== 'string' || !VERSION.test(min))) return null;
  return { signupMode: answer.signup_mode, aiEnabled: answer.ai_enabled, minAppVersion: typeof min === 'string' ? min : null };
}

/** Asks the server. `ask` calls the function, e.g. `() => supabase.rpc('app_public_config')`. */
export async function fetchPublicConfig(ask: () => PromiseLike<ConfigAnswer>): Promise<PublicConfig | null> {
  try {
    const { data, error } = await withTimeout(Promise.resolve(ask()), CHECK_TIMEOUT_MS, 'Config check timed out');
    if (error) return null;
    return parsePublicConfig(data);
  } catch {
    return null;
  }
}

function parts(version: string): number[] {
  return version.split('.').map((part) => Number(part));
}

/**
 * Whether this build is older than the oldest version the server allows.
 * A version that can't be read is never "older": a bad value on either side
 * must not lock anyone out.
 */
export function isOlderThan(current: string | null | undefined, minimum: string | null | undefined): boolean {
  if (!current || !minimum || !VERSION.test(current) || !VERSION.test(minimum)) return false;
  const a = parts(current);
  const b = parts(minimum);
  for (let index = 0; index < 3; index++) {
    const left = a[index] ?? 0;
    const right = b[index] ?? 0;
    if (left !== right) return left < right;
  }
  return false;
}
