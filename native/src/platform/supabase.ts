// Replaces ../src/lib/supabase.ts (see metro.config.js) with the shared safety
// settings: every database and auth request has a deadline
// (timedFetch), token refreshes are timed into the on-device diagnostics, and
// foreground and background handling is bounded (authResume).
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';

import { withRefreshDiagnostics } from '@/lib/authDiagnostics';
import { pauseAuth, resumeAuth } from '@/lib/authResume';
import { createSecureAuthStorage } from '@/lib/nativeSecureStorage';
import { timedFetch } from '@/lib/timedFetch';
import { createMockClient } from '@/preview/mockSupabase';

import { hyperKeychain } from '../../modules/hyper-keychain';
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
        // The session lives in the Keychain under the item names the
        // Capacitor app (hyPer 1.x) used, so the 2.0 update kept people signed
        // in, with the shared timeouts, cache and sign-out tombstone.
        storage: createSecureAuthStorage(hyperKeychain, () => true),
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        flowType: 'pkce',
      },
      // A stalled connection fails after a deadline instead of hanging.
      global: { fetch: withRefreshDiagnostics(timedFetch) },
    });

// Refresh the session when the app becomes active and pause the refresh timer
// when it leaves, from React Native's AppState. Both steps are bounded and
// never throw.
if (!preview) {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') void resumeAuth(supabase.auth, 'app-active');
    else void pauseAuth(supabase.auth, `app-${state}`);
  });
}
