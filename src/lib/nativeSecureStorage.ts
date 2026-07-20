import { NativeAuth, isNativeIOS } from '@/lib/nativeBridge';

// Supabase accepts asynchronous Storage-compatible methods. Only auth state is
// placed here; application data continues through the normal database/RLS path.
export const nativeAuthStorage = {
  async getItem(key: string): Promise<string | null> {
    if (!isNativeIOS()) return window.localStorage.getItem(key);
    return (await NativeAuth.getSecureValue({ key })).value;
  },
  async setItem(key: string, value: string): Promise<void> {
    if (!isNativeIOS()) {
      window.localStorage.setItem(key, value);
      return;
    }
    await NativeAuth.setSecureValue({ key, value });
  },
  async removeItem(key: string): Promise<void> {
    if (!isNativeIOS()) {
      window.localStorage.removeItem(key);
      return;
    }
    await NativeAuth.removeSecureValue({ key });
  },
};

