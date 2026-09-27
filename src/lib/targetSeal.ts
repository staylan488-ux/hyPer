/**
 * "Sealed" nutrition targets: the moment a day's protein or calories land.
 * Protein counts once it reaches the target; calories count inside a band
 * around it, because blowing past a calorie target is not an achievement.
 * Each macro celebrates at most once per day per device.
 */

export type SealMacro = 'calories' | 'protein';

const CALORIE_BAND: [number, number] = [0.97, 1.05];
const STORAGE_PREFIX = 'hyper:seal:';

export function isTargetMet(macro: SealMacro, current: number, target: number): boolean {
  if (!(target > 0) || !Number.isFinite(current)) return false;
  if (macro === 'protein') return current >= target;
  return current >= target * CALORIE_BAND[0] && current <= target * CALORIE_BAND[1];
}

interface SealStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
  readonly length: number;
}

function defaultStorage(): SealStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Claim today's celebration for a macro. True exactly once per `dayKey`
 * (YYYY-MM-DD) and macro; claims from other days are pruned. Without storage
 * the claim still succeeds so the moment is never silently lost.
 */
export function claimSealCelebration(dayKey: string, macro: SealMacro, storage: SealStorage | null = defaultStorage()): boolean {
  const key = `${STORAGE_PREFIX}${dayKey}:${macro}`;
  if (!storage) return true;
  try {
    if (storage.getItem(key)) return false;
    const stale: string[] = [];
    for (let i = 0; i < storage.length; i += 1) {
      const existing = storage.key(i);
      if (existing?.startsWith(STORAGE_PREFIX) && !existing.startsWith(`${STORAGE_PREFIX}${dayKey}:`)) stale.push(existing);
    }
    stale.forEach((entry) => storage.removeItem(entry));
    storage.setItem(key, '1');
    return true;
  } catch {
    return true;
  }
}
