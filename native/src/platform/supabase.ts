// Replaces ../src/lib/supabase.ts (see metro.config.js) with the same safety
// settings as the web client: every database and auth request has a deadline
// (timedFetch), token refreshes are timed into the on-device diagnostics, and
// foreground and background handling is bounded (authResume).
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';

import { withRefreshDiagnostics } from '@/lib/authDiagnostics';
import { pauseAuth, resumeAuth } from '@/lib/authResume';
import { timedFetch } from '@/lib/timedFetch';
import { createMockClient } from '@/preview/mockSupabase';

import { isPreviewActive } from './previewFlag';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const preview = isPreviewActive();

if (!preview && (!url || !anonKey)) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase: SupabaseClient = preview
  ? createMockClient()
  : createClient(url as string, anonKey as string, {
      auth: {
        // Moves to the Keychain with sign-in (milestone 2), using the web
        // app's item names so cutover keeps people signed in.
        storage: globalThis.localStorage,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        flowType: 'pkce',
      },
      // A stalled connection fails after a deadline instead of hanging.
      global: { fetch: withRefreshDiagnostics(timedFetch) },
    });

// The web app's iOS shell refreshed the session when the app became active and
// paused the refresh timer when it resigned active (Capacitor's appStateChange).
// React Native's AppState gives the same signals. Both steps are bounded and
// never throw.
if (!preview) {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') void resumeAuth(supabase.auth, 'app-active');
    else void pauseAuth(supabase.auth, `app-${state}`);
  });
}
