import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { supabase } from '@/lib/supabase';

/** Deep-link address the native app hands to Supabase as the OAuth redirect.
 *  Must be listed under Authentication → URL Configuration → Redirect URLs
 *  in the Supabase dashboard, and matches the CFBundleURLSchemes entry in
 *  ios/App/App/Info.plist. */
export const NATIVE_AUTH_CALLBACK = 'hyper://auth-callback';

/** On native, OAuth finishes by iOS opening the hyper:// deep link. Catch it,
 *  close the in-app browser sheet, and trade the code for a session. */
export function initNativeAuth() {
  if (!Capacitor.isNativePlatform()) return;

  void App.addListener('appUrlOpen', ({ url }) => {
    if (!url.startsWith(NATIVE_AUTH_CALLBACK)) return;
    void Browser.close().catch(() => {});
    const code = new URL(url).searchParams.get('code');
    if (code) {
      void supabase.auth.exchangeCodeForSession(code);
    }
  });
}
