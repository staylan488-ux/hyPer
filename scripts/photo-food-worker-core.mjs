export class WorkerBusyError extends Error {
  constructor(message = 'The photo worker is busy. Try again shortly.') {
    super(message);
    this.name = 'WorkerBusyError';
  }
}

export function parseCSVSet(value = '') {
  return new Set(String(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean));
}

export function userIsAllowed(userId, allowedUserIds, requireAllowlist) {
  if (!userId) return false;
  if (allowedUserIds.size === 0) return !requireAllowlist;
  return allowedUserIds.has(userId);
}

export function normalizeIdempotencyKey(value) {
  if (typeof value !== 'string') return null;
  const key = value.trim();
  return /^[a-zA-Z0-9._:-]{8,160}$/.test(key) ? key : null;
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.floor(parsed)));
}

export function createJobGate({ maxConcurrent = 1, maxQueued = 4 } = {}) {
  const concurrency = boundedInteger(maxConcurrent, 1, 1, 8);
  const queueLimit = boundedInteger(maxQueued, 4, 0, 100);
  let active = 0;
  const queue = [];

  const grant = (resolve) => {
    active += 1;
    let released = false;
    resolve(() => {
      if (released) return;
      released = true;
      active = Math.max(0, active - 1);
      const next = queue.shift();
      if (next) grant(next.resolve);
    });
  };

  return {
    acquire() {
      if (active < concurrency) {
        return new Promise((resolve) => grant(resolve));
      }
      if (queue.length >= queueLimit) {
        return Promise.reject(new WorkerBusyError());
      }
      return new Promise((resolve, reject) => queue.push({ resolve, reject }));
    },
    stats() {
      return { active, queued: queue.length, maxConcurrent: concurrency, maxQueued: queueLimit };
    },
    close() {
      const error = new WorkerBusyError('The photo worker is shutting down.');
      for (const item of queue.splice(0, queue.length)) item.reject(error);
    },
  };
}

export function createTTLCache({ ttlMs = 15 * 60_000, maxEntries = 100 } = {}) {
  const entries = new Map();
  const normalizedTTL = boundedInteger(ttlMs, 15 * 60_000, 1_000, 24 * 60 * 60_000);
  const normalizedMax = boundedInteger(maxEntries, 100, 1, 10_000);

  const prune = (now) => {
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= now) entries.delete(key);
    }
    while (entries.size > normalizedMax) {
      entries.delete(entries.keys().next().value);
    }
  };

  return {
    get(key, now = Date.now()) {
      prune(now);
      return entries.get(key)?.value;
    },
    set(key, value, now = Date.now()) {
      entries.delete(key);
      entries.set(key, { value, expiresAt: now + normalizedTTL });
      prune(now);
    },
    size() {
      prune(Date.now());
      return entries.size;
    },
  };
}

/**
 * Whether a failure means the provider's CREDENTIAL is broken, as opposed to
 * the call merely being unlucky.
 *
 * The distinction matters because a broken credential is worth remembering - it
 * will fail again immediately - while a timeout or a busy upstream is not. Set
 * aside for the wrong reason and a healthy provider goes dark; ignore a broken
 * one and every request pays for a doomed attempt before falling back.
 */
export function isCredentialFailure(error) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /could not be refreshed|log ?out and sign in again|\b401\b|unauthorized|invalid[_ ]api[_ ]key|authentication/i
    .test(message);
}

/**
 * Remembers providers whose credential just failed, so they stop being offered
 * for a while.
 *
 * Validity cannot be checked cheaply: `codex login status` reports success from
 * an expired token (verified - an expired credential and a fresh one print the
 * same thing), and the only honest test is a real call, which is far too
 * expensive for a health poll. So failure is learned rather than predicted.
 */
export function createProviderHealth({ deadMs = 15 * 60_000, now = () => Date.now() } = {}) {
  const deadUntil = new Map();
  return {
    isDead(provider) {
      const until = deadUntil.get(provider);
      if (until == null) return false;
      if (until > now()) return true;
      deadUntil.delete(provider);   // recovered on its own; offer it again
      return false;
    },
    markDead(provider) {
      deadUntil.set(provider, now() + deadMs);
    },
    /** Only for tests and diagnostics. */
    deadProviders() {
      return [...deadUntil.keys()].filter((provider) => this.isDead(provider));
    },
  };
}
