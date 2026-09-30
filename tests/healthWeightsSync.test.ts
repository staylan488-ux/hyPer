import { beforeEach, describe, expect, it, vi } from 'vitest';

const nativeMock = vi.hoisted(() => ({
  isNativeIOS: vi.fn(() => true),
  readWeightSamples: vi.fn(),
}));

const supabaseMock = vi.hoisted(() => ({
  from: vi.fn(),
  upsert: vi.fn(),
  latest: { measured_at: '2026-01-01T00:00:00.000Z' } as Record<string, unknown> | null,
}));

vi.mock('@/lib/nativeBridge', () => ({
  isNativeIOS: nativeMock.isNativeIOS,
  NativeHealth: { readWeightSamples: nativeMock.readWeightSamples },
}));

vi.mock('@/lib/supabase', () => ({
  supabase: { from: supabaseMock.from },
}));

import { syncNativeBodyWeights } from '@/lib/healthWeights';

const USER = 'user-1';
const CURSOR_KEY = `hyper:health-weight-sync-cursor:${USER}`;
const DAY_MS = 24 * 60 * 60 * 1_000;
const BASE = Date.parse('2024-01-01T00:00:00Z');

type Sample = { id: string; measuredAt: string; kilograms: number; sourceBundle: string; sourceName: string };

/** Native formats measuredAt at seconds precision without milliseconds. */
function nativeIso(ms: number): string {
  return new Date(ms).toISOString().replace('.000Z', 'Z');
}

/** `count` ascending samples, one hour apart, starting at hour `startHour`. */
function page(startHour: number, count: number, prefix = 's'): Sample[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${startHour + index}`,
    measuredAt: nativeIso(BASE + (startHour + index) * 60 * 60 * 1_000),
    kilograms: 80,
    sourceBundle: 'com.scale',
    sourceName: 'Scale',
  }));
}

function newestIso(samples: Sample[]): string {
  return new Date(Math.max(...samples.map((sample) => Date.parse(sample.measuredAt)))).toISOString();
}

let stored: Map<string, string>;

beforeEach(() => {
  stored = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => { stored.set(key, value); },
    removeItem: (key: string) => { stored.delete(key); },
  });
  nativeMock.isNativeIOS.mockReturnValue(true);
  nativeMock.readWeightSamples.mockReset();
  supabaseMock.upsert.mockReset();
  supabaseMock.upsert.mockResolvedValue({ error: null });
  supabaseMock.from.mockReset();
  supabaseMock.from.mockImplementation(() => {
    const chain = {
      upsert: supabaseMock.upsert,
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      order: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      maybeSingle: vi.fn(async () => ({ data: supabaseMock.latest, error: null })),
    };
    return chain;
  });
});

function queuePages(...pages: Sample[][]) {
  for (const samples of pages) nativeMock.readWeightSamples.mockResolvedValueOnce({ samples });
}

describe('Apple Health weight catch-up sync', () => {
  it('reads a large backlog in one sync, continuing from each page\'s newest sample', async () => {
    const first = page(0, 500);
    // The second page repeats the boundary sample, as .strictStartDate does natively.
    const second = [first[499], ...page(500, 499)];
    const third = [second[499], ...page(999, 119)];
    queuePages(first, second, third);

    const result = await syncNativeBodyWeights(USER);

    const calls = nativeMock.readWeightSamples.mock.calls.map(([options]) => options);
    expect(calls).toEqual([
      { since: undefined, limit: 500 },
      { since: newestIso(first), limit: 500 },
      { since: newestIso(second), limit: 500 },
    ]);
    expect(supabaseMock.upsert).toHaveBeenCalledTimes(3);
    expect(supabaseMock.upsert.mock.calls[0][1]).toEqual({ onConflict: 'user_id,source,external_id' });
    expect(stored.get(CURSOR_KEY)).toBe(newestIso(third));
    // 1,118 distinct samples; the two repeated boundary samples are not double-counted.
    expect(result.imported).toBe(1118);
    expect(result.latest).toEqual(supabaseMock.latest);
  });

  it('makes exactly one native call for a short backlog, as before', async () => {
    const only = page(0, 120);
    queuePages(only);

    const result = await syncNativeBodyWeights(USER);

    expect(nativeMock.readWeightSamples).toHaveBeenCalledTimes(1);
    expect(nativeMock.readWeightSamples).toHaveBeenCalledWith({ since: undefined, limit: 500 });
    expect(stored.get(CURSOR_KEY)).toBe(newestIso(only));
    expect(result.imported).toBe(120);
  });

  it('keeps the first page\'s cursor and throws when a later upsert fails', async () => {
    const first = page(0, 500);
    queuePages(first, page(500, 500));
    supabaseMock.upsert
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: { message: 'network down' } });

    await expect(syncNativeBodyWeights(USER)).rejects.toThrow('network down');
    expect(stored.get(CURSOR_KEY)).toBe(newestIso(first));
  });

  it('stops when a full page cannot move past the previous page\'s newest time', async () => {
    const first = page(0, 500);
    const sameSecond = Array.from({ length: 500 }, (_, index) => ({
      ...first[499],
      id: `burst-${index}`,
    }));
    queuePages(first, sameSecond, page(1000, 10));

    await syncNativeBodyWeights(USER);

    expect(nativeMock.readWeightSamples).toHaveBeenCalledTimes(2);
  });

  it('caps one sync at 20 pages and leaves the rest for the next trigger', async () => {
    nativeMock.readWeightSamples.mockImplementation(async () => {
      const pass = nativeMock.readWeightSamples.mock.calls.length - 1;
      return { samples: page(pass * 500, 500) };
    });

    const result = await syncNativeBodyWeights(USER);

    expect(nativeMock.readWeightSamples).toHaveBeenCalledTimes(20);
    expect(result.imported).toBe(10_000);
    expect(stored.get(CURSOR_KEY)).toBe(newestIso(page(19 * 500, 500)));
  });

  it('starts from the stored cursor minus 24 hours', async () => {
    const cursor = '2024-06-01T12:00:00.000Z';
    stored.set(CURSOR_KEY, cursor);
    queuePages(page(0, 3));

    await syncNativeBodyWeights(USER);

    expect(nativeMock.readWeightSamples).toHaveBeenCalledWith({
      since: new Date(Date.parse(cursor) - DAY_MS).toISOString(),
      limit: 500,
    });
  });

  it('never moves the cursor backwards when an overlapping sync already went further', async () => {
    const later = '2030-01-01T00:00:00.000Z';
    stored.set(CURSOR_KEY, later);
    queuePages(page(0, 5));

    await syncNativeBodyWeights(USER);

    expect(stored.get(CURSOR_KEY)).toBe(later);
  });

  it('continues past a full page whose rows were all dropped as implausible', async () => {
    const implausible = page(0, 500).map((sample) => ({ ...sample, kilograms: 0 }));
    queuePages(implausible, page(500, 4));

    const result = await syncNativeBodyWeights(USER);

    expect(nativeMock.readWeightSamples).toHaveBeenCalledTimes(2);
    expect(supabaseMock.upsert).toHaveBeenCalledTimes(1);
    expect(result.imported).toBe(4);
  });

  it('does not read Apple Health off iOS', async () => {
    nativeMock.isNativeIOS.mockReturnValue(false);

    const result = await syncNativeBodyWeights(USER);

    expect(nativeMock.readWeightSamples).not.toHaveBeenCalled();
    expect(result).toEqual({ imported: 0, latest: supabaseMock.latest });
  });
});
