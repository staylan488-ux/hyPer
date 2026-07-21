import { useEffect } from 'react';

import { NativeAuth, isNativeIOS } from '@/lib/nativeBridge';
import { parseNativeOAuthCallback } from '@/lib/nativeOAuthCallback';
import { supabase } from '@/lib/supabase';

export function useNativeAuthCallback(): void {
  useEffect(() => {
    if (!isNativeIOS()) return;
    let cancelled = false;
    let listener: { remove: () => Promise<void> } | null = null;

    const complete = async (callbackUrl: string) => {
      if (cancelled) return;
      try {
        const { code } = parseNativeOAuthCallback(callbackUrl);
        await supabase.auth.exchangeCodeForSession(code);
      } catch {
        // The auth form remains available for a clean retry.
      }
    };

    void (async () => {
      listener = await NativeAuth.addListener('authCallback', ({ callbackUrl }) => {
        void complete(callbackUrl);
      });
      const pending = await NativeAuth.getPendingAuthCallback();
      if (pending.callbackUrl) await complete(pending.callbackUrl);
    })();

    return () => {
      cancelled = true;
      void listener?.remove();
    };
  }, []);
}

