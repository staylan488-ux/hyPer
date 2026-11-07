// The Supabase client for shared code outside the app. The app uses
// native/src/platform/supabase.ts instead (the Keychain session and iOS app
// state), which native/metro.config.js swaps in for this file; it must stay so
// the swap can resolve. Tests load this one with the values in vitest.config.ts.
import { createClient } from '@supabase/supabase-js'
import { withRefreshDiagnostics } from '@/lib/authDiagnostics'
import { installAuthResume } from '@/lib/authResume'
import { timedFetch } from '@/lib/timedFetch'
import { isPreviewActive } from '@/preview/flag'
import { createMockClient } from '@/preview/mockSupabase'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Preview mode swaps in the in-memory sample backend.
const preview = isPreviewActive()

if (!preview && (!supabaseUrl || !supabaseAnonKey)) {
  throw new Error('Missing Supabase environment variables')
}

export const supabase = preview
  ? createMockClient()
  : createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
      // A stalled connection fails after a deadline instead of hanging.
      global: { fetch: withRefreshDiagnostics(timedFetch) },
    })

// Bounded refresh on foreground; replaces the SDK's own visibility handling.
if (!preview) installAuthResume(supabase.auth)
