import { useLayoutEffect } from 'react';

/**
 * CSS owns safe-area padding; this only reports the visible viewport so a
 * keyboard can shorten the shell and lift fixed composers/sheets. Zoom is not
 * a keyboard: keep the full layout when the user pinches to magnify content.
 */
export function useAppViewport() {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const viewport = window.visualViewport;
    const update = () => {
      if (viewport && Math.abs(viewport.scale - 1) > 0.01) return;
      const height = viewport?.height ?? window.innerHeight;
      const top = Math.max(0, viewport?.offsetTop ?? 0);
      const occluded = Math.max(0, window.innerHeight - height - top);
      const active = document.activeElement;
      const editing = active instanceof HTMLElement && (
        active.matches('input, textarea, [contenteditable="true"]')
      );
      root.style.setProperty('--app-viewport-top', `${top}px`);
      root.style.setProperty('--app-viewport-height', `${height}px`);
      root.style.setProperty('--app-keyboard-inset', `${occluded}px`);
      root.dataset.keyboardOpen = String(editing && occluded > 100);
    };
    update();
    viewport?.addEventListener('resize', update);
    viewport?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', update);
    return () => {
      viewport?.removeEventListener('resize', update);
      viewport?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', update);
      root.style.removeProperty('--app-viewport-top');
      root.style.removeProperty('--app-viewport-height');
      root.style.removeProperty('--app-keyboard-inset');
      delete root.dataset.keyboardOpen;
    };
  }, []);
}
