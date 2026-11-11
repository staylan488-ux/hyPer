// First-use hints: one quiet line under a thing the first times someone
// meets it, saying what it does that sight alone doesn't (a hold, a swipe,
// what a mark means). A hint leaves for good once its gesture is used or its
// point is made; one that is in view when its screen opens also retires
// after a few days of being ignored.
// Kept on this phone, per account, as Today's order is: it is how this
// person has learned the app here, not part of the account's data.
import { createContext, useContext, useEffect } from 'react';
import { create } from 'zustand';

/** Every hint, by the place it lives. */
export const HINTS = ['today-order', 'fuel-rows', 'train-rows', 'muscles', 'weigh-in'] as const;
export type HintKey = (typeof HINTS)[number];

/** A hint seen on this many days without being acted on retires. */
export const HINT_DAYS = 5;

/**
 * The hints that retire after HINT_DAYS: those in view when their screen
 * opens. Fuel's and Train's sit under their lists, often below the fold, so
 * a day on the screen is no sign they were read: they stay until acted on.
 */
const RETIRING: HintKey[] = ['today-order', 'muscles', 'weigh-in'];

/**
 * Accounts made before hints existed already know the app: they start with
 * every hint done. You › About › Show tips again brings them back.
 */
export const HINTS_SINCE = '2026-11-12T00:00:00Z';

export type HintMemory = {
  /** Hints acted on (or retired by hand): never shown again. */
  done: HintKey[];
  /** For each hint, the days (yyyy-MM-dd) it was on screen. */
  seen: Partial<Record<HintKey, string[]>>;
};

const isHint = (key: unknown): key is HintKey => HINTS.includes(key as HintKey);

/** A fresh account's memory: nothing done, nothing seen. */
export const freshHints = (): HintMemory => ({ done: [], seen: {} });

/** An older account's memory: every hint done. */
export const knownHints = (): HintMemory => ({ done: [...HINTS], seen: {} });

/**
 * What this phone kept, made whole: only known hints, each once, and only
 * well-formed days. With nothing kept, an account made before hints existed
 * starts with every hint done.
 */
export function wholeHints(kept: unknown, accountCreatedAt: string | null | undefined): HintMemory {
  if (!kept || typeof kept !== 'object') {
    const created = accountCreatedAt ? Date.parse(accountCreatedAt) : Number.NaN;
    return Number.isFinite(created) && created < Date.parse(HINTS_SINCE) ? knownHints() : freshHints();
  }
  const raw = kept as { done?: unknown; seen?: unknown };
  const done = Array.isArray(raw.done) ? raw.done.filter(isHint) : [];
  const seen: HintMemory['seen'] = {};
  if (raw.seen && typeof raw.seen === 'object') {
    for (const [key, days] of Object.entries(raw.seen as Record<string, unknown>)) {
      if (!isHint(key) || !Array.isArray(days)) continue;
      const valid = days.filter((day): day is string => typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day));
      seen[key] = [...new Set(valid)];
    }
  }
  return { done: [...new Set(done)], seen };
}

/** Whether a hint shows today: not done, and (for one that retires) not yet ignored on HINT_DAYS other days. */
export function hintShows(memory: HintMemory, key: HintKey, day: string): boolean {
  if (memory.done.includes(key)) return false;
  if (!RETIRING.includes(key)) return true;
  const days = memory.seen[key] ?? [];
  return days.includes(day) || days.length < HINT_DAYS;
}

/** The memory with a hint on screen today (unchanged when today is already counted). */
export function sawHint(memory: HintMemory, key: HintKey, day: string): HintMemory {
  const days = memory.seen[key] ?? [];
  if (days.includes(day)) return memory;
  return { ...memory, seen: { ...memory.seen, [key]: [...days, day] } };
}

/** The memory with a hint acted on (unchanged when it already was). */
export function didHint(memory: HintMemory, key: HintKey): HintMemory {
  if (memory.done.includes(key)) return memory;
  return { ...memory, done: [...memory.done, key] };
}

// ── This phone's copy ──

const hintsKey = (userId: string) => `hyper:hints:${userId}`;

type Account = { id: string; createdAt: string | null };

/** What this phone keeps for an account, read once a launch. */
const kept = new Map<string, HintMemory>();
function keptHints(account: Account): HintMemory {
  let memory = kept.get(account.id);
  if (!memory) {
    let saved: unknown = null;
    try {
      const text = globalThis.localStorage?.getItem(hintsKey(account.id));
      saved = text ? JSON.parse(text) : null;
    } catch {
      saved = null;
    }
    memory = wholeHints(saved, account.createdAt);
    kept.set(account.id, memory);
  }
  return memory;
}

/** The signed-in account, and each account's memory as changed this launch. */
const useMemories = create<{ account: Account | null; memories: Record<string, HintMemory> }>(() => ({ account: null, memories: {} }));

function read(account: Account): HintMemory {
  return useMemories.getState().memories[account.id] ?? keptHints(account);
}

function write(userId: string, memory: HintMemory) {
  useMemories.setState((state) => ({ memories: { ...state.memories, [userId]: memory } }));
  try {
    globalThis.localStorage?.setItem(hintsKey(userId), JSON.stringify(memory));
  } catch {
    // holds until the app closes
  }
}

/** The signed-in account, whose hints show (set from the root layout). */
export function setHintAccount(account: Account | null) {
  const current = useMemories.getState().account;
  if (current?.id === account?.id && current?.createdAt === account?.createdAt) return;
  useMemories.setState({ account });
}

/** A hint was acted on: it folds away wherever it shows and never comes back. */
export function markHintDone(key: HintKey) {
  const account = useMemories.getState().account;
  if (!account) return;
  const memory = read(account);
  const next = didHint(memory, key);
  if (next !== memory) write(account.id, next);
}

/** You › About: every hint shows again, as for a new account. */
export function resetHints() {
  const account = useMemories.getState().account;
  if (!account) return;
  write(account.id, freshHints());
}

/**
 * Whether a hint shows on this screen now. `ready` is the place's own
 * condition (there are foods to swipe, a workout to reorder). Counts the
 * day it is first on screen, so it retires after HINT_DAYS ignored days.
 */
export function useHint(key: HintKey, ready: boolean, day: string): boolean {
  const account = useMemories((state) => state.account);
  const changed = useMemories((state) => (state.account ? state.memories[state.account.id] : undefined));
  const memory = account ? (changed ?? keptHints(account)) : null;
  const shows = Boolean(memory && ready && hintShows(memory, key, day));
  useEffect(() => {
    if (!shows || !account) return;
    const current = read(account);
    const next = sawHint(current, key, day);
    if (next !== current) write(account.id, next);
  }, [shows, account, key, day]);
  return shows;
}

/**
 * The hint a block of rows teaches: a swipe or a hold on any row inside marks
 * it done (SwipeRow and HoldMenu read this).
 */
export const HintScope = createContext<HintKey | null>(null);
export const useHintScope = () => useContext(HintScope);
