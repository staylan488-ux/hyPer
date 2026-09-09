import { useLayoutEffect } from 'react';
import { App } from '@capacitor/app';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
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
    let disposed = false;
    let nativeInactive = false;
    let nativeListener: PluginListenerHandle | null = null;
    let frame = 0;
    let recoveryFrame = 0;
    let recoveryTimers: ReturnType<typeof setTimeout>[] = [];
    const visible = () => !disposed && !nativeInactive && document.visibilityState !== 'hidden';
    const update = () => {
      if (!visible()) return;
      const { height, top, inset, keyboardOpen } = appViewport(root.clientHeight || window.innerHeight, viewport);
      root.style.setProperty('--app-viewport-top', `${top}px`);
      root.style.setProperty('--app-viewport-height', `${height}px`);
      root.style.setProperty('--app-keyboard-inset', `${inset}px`);
      root.dataset.keyboardOpen = String(keyboardOpen);
    };
    const reveal = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!visible()) return;
        update();
        const active = document.activeElement;
        if (!(active instanceof HTMLElement) || !active.matches('input, textarea, [contenteditable="true"]')) return;
        // Let the user pan freely when deliberately magnifying content.
        if (Math.abs((viewport?.scale ?? 1) - 1) > 0.01) return;
        const dialog = active.closest<HTMLElement>('[role="dialog"]');
        if (dialog) {
          if (!dialog.inert) revealSheetField(active, dialog);
          return;
        }
        // Inline workout entry keeps its save control beside the focused input.
        // Reveal the whole row inside the app shell, without panning the document.
        const entry = active.closest<HTMLElement>('[data-workout-set-entry]');
        const boundary = entry?.closest<HTMLElement>('.app-viewport');
        if (entry && boundary && !boundary.inert) revealSheetField(entry, boundary);
      });
    };
    const resize = () => { update(); reveal(); };
    const cancelRecovery = () => {
      cancelAnimationFrame(recoveryFrame);
      recoveryTimers.forEach(clearTimeout);
      recoveryTimers = [];
    };
    const recover = () => {
      cancelRecovery();
      if (!visible()) return;
      update();
      recoveryFrame = requestAnimationFrame(update);
      // A resumed WKWebView can report its suspended keyboard geometry until
      // after the first frame, without sending a matching viewport resize.
      // Remeasure briefly as it settles; never guess that the keyboard closed.
      recoveryTimers = [100, 300, 700, 1500].map(delay => setTimeout(update, delay));
    };
    const visibilityChanged = () => {
      if (document.visibilityState === 'hidden') cancelRecovery();
      else recover();
    };
    update();
    viewport?.addEventListener('resize', resize);
    viewport?.addEventListener('scroll', update);
    window.addEventListener('resize', resize);
    document.addEventListener('focusin', reveal);
    document.addEventListener('focusout', update);
    document.addEventListener('visibilitychange', visibilityChanged);
    window.addEventListener('pageshow', recover);
    window.addEventListener('focus', recover);
    window.addEventListener('pagehide', cancelRecovery);
    if (Capacitor.isNativePlatform()) {
      void App.addListener('appStateChange', ({ isActive }) => {
        if (disposed) return;
        nativeInactive = !isActive;
        if (isActive) recover();
        else cancelRecovery();
      }).then(listener => {
        if (disposed) void listener.remove().catch(() => undefined);
        else nativeListener = listener;
      }).catch(() => {
        // Browser visibility and focus recovery remain available if the native
        // listener cannot attach (for example in an older installed shell).
      });
    }
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      cancelRecovery();
      viewport?.removeEventListener('resize', resize);
      viewport?.removeEventListener('scroll', update);
      window.removeEventListener('resize', resize);
      document.removeEventListener('focusin', reveal);
      document.removeEventListener('focusout', update);
      document.removeEventListener('visibilitychange', visibilityChanged);
      window.removeEventListener('pageshow', recover);
      window.removeEventListener('focus', recover);
      window.removeEventListener('pagehide', cancelRecovery);
      void nativeListener?.remove().catch(() => undefined);
      root.style.removeProperty('--app-viewport-top');
      root.style.removeProperty('--app-viewport-height');
      root.style.removeProperty('--app-keyboard-inset');
      delete root.dataset.keyboardOpen;
    };
  }, []);
}
