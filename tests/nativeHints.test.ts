import { afterEach, describe, expect, it, vi } from 'vitest';

import { didHint, HINT_DAYS, HINTS, hintShows, sawHint, wholeHints } from '../native/src/lib/hints';

// First-use hints (native/src/lib/hints.ts): what this phone remembers about
// which hints someone has acted on or ignored, per account.

const NEW_ACCOUNT = '2026-12-01T09:00:00Z';
const OLD_ACCOUNT = '2025-03-01T09:00:00Z';

describe('First-use hints', () => {
  it('start fresh for a new account, and done for one made before hints existed', () => {
    expect(wholeHints(null, NEW_ACCOUNT)).toEqual({ done: [], seen: {} });
    expect(wholeHints(null, OLD_ACCOUNT).done).toEqual([...HINTS]);
    // No date (the sample account) counts as new.
    expect(wholeHints(null, null)).toEqual({ done: [], seen: {} });
  });

  it('keep what this phone saved over the account’s age, so Show tips again works for anyone', () => {
    expect(wholeHints({ done: [], seen: {} }, OLD_ACCOUNT)).toEqual({ done: [], seen: {} });
  });

  it('drop what they do not know and keep each day once', () => {
    const kept = { done: ['muscles', 'sleep', 'muscles'], seen: { 'fuel-rows': ['2026-12-01', '2026-12-01', 'later', 4], nap: ['2026-12-01'] } };
    expect(wholeHints(kept, NEW_ACCOUNT)).toEqual({ done: ['muscles'], seen: { 'fuel-rows': ['2026-12-01'] } });
  });

  it('show until acted on', () => {
    const memory = didHint(wholeHints(null, NEW_ACCOUNT), 'fuel-rows');
    expect(hintShows(memory, 'fuel-rows', '2026-12-01')).toBe(false);
    expect(hintShows(memory, 'muscles', '2026-12-01')).toBe(true);
    expect(didHint(memory, 'fuel-rows')).toBe(memory);
  });

  it('retire after being ignored on a few days, but stay for the rest of the last one', () => {
    let memory = wholeHints(null, NEW_ACCOUNT);
    const days = Array.from({ length: HINT_DAYS }, (_, index) => `2026-12-0${index + 1}`);
    for (const day of days) {
      expect(hintShows(memory, 'today-order', day)).toBe(true);
      memory = sawHint(memory, 'today-order', day);
    }
    expect(hintShows(memory, 'today-order', days[HINT_DAYS - 1])).toBe(true);
    expect(hintShows(memory, 'today-order', '2026-12-09')).toBe(false);
    // Seeing it again the same day counts once.
    expect(sawHint(memory, 'today-order', days[0])).toBe(memory);
  });
});

describe('First-use hints on this phone', () => {
  const stored = new Map<string, string>();
  const storage = { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => void stored.set(key, value) };

  afterEach(() => {
    stored.clear();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('keeps a hint acted on for the account, across launches, until tips are shown again', async () => {
    vi.stubGlobal('localStorage', storage);
    const first = await import('../native/src/lib/hints');
    first.setHintAccount({ id: 'u1', createdAt: NEW_ACCOUNT });
    first.markHintDone('fuel-rows');
    expect(JSON.parse(stored.get('hyper:hints:u1') ?? '{}').done).toEqual(['fuel-rows']);

    vi.resetModules();
    const later = await import('../native/src/lib/hints');
    later.setHintAccount({ id: 'u1', createdAt: NEW_ACCOUNT });
    later.markHintDone('muscles');
    expect(JSON.parse(stored.get('hyper:hints:u1') ?? '{}').done).toEqual(['fuel-rows', 'muscles']);

    later.resetHints();
    expect(JSON.parse(stored.get('hyper:hints:u1') ?? '{}')).toEqual({ done: [], seen: {} });
  });

  it('does nothing while no one is signed in', async () => {
    vi.stubGlobal('localStorage', storage);
    const hints = await import('../native/src/lib/hints');
    hints.markHintDone('fuel-rows');
    hints.resetHints();
    expect(stored.size).toBe(0);
  });
});
