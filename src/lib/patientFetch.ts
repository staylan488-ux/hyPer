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
  if (isAbort(error)) return true;
  // fetch() network failures surface as TypeError with browser-specific text
  if (error instanceof TypeError) return true;
  return false;
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/**
 * The worker could not be reached at all - refused, unresolvable, offline - as
 * opposed to reached and then cut off mid-job. The worker runs on the user's
 * own Mac, so being off is routine; saying so in seconds beats a 15-minute
 * spinner that ends in "Load failed".
 */
export class WorkerUnreachableError extends Error {
  constructor(message = "Can't reach the food-analysis worker. Make sure it's running and check the URL in Settings.") {
    super(message);
    this.name = 'WorkerUnreachableError';
  }
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
  /** An attempt open at least this long counts as having reached the worker. */
  reachedAfterMs?: number;
  /** Consecutive fast network failures, before any contact, that mean "unreachable"... */
  unreachableAfterAttempts?: number;
  /** ...but only once this long has passed, so a Wi-Fi handoff can recover. */
  unreachableAfterMs?: number;
}): Promise<Response> {
  const attemptTimeoutMs = input.attemptTimeoutMs ?? 120_000;
  const totalBudgetMs = input.totalBudgetMs ?? 15 * 60_000;
  const retryDelayMs = input.retryDelayMs ?? 2_000;
  const reachedAfterMs = input.reachedAfterMs ?? 3_000;
  const unreachableAfterAttempts = input.unreachableAfterAttempts ?? 5;
  const unreachableAfterMs = input.unreachableAfterMs ?? 15_000;

  const startedAt = Date.now();
  let lastError: unknown;
  // Once the worker has plausibly seen the request, a failure is a dropped
  // socket around a running job - keep re-attaching for the whole budget. Wall
  // clock on purpose: time suspended in the background counts, so a request
  // that was open when the user switched apps is still treated as reached.
  let reached = false;
  let fastNetworkFailures = 0;

  while (Date.now() - startedAt < totalBudgetMs) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), attemptTimeoutMs);
    const attemptStartedAt = Date.now();
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
      if (Date.now() - attemptStartedAt >= reachedAfterMs) reached = true;
      // Timeouts never trigger the fast exit: a hang looks the same as a
      // long-running job, so it keeps the patient behaviour.
      fastNetworkFailures = !reached && error instanceof TypeError ? fastNetworkFailures + 1 : 0;
      if (fastNetworkFailures >= unreachableAfterAttempts && Date.now() - startedAt >= unreachableAfterMs) {
        throw new WorkerUnreachableError();
      }
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    } finally {
      clearTimeout(timeout);
    }
  }
  // Timeouts pass through so callers keep their "kept running past every
  // retry" wording; a raw network error ("Load failed") says nothing useful.
  if (isAbort(lastError)) throw lastError;
  throw new Error(lastError instanceof TypeError
    ? 'Lost the connection to the food-analysis worker and could not get it back. Make sure it is running and check Settings.'
    : 'The request did not complete in time.');
}
