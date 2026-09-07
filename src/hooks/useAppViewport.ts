import { useLayoutEffect } from 'react';
import { appViewport, revealSheetField } from '@/lib/appViewport';

/**
 * CSS owns safe-area padding; this only reports the visible viewport so a
 * keyboard can shorten the shell and lift fixed composers/sheets. Zoom is not
 * a keyboard: keep the full layout when the user pinches to magnify content.
 */
export function useAppViewport() {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const viewport = window.visualViewport;
    let frame = 0;
    const update = () => {
      const { height, top, inset, keyboardOpen } = appViewport(root.clientHeight || window.innerHeight, viewport);
      root.style.setProperty('--app-viewport-top', `${top}px`);
      root.style.setProperty('--app-viewport-height', `${height}px`);
      root.style.setProperty('--app-keyboard-inset', `${inset}px`);
      root.dataset.keyboardOpen = String(keyboardOpen);
    };
    const reveal = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        update();
        const active = document.activeElement;
        if (!(active instanceof HTMLElement) || !active.matches('input, textarea, [contenteditable="true"]')) return;
        const dialog = active.closest<HTMLElement>('[role="dialog"]');
        // Let the user pan freely when deliberately magnifying content.
        if (dialog && !dialog.inert && Math.abs((viewport?.scale ?? 1) - 1) <= 0.01) revealSheetField(active, dialog);
      });
    };
    const resize = () => { update(); reveal(); };
    update();
    viewport?.addEventListener('resize', resize);
    viewport?.addEventListener('scroll', update);
    window.addEventListener('resize', resize);
    document.addEventListener('focusin', reveal);
    document.addEventListener('focusout', update);
    return () => {
      cancelAnimationFrame(frame);
      viewport?.removeEventListener('resize', resize);
      viewport?.removeEventListener('scroll', update);
      window.removeEventListener('resize', resize);
      document.removeEventListener('focusin', reveal);
      document.removeEventListener('focusout', update);
      root.style.removeProperty('--app-viewport-top');
      root.style.removeProperty('--app-viewport-height');
      root.style.removeProperty('--app-keyboard-inset');
      delete root.dataset.keyboardOpen;
    };
  }, []);
}
