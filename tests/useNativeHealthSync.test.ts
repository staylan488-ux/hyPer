// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sync: vi.fn<(userId: string, signal?: AbortSignal) => Promise<void>>(),
  enable: vi.fn<() => Promise<void>>(),
  remove: vi.fn<() => Promise<void>>(),
  stopWatching: vi.fn(),
  visible: null as (() => void) | null,
  changed: null as (() => void) | null,
}));

vi.mock('@/lib/healthWeights', () => ({
  isHealthWeightSyncEnabled: () => true,
  syncNativeBodyWeights: mocks.sync,
}));
vi.mock('@/lib/appVisibility', () => ({
  onAppVisible: (callback: () => void) => {
    mocks.visible = callback;
    return mocks.stopWatching;
  },
}));
vi.mock('@/lib/nativeBridge', () => ({
  hasNativeHealth: () => true,
  NativeHealth: {
    enableWeightUpdates: mocks.enable,
    addListener: async (_event: string, callback: () => void) => {
      mocks.changed = callback;
      return { remove: mocks.remove };
    },
  },
}));

import { useNativeHealthSync } from '@/hooks/useNativeHealthSync';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
function Probe({ userId }: { userId?: string }) {
  useNativeHealthSync(userId);
  return null;
}
const render = async (userId?: string) => {
  await act(async () => { root.render(createElement(Probe, { userId })); });
};

describe('automatic Health sync lifecycle', () => {
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    mocks.sync.mockReset().mockImplementation(async () => {});
    mocks.enable.mockReset().mockResolvedValue();
    mocks.remove.mockReset().mockResolvedValue();
    mocks.visible = null;
    mocks.changed = null;
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('aborts the active importer and ignores queued callbacks when the switch turns off', async () => {
    mocks.sync.mockImplementation(() => new Promise(() => {}));
    await render('user-1');
    const signal = mocks.sync.mock.calls[0][1]!;
    expect(signal.aborted).toBe(false);

    await render(undefined);
    expect(signal.aborted).toBe(true);
    expect(mocks.remove).toHaveBeenCalledTimes(1);
    expect(mocks.stopWatching).toHaveBeenCalledTimes(1);
    mocks.visible?.();
    mocks.changed?.();
    expect(mocks.sync).toHaveBeenCalledTimes(1);

    await render('user-1');
    expect(mocks.sync).toHaveBeenCalledTimes(2);
    expect(mocks.sync.mock.calls[1][1]?.aborted).toBe(false);
  });

  it('does not attach an observer or start importing if Stop happens during native setup', async () => {
    let enabled!: () => void;
    mocks.enable.mockReturnValue(new Promise<void>((resolve) => { enabled = resolve; }));
    await render('user-1');
    await render(undefined);
    await act(async () => { enabled(); });

    expect(mocks.changed).toBeNull();
    expect(mocks.sync).not.toHaveBeenCalled();
  });
});
