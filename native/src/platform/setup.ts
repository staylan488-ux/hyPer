// Runs before any shared module (see index.ts).
//
// The shared stores keep small preferences and sync cursors in the browser's
// localStorage. Expo SQLite provides the same synchronous API on device.
import 'expo-sqlite/localStorage/install';

import { CryptoDigestAlgorithm, digest, getRandomValues, randomUUID } from 'expo-crypto';

// React Native has no Web Crypto. Once `crypto` exists, code expects its
// parts to work, so each one used here comes from expo-crypto:
// - randomUUID: shared code's retry-safe ids (session swaps, food entries).
// - getRandomValues: supabase-js's PKCE verifier for Google and Apple sign-in.
// - subtle.digest (SHA-256 only): supabase-js's PKCE code challenge. Without it
//   supabase-js falls back to the weaker "plain" challenge.
const globalCrypto = ((globalThis as { crypto?: Partial<Crypto> }).crypto ??= {});
if (typeof globalCrypto.randomUUID !== 'function') {
  globalCrypto.randomUUID = randomUUID as Crypto['randomUUID'];
}
if (typeof globalCrypto.getRandomValues !== 'function') {
  globalCrypto.getRandomValues = getRandomValues as Crypto['getRandomValues'];
}
if (!globalCrypto.subtle) {
  (globalCrypto as { subtle?: SubtleCrypto }).subtle = {
    digest: async (algorithm: AlgorithmIdentifier, data: BufferSource) => {
      const name = typeof algorithm === 'string' ? algorithm : algorithm.name;
      if (name.toUpperCase() !== CryptoDigestAlgorithm.SHA256) {
        throw new Error(`crypto.subtle.digest supports SHA-256 only, not ${name}`);
      }
      return digest(CryptoDigestAlgorithm.SHA256, data);
    },
  } as SubtleCrypto;
}

// The Gemini food analyzer (src/lib/foodTrial) bounds its request with
// AbortSignal.timeout and copies its preview fixture with structuredClone;
// Hermes may lack either.
if (typeof (AbortSignal as { timeout?: unknown }).timeout !== 'function') {
  (AbortSignal as unknown as { timeout: (ms: number) => AbortSignal }).timeout = (ms: number) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new Error('The operation timed out.')), ms);
    return controller.signal;
  };
}
if (typeof globalThis.structuredClone !== 'function') {
  globalThis.structuredClone = (<T>(value: T): T => JSON.parse(JSON.stringify(value)) as T) as typeof structuredClone;
}
