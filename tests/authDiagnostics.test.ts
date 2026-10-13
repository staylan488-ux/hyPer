import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The on-device auth trail: capped in memory and localStorage, and limited to
// event names, outcomes and durations — never tokens or account details.
type Diagnostics = typeof import('@/lib/authDiagnostics');

let stored: Map<string, string>;

async function freshModule(): Promise<Diagnostics> {
  vi.resetModules();
  return import('@/lib/authDiagnostics');
}

beforeEach(() => {
  stored = new Map();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => { stored.set(key, value); },
      removeItem: (key: string) => { stored.delete(key); },
    },
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('auth diagnostics ring buffer', () => {
  it('keeps only the newest entries in memory and in storage', async () => {
    const diagnostics = await freshModule();
    const total = diagnostics.AUTH_DIAGNOSTICS_LIMIT + 7;
    for (let i = 0; i < total; i += 1) {
      diagnostics.recordAuthDiagnostic('resume', { detail: `n${i}` });
    }

    const entries = diagnostics.readAuthDiagnostics();
    expect(entries).toHaveLength(diagnostics.AUTH_DIAGNOSTICS_LIMIT);
    expect(entries[0].detail).toBe('n7');
    expect(entries.at(-1)?.detail).toBe(`n${total - 1}`);

    const persisted = JSON.parse(stored.get(diagnostics.AUTH_DIAGNOSTICS_STORAGE_KEY) ?? '[]');
    expect(persisted).toHaveLength(diagnostics.AUTH_DIAGNOSTICS_LIMIT);
    expect(persisted[0].detail).toBe('n7');
  });

  it('continues the persisted trail after a relaunch and tolerates a corrupt copy', async () => {
    const first = await freshModule();
    first.recordAuthDiagnostic('pause');
    const relaunched = await freshModule();
    relaunched.recordAuthDiagnostic('resume');
    expect(relaunched.readAuthDiagnostics().map((entry) => entry.event)).toEqual(['pause', 'resume']);

    stored.set(relaunched.AUTH_DIAGNOSTICS_STORAGE_KEY, '{not json');
    const recovered = await freshModule();
    recovered.recordAuthDiagnostic('resume');
    expect(recovered.readAuthDiagnostics()).toHaveLength(1);
  });

  it('keeps recording in memory when storage throws', async () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => { throw new Error('denied'); },
        setItem: () => { throw new Error('quota'); },
        removeItem: () => { throw new Error('denied'); },
      },
    });
    const diagnostics = await freshModule();
    expect(() => diagnostics.recordAuthDiagnostic('set-save:timeout')).not.toThrow();
    expect(diagnostics.readAuthDiagnostics()).toHaveLength(1);
    expect(() => diagnostics.clearAuthDiagnostics()).not.toThrow();
    expect(diagnostics.readAuthDiagnostics()).toHaveLength(0);
  });

  it('times token refreshes without recording the request or response contents', async () => {
    const diagnostics = await freshModule();
    const inner = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ access_token: 'secret-access', refresh_token: 'secret-refresh' }))
      .mockResolvedValueOnce(Response.json({ error: 'invalid_grant' }, { status: 400 }))
      .mockRejectedValueOnce(new TypeError('Load failed'))
      .mockResolvedValue(Response.json([]));
    const fetchWithDiagnostics = diagnostics.withRefreshDiagnostics(inner);
    const refreshUrl = 'https://abc.supabase.co/auth/v1/token?grant_type=refresh_token';
    const body = JSON.stringify({ refresh_token: 'secret-refresh' });

    await fetchWithDiagnostics(refreshUrl, { method: 'POST', body });
    await fetchWithDiagnostics(refreshUrl, { method: 'POST', body });
    await expect(fetchWithDiagnostics(refreshUrl, { method: 'POST', body })).rejects.toThrow('Load failed');
    await fetchWithDiagnostics('https://abc.supabase.co/rest/v1/sets?id=eq.1');

    const entries = diagnostics.readAuthDiagnostics();
    expect(entries.map((entry) => [entry.event, entry.outcome])).toEqual([
      ['refresh:start', undefined],
      ['refresh:end', 'ok'],
      ['refresh:start', undefined],
      ['refresh:end', 'http:400'],
      ['refresh:start', undefined],
      ['refresh:end', 'TypeError'],
    ]);
    expect(entries.filter((entry) => entry.event === 'refresh:end').every((entry) => typeof entry.durationMs === 'number')).toBe(true);
    expect(inner).toHaveBeenCalledTimes(4);
    expect(stored.get(diagnostics.AUTH_DIAGNOSTICS_STORAGE_KEY)).not.toMatch(/secret|token|abc\.supabase/);
  });
});
