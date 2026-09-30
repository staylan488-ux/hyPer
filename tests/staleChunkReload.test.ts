import { describe, expect, it, vi } from 'vitest';
import { reloadOnceForStaleChunk, reloadOnStaleChunk } from '@/lib/staleChunkReload';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

describe('stale chunk reload', () => {
  it('reloads once per tab session, then leaves later failures to the error screen', () => {
    const storage = memoryStorage();
    const reload = vi.fn();

    expect(reloadOnceForStaleChunk(() => storage, reload)).toBe(true);
    expect(reloadOnceForStaleChunk(() => storage, reload)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('never reloads when the flag cannot be stored', () => {
    const reload = vi.fn();
    const blocked = {
      getItem: () => null,
      setItem: () => { throw new Error('QuotaExceededError'); },
    };

    expect(reloadOnceForStaleChunk(() => blocked, reload)).toBe(false);
    expect(reloadOnceForStaleChunk(() => { throw new Error('SecurityError'); }, reload)).toBe(false);
    expect(reloadOnceForStaleChunk(() => undefined, reload)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads once when a route chunk fails, and keeps the screen until it does', async () => {
    const reload = vi.fn();
    const storage = memoryStorage();
    const env = { storage: () => storage, reload, isOffline: () => false };
    const stale = new Error('Failed to fetch dynamically imported module');
    const open = reloadOnStaleChunk(() => Promise.reject(stale), env);

    let settled = false;
    void open().then(() => { settled = true; }, () => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);

    // The reloaded page failing again goes to the route error screen.
    await expect(open()).rejects.toBe(stale);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('passes successful loads through untouched', async () => {
    const reload = vi.fn();
    const page = { Component: () => null };
    const open = reloadOnStaleChunk(() => Promise.resolve(page), {
      storage: () => memoryStorage(),
      reload,
      isOffline: () => false,
    });

    await expect(open()).resolves.toBe(page);
    expect(reload).not.toHaveBeenCalled();
  });

  it('never reloads while offline and keeps the reload for a real stale deploy', async () => {
    const reload = vi.fn();
    const storage = memoryStorage();
    let offline = true;
    const failure = new Error('Failed to fetch dynamically imported module');
    const open = reloadOnStaleChunk(() => Promise.reject(failure), {
      storage: () => storage,
      reload,
      isOffline: () => offline,
    });

    await expect(open()).rejects.toBe(failure);
    expect(reload).not.toHaveBeenCalled();

    offline = false;
    void open();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
