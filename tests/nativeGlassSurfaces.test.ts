import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  connectNativeSurface,
  glassSurfacesKnownSupported,
  resetGlassSurfaces,
  type GlassSurfacesPlugin,
  type ToastState,
} from '@/lib/nativeGlassSurfaces';

const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const initial: ToastState = { visible: true, theme: 'light', message: 'Entry saved' };

function plugin(overrides: Partial<GlassSurfacesPlugin> = {}): GlassSurfacesPlugin {
  return {
    getCapabilities: vi.fn(async () => ({ supported: true })),
    syncRest: vi.fn(async () => ({ supported: true, applied: true })),
    syncToast: vi.fn(async () => ({ supported: true, applied: true })),
    startMotion: vi.fn(async () => ({ active: true })),
    stopMotion: vi.fn(async () => {}),
    addListener: vi.fn(async () => ({ remove: async () => {} })),
    ...overrides,
  } as GlassSurfacesPlugin;
}

function connect(p: GlassSurfacesPlugin, ready = vi.fn()) {
  const connection = connectNativeSurface({ plugin: p, key: 'toast', initial, send: (state) => p.syncToast(state), ready });
  return { connection, ready };
}

afterEach(() => resetGlassSurfaces());

describe('native glass surfaces', () => {
  it('keeps the web surface when iOS cannot provide glass', async () => {
    const p = plugin({ getCapabilities: vi.fn(async () => ({ supported: false })) });
    const { ready } = connect(p);
    await tick();
    expect(p.syncToast).not.toHaveBeenCalled();
    expect(ready).toHaveBeenCalledWith(false);
    expect(glassSurfacesKnownSupported()).toBe(false);
  });

  it('publishes state and reports native readiness', async () => {
    const p = plugin();
    const { connection, ready } = connect(p);
    await tick();
    expect(p.syncToast).toHaveBeenCalledWith(expect.objectContaining({ message: 'Entry saved', visible: true }));
    expect(ready).toHaveBeenLastCalledWith(true);
    expect(glassSurfacesKnownSupported()).toBe(true);
    connection.dispose();
    expect(p.syncToast).toHaveBeenLastCalledWith(expect.objectContaining({ visible: false }));
  });

  it('probes capabilities once per page and seeds revisions from native', async () => {
    const p = plugin({ getCapabilities: vi.fn(async () => ({ supported: true, toastRevision: 500 })) });
    const first = connect(p);
    await tick();
    first.connection.dispose();
    const second = connect(p);
    await tick();
    expect(p.getCapabilities).toHaveBeenCalledTimes(1);
    const revisions = vi.mocked(p.syncToast).mock.calls.map(([state]) => state.revision);
    expect(revisions[0]).toBeGreaterThan(500);
    expect(revisions).toEqual([...revisions].sort((a, b) => a - b));
    second.connection.dispose();
  });

  it('only the newest update decides readiness', async () => {
    const resolvers: Array<(value: { supported: boolean; applied: boolean }) => void> = [];
    const p = plugin({
      syncToast: vi.fn(() => new Promise<{ supported: boolean; applied: boolean }>((resolve) => resolvers.push(resolve))),
    });
    const { connection, ready } = connect(p);
    await tick();
    connection.update({ ...initial, message: 'Weight logged' });
    resolvers[1]({ supported: true, applied: true });
    await tick();
    resolvers[0]({ supported: true, applied: false });
    await tick();
    expect(ready).toHaveBeenCalledTimes(1);
    expect(ready).toHaveBeenLastCalledWith(true);
  });

  it('falls back and hides when a sync fails', async () => {
    const p = plugin({ syncToast: vi.fn(async () => { throw new Error('bridge'); }) });
    const { ready } = connect(p);
    await tick();
    expect(ready).toHaveBeenLastCalledWith(false);
    expect(glassSurfacesKnownSupported()).toBe(false);
  });

  it('drops late capability results after unmount', async () => {
    const p = plugin();
    const { connection, ready } = connect(p);
    connection.dispose();
    await tick();
    expect(p.syncToast).not.toHaveBeenCalled();
    expect(ready).not.toHaveBeenCalled();
  });
});
