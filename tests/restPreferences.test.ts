import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// Mock supabase before importing the lib (it imports supabase).
const supabaseMock = vi.hoisted(() => {
  const okSelect = () => ({
    eq: vi.fn(() => Promise.resolve({ data: [], error: null })),
  });
  return {
    from: vi.fn(() => ({
      upsert: vi.fn(() => Promise.resolve({ error: null })),
      select: vi.fn(okSelect),
    })),
    auth: { getUser: vi.fn() },
  };
});

vi.mock('@/lib/supabase', () => ({ supabase: supabaseMock }));

import {
  DEFAULT_REST_SECONDS,
  getLastUsedRestSeconds,
  loadRestPreferences,
  loadRestPreferencesAsync,
  resolveRestSeconds,
  saveRestPreference,
  type RestPreferences,
} from '../src/lib/restPreferences';

// Mock localStorage on globalThis.
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
  };
})();

Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  writable: true,
});

describe('restPreferences', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('resolveRestSeconds', () => {
    it('uses the saved preference for a known movement', () => {
      const prefs: RestPreferences = {
        'ex-pullups': { restSeconds: 240, updatedAt: '2026-06-17T10:00:00.000Z' },
      };
      expect(resolveRestSeconds(prefs, 'ex-pullups')).toBe(240);
    });

    it('falls back to the last-used duration for an unknown movement', () => {
      const prefs: RestPreferences = {
        'ex-pullups': { restSeconds: 240, updatedAt: '2026-06-17T10:00:00.000Z' },
        'ex-rows': { restSeconds: 120, updatedAt: '2026-06-17T11:00:00.000Z' },
      };
      // ex-rows is newest -> last used is 120
      expect(resolveRestSeconds(prefs, 'ex-curls')).toBe(120);
    });

    it('falls back to the default when there are no preferences', () => {
      expect(resolveRestSeconds({}, 'ex-anything')).toBe(DEFAULT_REST_SECONDS);
    });

    it('honours an explicit fallback argument', () => {
      expect(resolveRestSeconds({}, 'ex-anything', 60)).toBe(60);
    });
  });

  describe('getLastUsedRestSeconds', () => {
    it('returns the rest_seconds of the entry with the newest updatedAt', () => {
      const prefs: RestPreferences = {
        a: { restSeconds: 90, updatedAt: '2026-06-17T10:00:00.000Z' },
        b: { restSeconds: 300, updatedAt: '2026-06-17T12:00:00.000Z' },
        c: { restSeconds: 150, updatedAt: '2026-06-17T11:00:00.000Z' },
      };
      expect(getLastUsedRestSeconds(prefs)).toBe(300);
    });

    it('returns null for an empty map', () => {
      expect(getLastUsedRestSeconds({})).toBeNull();
    });
  });

  describe('saveRestPreference + loadRestPreferences (cache round-trip)', () => {
    it('writes a preference to the cache and reads it back', () => {
      saveRestPreference('user1', 'ex-pullups', 240);
      const prefs = loadRestPreferences('user1');
      expect(prefs['ex-pullups']?.restSeconds).toBe(240);
      expect(typeof prefs['ex-pullups']?.updatedAt).toBe('string');
    });

    it('clamps out-of-range durations', () => {
      saveRestPreference('user1', 'ex-a', 1);      // below min
      saveRestPreference('user1', 'ex-b', 99999);  // above max
      const prefs = loadRestPreferences('user1');
      expect(prefs['ex-a']?.restSeconds).toBe(5);
      expect(prefs['ex-b']?.restSeconds).toBe(3600);
    });

    it('isolates preferences per user', () => {
      saveRestPreference('user1', 'ex-a', 120);
      expect(loadRestPreferences('user2')).toEqual({});
    });

    it('returns an empty map for malformed cache JSON', () => {
      localStorageMock.setItem('hyper:rest-preferences:user1', 'not json');
      expect(loadRestPreferences('user1')).toEqual({});
    });
  });

  describe('loadRestPreferencesAsync', () => {
    it('maps DB rows into the cache', async () => {
      supabaseMock.from.mockReturnValueOnce({
        upsert: vi.fn(() => Promise.resolve({ error: null })),
        select: vi.fn(() => ({
          eq: vi.fn(() => Promise.resolve({
            data: [
              { exercise_id: 'ex-pullups', rest_seconds: 240, updated_at: '2026-06-17T10:00:00.000Z' },
            ],
            error: null,
          })),
        })),
      });

      const prefs = await loadRestPreferencesAsync('user1');
      expect(prefs['ex-pullups']?.restSeconds).toBe(240);
      // cache is populated too
      expect(loadRestPreferences('user1')['ex-pullups']?.restSeconds).toBe(240);
    });

    it('keeps the newer of local vs remote per movement', async () => {
      // Local has a NEWER value for ex-a; remote is older.
      saveRestPreference('user1', 'ex-a', 200); // stamped "now" (newest)
      supabaseMock.from.mockReturnValueOnce({
        upsert: vi.fn(() => Promise.resolve({ error: null })),
        select: vi.fn(() => ({
          eq: vi.fn(() => Promise.resolve({
            data: [
              { exercise_id: 'ex-a', rest_seconds: 999, updated_at: '2000-01-01T00:00:00.000Z' },
              { exercise_id: 'ex-b', rest_seconds: 120, updated_at: '2026-06-17T09:00:00.000Z' },
            ],
            error: null,
          })),
        })),
      });

      const prefs = await loadRestPreferencesAsync('user1');
      expect(prefs['ex-a']?.restSeconds).toBe(200); // local newer wins
      expect(prefs['ex-b']?.restSeconds).toBe(120); // remote-only added
    });

    it('falls back to cache when the DB errors', async () => {
      saveRestPreference('user1', 'ex-a', 150);
      supabaseMock.from.mockReturnValueOnce({
        upsert: vi.fn(() => Promise.resolve({ error: null })),
        select: vi.fn(() => ({
          eq: vi.fn(() => Promise.resolve({ data: null, error: { message: 'boom' } })),
        })),
      });

      const prefs = await loadRestPreferencesAsync('user1');
      expect(prefs['ex-a']?.restSeconds).toBe(150);
    });
  });
});
