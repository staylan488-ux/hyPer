import { describe, expect, it, vi } from 'vitest';
import { installStaleChunkReload, reloadOnceForStaleChunk } from '@/lib/staleChunkReload';

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

  it('listens for Vite preload failures', () => {
    const target = new EventTarget();
    const reload = vi.fn();
    Object.assign(target, { sessionStorage: memoryStorage(), location: { reload } });
    installStaleChunkReload(target as unknown as Window);

    target.dispatchEvent(new Event('vite:preloadError'));
    target.dispatchEvent(new Event('vite:preloadError'));

    expect(reload).toHaveBeenCalledTimes(1);
  });
});
