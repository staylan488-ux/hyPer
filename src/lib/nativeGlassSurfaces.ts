import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { isNativeIOS } from '@/lib/nativeBridge';

/**
 * Bridge to the iOS 26 glass surfaces that float above the web view: the rest
 * dock and toasts, plus the attitude stream behind the motion light. The web
 * owns all state and behaviour; native draws what it is sent and reports taps.
 *
 * Like the navigation bridge, every sync carries a revision so an older async
 * call can never overwrite a newer one, and revisions are seeded from native
 * so a web-view reload cannot fall behind a plugin that outlived it.
 */

export type SurfaceKey = 'rest' | 'toast';
export type RestAction = 'open' | 'toggle' | 'skip' | 'continue';

export interface RestDockState {
  visible: boolean;
  theme: 'light' | 'dark';
  status: 'running' | 'paused' | 'completed';
  /** Absolute end time while running, epoch ms. */
  endsAtMs: number | null;
  remainingMs: number;
  totalMs: number;
  nextLabel: string | null;
  /** The theme's lacquer, #RRGGBB. */
  accent: string;
}

export interface ToastState {
  visible: boolean;
  theme: 'light' | 'dark';
  message: string;
}

export interface GlassSurfacesCapabilities {
  supported: boolean;
  restRevision?: number;
  toastRevision?: number;
  motion?: boolean;
}

type Applied = Promise<{ supported: boolean; applied: boolean }>;

export interface GlassSurfacesPlugin {
  getCapabilities(): Promise<GlassSurfacesCapabilities>;
  syncRest(state: RestDockState & { revision: number }): Applied;
  syncToast(state: ToastState & { revision: number }): Applied;
  startMotion(): Promise<{ active: boolean; token?: number }>;
  stopMotion(options: { token?: number }): Promise<void>;
  addListener(event: 'restAction', callback: (event: { action: RestAction }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'motion', callback: (event: { x: number; y: number }) => void): Promise<PluginListenerHandle>;
}

export const NativeGlassSurfaces = registerPlugin<GlassSurfacesPlugin>('HyperGlassSurfaces');

// ── Capability (one probe per page) ──────────────────────────────────────

let capabilityProbe: Promise<GlassSurfacesCapabilities> | null = null;
let knownSupport: boolean | null = null;

export function probeGlassSurfaces(plugin: GlassSurfacesPlugin): Promise<GlassSurfacesCapabilities> {
  capabilityProbe ??= plugin.getCapabilities()
    .then((capability) => {
      knownSupport = capability.supported;
      for (const key of ['rest', 'toast'] as const) {
        const seeded = capability[`${key}Revision`];
        if (typeof seeded === 'number') revisions[key] = Math.max(revisions[key], seeded);
      }
      return capability;
    })
    .catch(() => {
      knownSupport = false;
      return { supported: false };
    });
  return capabilityProbe;
}

/**
 * Whether native glass surfaces are known to work on this page. Lets a
 * remounting surface (a new rest period) skip the web fallback flash while
 * the next handshake runs. Null until the first probe settles.
 */
export function glassSurfacesKnownSupported(): boolean | null {
  return knownSupport;
}

// ── Revisioned connection ────────────────────────────────────────────────

const revisions: Record<SurfaceKey, number> = { rest: 0, toast: 0 };

interface SurfaceConnectionOptions<S extends { visible: boolean }> {
  plugin: GlassSurfacesPlugin;
  key: SurfaceKey;
  initial: S;
  send: (state: S & { revision: number }) => Applied;
  /** True once native has applied the newest state; false to fall back. */
  ready: (value: boolean) => void;
}

export function connectNativeSurface<S extends { visible: boolean }>({ plugin, key, initial, send, ready }: SurfaceConnectionOptions<S>) {
  let state = initial;
  let disposed = false;
  let supported = false;
  let latest = 0;

  const publish = async () => {
    if (disposed || !supported) return;
    const revision = ++revisions[key];
    latest = revision;
    try {
      const result = await send({ ...state, revision });
      if (!disposed && revision === latest) ready(result.supported && result.applied);
    } catch {
      if (!disposed && revision === latest) {
        supported = false;
        knownSupport = false;
        ready(false);
        void send({ ...state, visible: false, revision: ++revisions[key] }).catch(() => {});
      }
    }
  };

  void probeGlassSurfaces(plugin).then((capability) => {
    if (disposed) return;
    if (!capability.supported) {
      ready(false);
      return;
    }
    supported = true;
    void publish();
  });

  return {
    update(next: S) {
      state = next;
      void publish();
    },
    dispose() {
      disposed = true;
      if (supported) void send({ ...state, visible: false, revision: ++revisions[key] }).catch(() => {});
    },
  };
}

// ── Shared visibility gating ─────────────────────────────────────────────

/**
 * Native overlays sit above every web layer, so they must step aside for web
 * sheets (#root inert), the keyboard, the brand intro and a hidden page.
 */
export function nativeOverlayAllowed(): boolean {
  return nativeStatusAllowed() && !document.getElementById('root')?.inert
    && document.documentElement.dataset.keyboardOpen !== 'true';
}

/**
 * Status toasts take no touches, so like the web toast they may show over
 * sheets and the keyboard — only the brand intro and a hidden page hold them.
 */
export function nativeStatusAllowed(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement.dataset.brandIntro !== 'true' && !document.hidden;
}

/** Call `onChange` whenever `nativeOverlayAllowed()` may have changed. */
export function watchNativeOverlay(onChange: () => void): () => void {
  const root = document.getElementById('root');
  const observer = new MutationObserver(onChange);
  if (root) observer.observe(root, { attributes: true, attributeFilter: ['inert'] });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-keyboard-open', 'data-brand-intro'] });
  document.addEventListener('visibilitychange', onChange);
  return () => {
    observer.disconnect();
    document.removeEventListener('visibilitychange', onChange);
  };
}

// ── Motion ────────────────────────────────────────────────────────────────

/** Native attitude stream for the motion light (iOS only). */
export async function startNativeMotion(
  onLight: (light: { x: number; y: number }) => void,
  plugin: GlassSurfacesPlugin = NativeGlassSurfaces,
): Promise<(() => void) | null> {
  if (!isNativeIOS()) return null;
  try {
    const capability = await probeGlassSurfaces(plugin);
    if (!capability.supported || !capability.motion) return null;
    const handle = await plugin.addListener('motion', onLight);
    const { active, token } = await plugin.startMotion();
    if (!active) {
      await handle.remove();
      return null;
    }
    return () => {
      void handle.remove().catch(() => {});
      void plugin.stopMotion({ token }).catch(() => {});
    };
  } catch {
    return null;
  }
}

/** Test seam. */
export function resetGlassSurfaces() {
  capabilityProbe = null;
  knownSupport = null;
  revisions.rest = 0;
  revisions.toast = 0;
}
