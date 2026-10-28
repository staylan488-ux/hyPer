import { requireNativeModule } from 'expo';

type KeychainResult = { value?: string | null; error?: string; osStatus?: number };

interface HyperKeychainNative {
  getValue(key: string): Promise<KeychainResult>;
  setValue(key: string, value: string): Promise<KeychainResult>;
  removeValue(key: string): Promise<KeychainResult>;
}

// Loaded on first use, so sample-data runs never need the native module.
let loaded: HyperKeychainNative | null = null;
const native = (): HyperKeychainNative => (loaded ??= requireNativeModule<HyperKeychainNative>('HyperKeychain'));

/** A failure shaped like the Capacitor plugin's rejection (`code`, `data.osStatus`). */
class KeychainError extends Error {
  readonly code: string;
  readonly data: { osStatus?: number };

  constructor(code: string, osStatus?: number) {
    super(`Keychain ${code}`);
    this.code = code;
    this.data = { osStatus };
  }
}

function check(result: KeychainResult): KeychainResult {
  if (result.error) throw new KeychainError(result.error, result.osStatus);
  return result;
}

/** The secure-value calls the shared session storage expects. */
export const hyperKeychain = {
  async getSecureValue({ key }: { key: string }): Promise<{ value: string | null }> {
    return { value: check(await native().getValue(key)).value ?? null };
  },
  async setSecureValue({ key, value }: { key: string; value: string }): Promise<void> {
    check(await native().setValue(key, value));
  },
  async removeSecureValue({ key }: { key: string }): Promise<void> {
    check(await native().removeValue(key));
  },
};
