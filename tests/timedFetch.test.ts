import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const backend = vi.hoisted(() => {
  const user = {
    id: 'timed-fetch-user', aud: 'authenticated', role: 'authenticated',
    app_metadata: {}, user_metadata: {}, created_at: '2026-09-30T00:00:00Z',
  };
  const session = {
    access_token: 'test-only-access-token', refresh_token: 'test-only-refresh-token',
    token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user,
  };
  return { user, session };
});

// The real client, wired the way src/lib/supabase.ts wires it, over a stubbed
// global fetch.
vi.mock('@/lib/supabase', async () => {
  const { createClient } = await import('@supabase/supabase-js');
  const { timedFetch } = await import('@/lib/timedFetch');
  const key = 'timed-fetch-test';
  const storage = new Map([[key, JSON.stringify(backend.session)]]);
  return {
    supabase: createClient('https://timed-fetch.test', 'test-only-public-key', {
      auth: {
        persistSession: true, autoRefreshToken: false, detectSessionInUrl: false, storageKey: key,
        storage: {
          getItem: async (name: string) => storage.get(name) ?? null,
          setItem: async (name: string, value: string) => { storage.set(name, value); },
          removeItem: async (name: string) => { storage.delete(name); },
        },
      },
      global: { fetch: timedFetch },
    }),
  };
});

import { supabase } from '@/lib/supabase';
import { createPendingEntryId, entryWriteId } from '@/lib/pendingEntryId';
import { persistNutritionEntry } from '@/lib/saveNutritionEntry';
import {
  LONG_REQUEST_TIMEOUT_MS, REQUEST_TIMEOUT_MS, requestTimeoutMs, timedFetch,
} from '@/lib/timedFetch';

const BASE = 'https://timed-fetch.test';

// A request that never answers until its signal aborts, like a dead socket.
function stalledFetch() {
  return vi.fn<typeof fetch>((_input, init) => new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    if (signal?.aborted) return reject(signal.reason);
    signal?.addEventListener('abort', () => reject(signal.reason));
  }));
}

