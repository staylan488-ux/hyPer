// DEV-ONLY preview scaffolding. Remove this folder (and its three wiring edits in
// main.tsx, App.tsx, lib/supabase.ts) to strip the preview entirely.
//
// This module MUST be imported before lib/supabase.ts so the flag is set before
// the Supabase client is created. main.tsx imports it first.
//
// Visiting any /preview URL turns on "preview mode": the Supabase client is
// swapped for an in-memory mock and the stores are seeded with sample data, so
// the whole signed-in app is browsable without a login or a backend.

declare global {
  interface Window {
    __HYPER_PREVIEW__?: boolean;
    __HYPER_SANDBOX__?: boolean;
  }
}

// /preview keeps the gallery and developer controls. /sandbox uses the same
// in-memory backend but renders the real app directly with live photo providers.
// Both modes stay latched until the tab is closed or the other entry is visited.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  try {
    if (window.location.pathname.startsWith('/preview')) {
      window.sessionStorage.setItem('hyper-preview', '1');
      window.sessionStorage.removeItem('hyper-sandbox');
    } else if (window.location.pathname.startsWith('/sandbox')) {
      window.sessionStorage.setItem('hyper-preview', '1');
      window.sessionStorage.setItem('hyper-sandbox', '1');
    }
    if (window.sessionStorage.getItem('hyper-preview') === '1') {
      window.__HYPER_PREVIEW__ = true;
    }
    if (window.sessionStorage.getItem('hyper-sandbox') === '1') {
      window.__HYPER_SANDBOX__ = true;
    }
  } catch {
    if (window.location.pathname.startsWith('/preview')) {
      window.__HYPER_PREVIEW__ = true;
      window.__HYPER_SANDBOX__ = false;
    } else if (window.location.pathname.startsWith('/sandbox')) {
      window.__HYPER_PREVIEW__ = true;
      window.__HYPER_SANDBOX__ = true;
    }
  }
}

// The preview's clock reads 9:41 when the page loads, as the status bar in
// screenshots does, and runs on from there, so "now" agrees with the sample
// day (food logged before now, the live lift begun after the morning's
// activities). The sandbox keeps the real clock.
if (import.meta.env.DEV && typeof window !== 'undefined' && window.__HYPER_PREVIEW__ && !window.__HYPER_SANDBOX__) {
  const RealDate = Date;
  const anchor = new RealDate();
  anchor.setHours(9, 41, 0, 0);
  const offset = anchor.getTime() - RealDate.now();
  class PreviewDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(RealDate.now() + offset);
      else super(...(args as [string | number | Date]));
    }
    static now() {
      return RealDate.now() + offset;
    }
  }
  window.Date = PreviewDate as DateConstructor;
}

export const isPreviewActive = () =>
  import.meta.env.DEV && typeof window !== 'undefined' && window.__HYPER_PREVIEW__ === true;

export const isAppSandboxActive = () =>
  isPreviewActive() && typeof window !== 'undefined' && window.__HYPER_SANDBOX__ === true;
