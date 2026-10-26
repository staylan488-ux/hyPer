// Runs before any shared module (see index.ts).
//
// The shared stores keep small preferences and sync cursors in the browser's
// localStorage. Expo SQLite provides the same synchronous API on device.
import 'expo-sqlite/localStorage/install';

import { randomUUID } from 'expo-crypto';

// Shared code creates retry-safe ids with crypto.randomUUID(), which React
// Native does not provide (session swaps, new food entries, meal ingredients).
const globalCrypto = ((globalThis as { crypto?: Partial<Crypto> }).crypto ??= {});
if (typeof globalCrypto.randomUUID !== 'function') {
  globalCrypto.randomUUID = randomUUID as Crypto['randomUUID'];
}
