import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export const nativeTabPaths = {
  today: '/', train: '/train', fuel: '/nutrition', you: '/settings',
} as const;
export type NativeTab = keyof typeof nativeTabPaths;
export interface GlassNavigationState {
  selected: NativeTab;
  visible: boolean;
  theme: 'light' | 'dark';
}
export interface GlassNavigationPlugin {
  getCapabilities(): Promise<{ supported: boolean; revision?: number }>;
  sync(state: GlassNavigationState & { revision: number }): Promise<{ supported: boolean; applied: boolean }>;
  hide(): Promise<void>;
  addListener(event: 'select', callback: (event: { tab: NativeTab }) => void): Promise<PluginListenerHandle>;
}
export const NativeGlassNavigation = registerPlugin<GlassNavigationPlugin>('HyperGlassNavigation');

// Shared across React remounts so an old async sync cannot overwrite a new one.
let revision = 0;

export function connectGlassNavigation(
  plugin: GlassNavigationPlugin,
  initial: GlassNavigationState,
  callbacks: { ready(value: boolean): void; select(tab: NativeTab): void },
) {
  let state = initial;
  let disposed = false;
  let supported = false;
  let handle: PluginListenerHandle | undefined;
  let lastRevision = 0;
  const publish = async () => {
    if (disposed || !supported) return;
    const sent = ++revision;
    lastRevision = sent;
    try {
      const result = await plugin.sync({ ...state, revision: sent });
      if (!disposed && sent === lastRevision) callbacks.ready(result.supported && result.applied);
    } catch {
      if (!disposed && sent === lastRevision) {
        callbacks.ready(false);
        supported = false;
        void plugin.sync({ ...state, visible: false, revision: ++revision }).catch(() => {});
      }
    }
  };
  void (async () => {
    try {
      const capability = await plugin.getCapabilities();
      if (disposed || !capability.supported) return;
      revision = Math.max(revision, capability.revision ?? -1);
      const listener = await plugin.addListener('select', ({ tab }) => {
        if (!disposed && state.visible && Object.hasOwn(nativeTabPaths, tab)) callbacks.select(tab);
      });
      if (disposed) { await listener.remove(); return; }
      handle = listener;
      supported = true;
      await publish();
    } catch { if (!disposed) callbacks.ready(false); }
  })();
  return {
    update(next: GlassNavigationState) {
      state = next;
      void publish();
    },
    dispose() {
      disposed = true;
      if (handle) void handle.remove().catch(() => {});
      if (supported) void plugin.sync({ ...state, visible: false, revision: ++revision }).catch(() => {});
    },
  };
}

export function nativeTabForPath(path: string): NativeTab {
  if (['/train', '/workout', '/splits'].some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) return 'train';
  if (path === '/nutrition' || path.startsWith('/nutrition/')) return 'fuel';
  if (path === '/') return 'today';
  return 'you';
}
