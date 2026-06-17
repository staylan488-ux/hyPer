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
  }
}

// Latch preview mode for the tab session: enter via any /preview URL, then every
// route stays mocked (even across full reloads) until the tab is closed.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  try {
    if (window.location.pathname.startsWith('/preview')) {
      window.sessionStorage.setItem('hyper-preview', '1');
    }
    if (window.sessionStorage.getItem('hyper-preview') === '1') {
      window.__HYPER_PREVIEW__ = true;
    }
  } catch {
    if (window.location.pathname.startsWith('/preview')) window.__HYPER_PREVIEW__ = true;
  }
}

export const isPreviewActive = () =>
  import.meta.env.DEV && typeof window !== 'undefined' && window.__HYPER_PREVIEW__ === true;
