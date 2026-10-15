/**
 * Preserve a tab's reading position in the app's single scroll container. A
 * destination can render a loading state first; retry when its content grows,
 * but never fight a person who starts scrolling before loading finishes.
 * Memory belongs to the mounted private layout, not storage or another user.
 */
export function bindRouteScroll(
  viewport: HTMLElement,
  path: string,
  positions: Map<string, number>,
  surfaces: { navigation?: EventTarget; history?: EventTarget } = {},
) {
  const target = positions.get(path) ?? 0;
  let waitingForContent = true;

  const restore = () => {
    if (!waitingForContent) return;
    viewport.scrollTop = target;
    if (Math.abs(viewport.scrollTop - target) < 1) {
      waitingForContent = false;
      positions.set(path, viewport.scrollTop);
    }
  };
  const remember = () => {
    if (!waitingForContent) positions.set(path, viewport.scrollTop);
  };
  const takeControl = () => {
    waitingForContent = false;
    remember();
  };
  const onKey = (event: KeyboardEvent) => {
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) takeControl();
  };

  restore();
  const observer = new ResizeObserver(restore);
  observer.observe(viewport);
  if (viewport.firstElementChild) observer.observe(viewport.firstElementChild);
  viewport.addEventListener('scroll', remember, { passive: true });
  viewport.addEventListener('wheel', takeControl, { passive: true });
  viewport.addEventListener('touchstart', takeControl, { passive: true });
  viewport.addEventListener('pointerdown', takeControl, { passive: true });
  viewport.addEventListener('keydown', onKey);
  // Scroll events can lag the last compositor frame. Capture the actual
  // position before a Link/button navigates and React replaces the content;
  // effect cleanup is too late because the new page may already clamp it.
  const navigation = surfaces.navigation ?? viewport;
  navigation.addEventListener('click', remember, { capture: true });
  surfaces.history?.addEventListener('popstate', remember, { capture: true });
  surfaces.history?.addEventListener('hyper:native-navigation', remember);

  return () => {
    observer.disconnect();
    viewport.removeEventListener('scroll', remember);
    viewport.removeEventListener('wheel', takeControl);
    viewport.removeEventListener('touchstart', takeControl);
    viewport.removeEventListener('pointerdown', takeControl);
    viewport.removeEventListener('keydown', onKey);
    navigation.removeEventListener('click', remember, { capture: true });
    surfaces.history?.removeEventListener('popstate', remember, { capture: true });
    surfaces.history?.removeEventListener('hyper:native-navigation', remember);
  };
}
