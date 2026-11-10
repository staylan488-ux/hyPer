import { afterEach, describe, expect, it, vi } from 'vitest';

import { movedTodayOrder, wholeTodayOrder } from '../native/src/lib/todayOrder';

// The order of Today's groups (native/src/lib/todayOrder.ts), as kept on the
// phone: whatever was saved, the page always shows each group once.

describe('Today’s kept order', () => {
  it('is the usual order when nothing is kept', () => {
    expect(wholeTodayOrder(null)).toEqual(['training', 'fuel', 'progress']);
    expect(wholeTodayOrder('fuel')).toEqual(['training', 'fuel', 'progress']);
  });

  it('keeps the person’s order', () => {
    expect(wholeTodayOrder(['progress', 'fuel', 'training'])).toEqual(['progress', 'fuel', 'training']);
  });

  it('drops what it does not know, shows each group once and adds any it lacks', () => {
    expect(wholeTodayOrder(['fuel', 'sleep', 'fuel'])).toEqual(['fuel', 'training', 'progress']);
  });

  it('sets a group down at its new place', () => {
    expect(movedTodayOrder(['training', 'fuel', 'progress'], 'fuel', 0)).toEqual(['fuel', 'training', 'progress']);
    expect(movedTodayOrder(['training', 'fuel', 'progress'], 'training', 2)).toEqual(['fuel', 'progress', 'training']);
    // Past the end is the end.
    expect(movedTodayOrder(['training', 'fuel', 'progress'], 'training', 9)).toEqual(['fuel', 'progress', 'training']);
  });
});

describe('Today’s order on this phone', () => {
  const stored = new Map<string, string>();
  const storage = { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => void stored.set(key, value) };

  afterEach(() => {
    stored.clear();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('shows a move at once and keeps it for the account, across launches', async () => {
    vi.stubGlobal('localStorage', storage);
    const first = await import('../native/src/lib/todayOrder');
    first.moveTodaySection('user-1', 'progress', 0);
    expect(first.todayOrderOf('user-1')).toEqual(['progress', 'training', 'fuel']);
    // Another account on this phone keeps its own.
    expect(first.todayOrderOf('user-2')).toEqual(['training', 'fuel', 'progress']);

    // The next launch reads it back.
    vi.resetModules();
    const next = await import('../native/src/lib/todayOrder');
    expect(next.todayOrderOf('user-1')).toEqual(['progress', 'training', 'fuel']);
  });

  it('is the usual order when what is kept cannot be read', async () => {
    vi.stubGlobal('localStorage', { getItem: () => '{not json', setItem: () => undefined });
    const { todayOrderOf } = await import('../native/src/lib/todayOrder');
    expect(todayOrderOf('user-1')).toEqual(['training', 'fuel', 'progress']);
  });

  it('moves nothing while no one is signed in', async () => {
    vi.stubGlobal('localStorage', storage);
    const { moveTodaySection } = await import('../native/src/lib/todayOrder');
    moveTodaySection(null, 'fuel', 0);
    expect(stored.size).toBe(0);
  });
});