function settled<T>(promise: Promise<T>) {
  const state = { done: false, value: undefined as T | undefined, error: undefined as unknown };
  promise.then(
    (value) => { state.done = true; state.value = value; },
    (error) => { state.done = true; state.error = error; },
  );
  return state;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('requestTimeoutMs', () => {
  it('gives database and auth requests the default deadline', () => {
    expect(requestTimeoutMs(`${BASE}/rest/v1/workouts?select=*`)).toBe(REQUEST_TIMEOUT_MS);
    expect(requestTimeoutMs(`${BASE}/rest/v1/rpc/other_function`)).toBe(REQUEST_TIMEOUT_MS);
    expect(requestTimeoutMs(new URL(`${BASE}/auth/v1/token?grant_type=refresh_token`))).toBe(REQUEST_TIMEOUT_MS);
  });

  it('gives the program snapshot save a long deadline', () => {
    expect(requestTimeoutMs(`${BASE}/rest/v1/rpc/save_split_snapshot`)).toBe(LONG_REQUEST_TIMEOUT_MS);
  });

  it('exempts edge functions and matches on the path, not the whole URL', () => {
    expect(requestTimeoutMs(`${BASE}/functions/v1/whoop-sync`)).toBeNull();
    expect(requestTimeoutMs(`${BASE}/functions/v1/food-lookup?q=/rest/v1/`)).toBeNull();
    expect(requestTimeoutMs(`${BASE}/storage/v1/object/photo.jpg`)).toBeNull();
    expect(requestTimeoutMs('not a url')).toBeNull();
  });
});

describe('timedFetch', () => {
  it('turns a stalled query into an ordinary error result after the deadline', async () => {
    const fetchMock = stalledFetch();
    vi.stubGlobal('fetch', fetchMock);

    const query = settled(Promise.resolve(supabase.from('workouts').select('*').eq('user_id', 'u')));
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS - 1);
    expect(query.done).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(query.done).toBe(true);
    expect(query.value).toMatchObject({ data: null, status: 0, error: { message: expect.stringContaining('AbortError') } });
    // an aborted GET is not retried by the query builder
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('lets a caller signal that aborts first win', async () => {
    const fetchMock = stalledFetch();
    vi.stubGlobal('fetch', fetchMock);
    const caller = new AbortController();
    const reason = new Error('caller gave up');

    const request = settled(timedFetch(`${BASE}/rest/v1/sets`, { method: 'PATCH', signal: caller.signal }));
    await vi.advanceTimersByTimeAsync(8_000);
    caller.abort(reason);
    await vi.advanceTimersByTimeAsync(0);

    expect(request.done).toBe(true);
    expect(request.error).toBe(reason);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps the set-save abort firing first through the client', async () => {
    const fetchMock = stalledFetch();
    vi.stubGlobal('fetch', fetchMock);
    const caller = new AbortController();
    setTimeout(() => caller.abort(), 8_000);

    const update = settled(Promise.resolve(
      supabase.from('sets').update({ reps: 8 }).eq('id', 'set-1').abortSignal(caller.signal),
    ));
    await vi.advanceTimersByTimeAsync(8_000);

    expect(update.done).toBe(true);
    expect(update.value).toMatchObject({ status: 0, error: { message: expect.stringContaining('AbortError') } });
  });

  it('aborts at once when the caller signal is already aborted', async () => {
    const fetchMock = stalledFetch();
    vi.stubGlobal('fetch', fetchMock);
    const caller = new AbortController();
    const reason = new Error('already cancelled');
    caller.abort(reason);

    await expect(timedFetch(`${BASE}/rest/v1/sets`, { signal: caller.signal })).rejects.toBe(reason);
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not cut off edge functions at the default deadline', async () => {
    const fetchMock = stalledFetch();
    vi.stubGlobal('fetch', fetchMock);

    const request = settled(timedFetch(`${BASE}/functions/v1/whoop-sync`, { method: 'POST' }));
    await vi.advanceTimersByTimeAsync(LONG_REQUEST_TIMEOUT_MS + 1_000);

    expect(request.done).toBe(false);
    // passed through untouched: no deadline signal of its own
    expect(fetchMock.mock.calls[0][1]?.signal).toBeUndefined();
  });

  it('gives the program snapshot save its long deadline', async () => {
    vi.stubGlobal('fetch', stalledFetch());

    const request = settled(timedFetch(`${BASE}/rest/v1/rpc/save_split_snapshot`, { method: 'POST' }));
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 1_000);
    expect(request.done).toBe(false);

    await vi.advanceTimersByTimeAsync(LONG_REQUEST_TIMEOUT_MS);
    expect(request.done).toBe(true);
    expect((request.error as DOMException).name).toBe('AbortError');
  });

  it('clears its timer and caller listener when the request succeeds', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => Response.json({ ok: true })));
    const caller = new AbortController();
    const removeListener = vi.spyOn(caller.signal, 'removeEventListener');

    const response = await timedFetch(`${BASE}/rest/v1/workouts`, { signal: caller.signal });

    expect(await response.json()).toEqual({ ok: true });
    expect(vi.getTimerCount()).toBe(0);
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('keeps the stored session when a token refresh times out', async () => {
    // auth-js stops retrying by elapsed Date time, so fake the clock too
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const fetchMock = stalledFetch();
    vi.stubGlobal('fetch', fetchMock);

    const refresh = settled(supabase.auth.refreshSession());
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);

    expect(refresh.done).toBe(true);
    expect(refresh.value).toMatchObject({ data: { session: null }, error: { name: 'AuthRetryableFetchError' } });
    expect(new URL(String(fetchMock.mock.calls[0][0])).pathname).toBe('/auth/v1/token');
    const { data } = await supabase.auth.getSession();
    expect(data.session?.user.id).toBe(backend.user.id);
  });

  it('retries a timed-out food save under the same id, so it lands once', async () => {
    const rows = new Map<string, unknown>();
    let stallNextLog = true;
    const logWrites: Array<{ method: string; url: string; body: { id: string } }> = [];
    vi.stubGlobal('fetch', vi.fn<typeof fetch>((input, init) => {
      const url = new URL(String(input));
      if (url.pathname === '/auth/v1/user') return Promise.resolve(Response.json(backend.user));
      if (url.pathname === '/rest/v1/nutrition_logs') {
        const body = JSON.parse(String(init?.body));
        logWrites.push({ method: String(init?.method), url: url.href, body });
        // the first write commits on the server but its response is lost
        rows.set(body.id, body);
        if (stallNextLog) {
          stallNextLog = false;
          return stalledFetch()(input, init);
        }
        return Promise.resolve(new Response(null, { status: 201 }));
      }
      throw new Error(`Unexpected test endpoint: ${url.pathname}`);
    }));
    const pending = createPendingEntryId();
    const payload = {
      food_id: 'food-1', servings: 1, meal_type: null, group_id: null, source: 'manual',
      date: '2026-09-30', logged_at: '2026-09-30T12:00:00.000Z',
    };
    const save = () => persistNutritionEntry(payload, undefined, entryWriteId(false, undefined, pending));

    const first = settled(save());
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    expect(first.done).toBe(true);
    expect(first.error).toMatchObject({ message: expect.stringContaining('AbortError') });

    await expect(save()).resolves.toBeUndefined();

    expect(logWrites).toHaveLength(2);
    expect(logWrites.every((write) => write.method === 'POST' && write.url.includes('on_conflict=id'))).toBe(true);
    expect(logWrites[1].body.id).toBe(logWrites[0].body.id);
    expect(rows.size).toBe(1);
  });
});
