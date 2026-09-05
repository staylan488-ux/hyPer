import { describe, expect, it, vi } from 'vitest';
import { connectGlassNavigation, nativeTabForPath, type GlassNavigationPlugin, type GlassNavigationState } from '@/lib/nativeGlassNavigation';

const initial: GlassNavigationState = { selected: 'today', visible: true, theme: 'dark' };
const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function setup(supported = true) {
  let select!: (event: { tab: 'today' | 'fuel' }) => void;
  const remove = vi.fn(async () => {});
  const plugin: GlassNavigationPlugin = {
    getCapabilities: vi.fn(async () => ({ supported })),
    sync: vi.fn(async () => ({ supported: true, applied: true })),
    hide: vi.fn(async () => {}),
    addListener: vi.fn(async (_name, callback) => { select = callback; return { remove }; }),
  };
  const callbacks = { ready: vi.fn(), select: vi.fn() };
  const connection = connectGlassNavigation(plugin, initial, callbacks);
  return { plugin, callbacks, connection, remove, select: () => select };
}

describe('native glass navigation', () => {
  it('keeps web navigation when iOS cannot provide glass', async () => {
    const { plugin, callbacks } = setup(false);
    await tick();
    expect(plugin.addListener).not.toHaveBeenCalled();
    expect(plugin.sync).not.toHaveBeenCalled();
    expect(callbacks.ready).not.toHaveBeenCalledWith(true);
  });

  it('suppresses native taps while a sheet or workout owns the screen', async () => {
    const { connection, select, callbacks, plugin } = setup();
    await tick();
    select()({ tab: 'fuel' });
    expect(callbacks.select).toHaveBeenCalledWith('fuel');
    callbacks.select.mockClear();
    connection.update({ ...initial, visible: false });
    select()({ tab: 'fuel' });
    expect(callbacks.select).not.toHaveBeenCalled();
    expect(plugin.sync).toHaveBeenLastCalledWith(expect.objectContaining({ visible: false }));
    connection.dispose();
  });

  it('seeds revisions from a native plugin that outlives a webview reload', async () => {
    const { connection, plugin } = setup();
    connection.dispose();
    vi.mocked(plugin.getCapabilities).mockResolvedValue({ supported: true, revision: 9000 });
    const next = connectGlassNavigation(plugin, initial, { ready: vi.fn(), select: vi.fn() });
    await tick();
    expect(vi.mocked(plugin.sync).mock.calls[0][0].revision).toBeGreaterThan(9000);
    next.dispose();
  });

  it('drops late capability results after unmount', async () => {
    const { connection, plugin, callbacks } = setup();
    connection.dispose();
    await tick();
    expect(plugin.sync).not.toHaveBeenCalled();
    expect(callbacks.ready).not.toHaveBeenCalledWith(true);
  });

  it('uses increasing revisions across remounts and hides on disposal', async () => {
    const first = setup();
    await tick();
    first.connection.dispose();
    const second = setup();
    await tick();
    const firstCalls = vi.mocked(first.plugin.sync).mock.calls;
    const hiddenRevision = firstCalls.at(-1)![0].revision;
    expect(firstCalls.at(-1)![0].visible).toBe(false);
    expect(vi.mocked(second.plugin.sync).mock.calls[0][0].revision).toBeGreaterThan(hiddenRevision);
    expect(first.remove).toHaveBeenCalledOnce();
    second.connection.dispose();
  });

  it('ignores a stale failed update after a newer successful sync', async () => {
    const { connection, plugin, callbacks } = setup();
    await tick();
    let rejectOld!: (error: Error) => void;
    vi.mocked(plugin.sync).mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectOld = reject; }));
    connection.update({ ...initial, selected: 'fuel' });
    connection.update({ ...initial, selected: 'you' });
    await tick();
    rejectOld(new Error('late failure'));
    await tick();
    expect(callbacks.ready).toHaveBeenLastCalledWith(true);
    connection.dispose();
  });

  it('releases the native surface and restores web fallback on bridge failure', async () => {
    const { connection, plugin, callbacks } = setup();
    await tick();
    vi.mocked(plugin.sync).mockRejectedValueOnce(new Error('bridge unavailable'));
    connection.update({ ...initial, selected: 'fuel' });
    await tick();
    expect(callbacks.ready).toHaveBeenLastCalledWith(false);
    expect(plugin.sync).toHaveBeenLastCalledWith(expect.objectContaining({ visible: false }));
    connection.dispose();
  });

  it('matches route sections without matching unrelated prefixes', () => {
    expect(nativeTabForPath('/')).toBe('today');
    expect(nativeTabForPath('/train/program')).toBe('train');
    expect(nativeTabForPath('/nutrition')).toBe('fuel');
    expect(nativeTabForPath('/history')).toBe('you');
    expect(nativeTabForPath('/training')).toBe('you');
  });
});
