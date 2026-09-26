import { describe, expect, it } from 'vitest';
import { claimSealCelebration, isTargetMet } from '../src/lib/targetSeal';

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    key: (index: number) => [...map.keys()][index] ?? null,
    get length() { return map.size; },
    map,
  };
}

describe('target seal', () => {
  it('meets protein at or above target', () => {
    expect(isTargetMet('protein', 189, 190)).toBe(false);
    expect(isTargetMet('protein', 190, 190)).toBe(true);
    expect(isTargetMet('protein', 260, 190)).toBe(true);
  });

  it('meets calories only inside the band around target', () => {
    expect(isTargetMet('calories', 2500, 2600)).toBe(false);
    expect(isTargetMet('calories', 2530, 2600)).toBe(true);
    expect(isTargetMet('calories', 2720, 2600)).toBe(true);
    expect(isTargetMet('calories', 2800, 2600)).toBe(false);
  });

  it('never meets a missing target', () => {
    expect(isTargetMet('protein', 50, 0)).toBe(false);
    expect(isTargetMet('calories', Number.NaN, 2000)).toBe(false);
  });

  it('celebrates each macro once per day and prunes older days', () => {
    const storage = memoryStorage();
    expect(claimSealCelebration('2026-09-25', 'protein', storage)).toBe(true);
    expect(claimSealCelebration('2026-09-25', 'protein', storage)).toBe(false);
    expect(claimSealCelebration('2026-09-26', 'protein', storage)).toBe(true);
    expect(claimSealCelebration('2026-09-26', 'calories', storage)).toBe(true);
    expect([...storage.map.keys()].sort()).toEqual(['hyper:seal:2026-09-26:calories', 'hyper:seal:2026-09-26:protein']);
  });

  it('still celebrates when storage is unavailable', () => {
    expect(claimSealCelebration('2026-09-26', 'protein', null)).toBe(true);
    const broken = { ...memoryStorage(), getItem: () => { throw new Error('denied'); } };
    expect(claimSealCelebration('2026-09-26', 'protein', broken)).toBe(true);
  });
});
