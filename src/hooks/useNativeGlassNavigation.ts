import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { isNativeIOS } from '@/lib/nativeBridge';
import { connectGlassNavigation, NativeGlassNavigation, nativeTabForPath, nativeTabPaths, type NativeTab } from '@/lib/nativeGlassNavigation';
import { nativeOverlayAllowed, watchNativeOverlay } from '@/lib/nativeGlassSurfaces';
import { useThemeStore } from '@/stores/themeStore';

/** Native iOS negotiates system glass; unsupported platforms keep web navigation. */
export function useNativeGlassNavigation(path: string, routeVisible: boolean) {
  const theme = useThemeStore((state) => state.theme);
  const navigate = useNavigate();
  const [active, setActive] = useState(false);
  const state = useRef({ selected: nativeTabForPath(path), theme, visible: routeVisible });
  const refresh = useRef<(() => void) | null>(null);
  const select = useEffectEvent((tab: NativeTab) => {
    window.dispatchEvent(new Event('hyper:native-navigation'));
    navigate(nativeTabPaths[tab]);
  });

  useLayoutEffect(() => {
    state.current = { selected: nativeTabForPath(path), theme, visible: routeVisible };
    refresh.current?.();
  }, [path, routeVisible, theme]);

  useEffect(() => {
    if (!isNativeIOS()) return;
    const current = () => ({
      ...state.current,
      visible: state.current.visible && nativeOverlayAllowed(),
    });
    const connection = connectGlassNavigation(NativeGlassNavigation, current(), {
      ready: setActive,
      select: (tab) => select(tab),
    });
    const update = () => connection.update(current());
    refresh.current = update;
    const unwatch = watchNativeOverlay(update);
    const pageHide = () => connection.update({ ...current(), visible: false });
    window.addEventListener('pagehide', pageHide);
    return () => {
      unwatch();
      window.removeEventListener('pagehide', pageHide);
      refresh.current = null;
      connection.dispose();
    };
  }, []);

  return active;
}
