import { createClient } from '@supabase/supabase-js'
import { isNativeIOS } from '@/lib/nativeBridge'
import { nativeAuthStorage } from '@/lib/nativeSecureStorage'
import { isPreviewActive } from '@/preview/flag'
import { createMockClient } from '@/preview/mockSupabase'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// DEV-ONLY: on /preview, swap in an in-memory mock so the signed-in app is
// browsable without a backend. Production always uses the real client.
const preview = isPreviewActive()
const nativeIOS = isNativeIOS()

if (!preview && (!supabaseUrl || !supabaseAnonKey)) {
  throw new Error('Missing Supabase environment variables')
}

export const supabase = preview
  ? createMockClient()
  : createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: !nativeIOS,
        ...(nativeIOS ? { flowType: 'pkce' as const, storage: nativeAuthStorage } : {}),
      }
    })
