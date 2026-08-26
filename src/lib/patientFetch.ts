/**
 * A POST that outlasts its own timeouts.
 *
 * Agentic food analysis legitimately runs for minutes - web research,
 * cross-checking, vision at high effort - and one long-lived HTTP request is
 * the wrong vehicle for that on a phone: iOS kills sockets when the app
 * backgrounds, proxies drop quiet connections, and a single abort used to
 * throw the whole analysis away seconds before it finished.
 *
 * So instead of one fragile request, this makes a series of short attempts.
 * The worker deduplicates by idempotency key (a hash of the body), so every
 * retry RE-ATTACHES to the job the first attempt started - nothing restarts,
 * no work is duplicated - and once the job finishes, the next attempt returns
 * instantly from the worker's result cache. The analysis fails only if the
 * worker itself gives up, not because a socket blinked.
 */

/** Errors that mean "try again", as opposed to a real answer from the worker. */
function isTransient(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  // fetch() network failures surface as TypeError with browser-specific text
  if (error instanceof TypeError) return true;
  return false;
}

export async function patientPost(input: {
  url: string;
  body: string;
  headers: Record<string, string>;
  /** Ceiling per attempt; short enough that a dead socket wastes little. */
  attemptTimeoutMs?: number;
  /** Total patience across attempts. The worker's own ceiling is 8 minutes. */
  totalBudgetMs?: number;
  retryDelayMs?: number;
}): Promise<Response> {
  const attemptTimeoutMs = input.attemptTimeoutMs ?? 120_000;
  const totalBudgetMs = input.totalBudgetMs ?? 15 * 60_000;
  const retryDelayMs = input.retryDelayMs ?? 2_000;

  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt < totalBudgetMs) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), attemptTimeoutMs);
    try {
      return await fetch(input.url, {
        method: 'POST',
        headers: input.headers,
        body: input.body,
        signal: controller.signal,
      });
    } catch (error) {
      if (!isTransient(error)) throw error;
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('The request did not complete in time.');
}
