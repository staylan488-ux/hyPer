// Replaces ../src/lib/supabase.ts (see metro.config.js).
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

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
        storage: globalThis.localStorage,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        flowType: 'pkce',
      },
    });
