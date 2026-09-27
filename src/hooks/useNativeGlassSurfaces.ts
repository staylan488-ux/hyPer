import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react';
import type { PluginListenerHandle } from '@capacitor/core';
import { isNativeIOS } from '@/lib/nativeBridge';
import {
  NativeGlassSurfaces,
  connectNativeSurface,
  glassSurfacesKnownSupported,
  nativeOverlayAllowed,
  nativeStatusAllowed,
  watchNativeOverlay,
  type RestAction,
  type RestDockState,
  type ToastState,
} from '@/lib/nativeGlassSurfaces';

/** Optimistic when a previous surface on this page already negotiated glass. */
const initiallyActive = () => isNativeIOS() && glassSurfacesKnownSupported() === true;

/**
 * Draws the rest bar as native iOS 26 glass. Returns true while native owns
 * the bar, so the caller skips its web fallback. The timer, saves and sheet
 * stay in the web; native reports taps as actions.
 */
export function useNativeRestDock(state: Omit<RestDockState, 'visible'> & { visible: boolean }, onAction: (action: RestAction) => void) {
  const [active, setActive] = useState(initiallyActive);
  const latest = useRef(state);
  const refresh = useRef<(() => void) | null>(null);
  const act = useEffectEvent(onAction);

  useLayoutEffect(() => {
    latest.current = state;
    refresh.current?.();
  });

  useEffect(() => {
    if (!isNativeIOS()) return;
    const current = (): RestDockState => ({ ...latest.current, visible: latest.current.visible && nativeOverlayAllowed() });
    const connection = connectNativeSurface({
      plugin: NativeGlassSurfaces,
      key: 'rest',
      initial: current(),
      send: (next) => NativeGlassSurfaces.syncRest(next),
      ready: setActive,
    });
    let handle: PluginListenerHandle | undefined;
    let disposed = false;
    void NativeGlassSurfaces.addListener('restAction', ({ action }) => {
      if (!disposed) act(action);
    }).then((listener) => {
      if (disposed) void listener.remove();
      else handle = listener;
    }).catch(() => {});
    const update = () => connection.update(current());
    refresh.current = update;
    const unwatch = watchNativeOverlay(update);
    // A document unload may never unmount React; hide before it goes.
    const pageHide = () => connection.update({ ...current(), visible: false });
    window.addEventListener('pagehide', pageHide);
    return () => {
      disposed = true;
      refresh.current = null;
      unwatch();
      window.removeEventListener('pagehide', pageHide);
      void handle?.remove().catch(() => {});
      connection.dispose();
    };
  }, []);

  return active;
}

/**
 * Shows a status toast as a native glass pill. Returns true while native
 * owns toasts, so the caller skips its web fallback.
 */
export function useNativeToast(state: ToastState) {
  const [active, setActive] = useState(initiallyActive);
  const latest = useRef(state);
  const refresh = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    latest.current = state;
    refresh.current?.();
  });

  useEffect(() => {
    if (!isNativeIOS()) return;
    // Status, not controls: like the web toast it may show over sheets.
    const current = (): ToastState => ({ ...latest.current, visible: latest.current.visible && nativeStatusAllowed() });
    const connection = connectNativeSurface({
      plugin: NativeGlassSurfaces,
      key: 'toast',
      initial: current(),
      send: (next) => NativeGlassSurfaces.syncToast(next),
      ready: setActive,
    });
    const update = () => connection.update(current());
    refresh.current = update;
    const unwatch = watchNativeOverlay(update);
    const pageHide = () => connection.update({ ...current(), visible: false });
    window.addEventListener('pagehide', pageHide);
    return () => {
      refresh.current = null;
      unwatch();
      window.removeEventListener('pagehide', pageHide);
      connection.dispose();
    };
  }, []);

  return active;
}
