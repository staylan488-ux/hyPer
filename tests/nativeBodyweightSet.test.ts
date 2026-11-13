import { describe, expect, it, vi } from 'vitest';

import { loadNativeModule } from './helpers/loadNativeModule';

// Train's Log set (native/src/app/(tabs)/train/index.tsx) needs a weight. A
// first-time bodyweight movement has none to fill in from last time, and it
// carries no load, so an empty weight logs as 0 there. A loaded movement still
// needs its weight.

const { isBodyweight, weightToLog } = loadNativeModule<{
  isBodyweight: (exercise: { equipment: string | null } | null | undefined) => boolean;
  weightToLog: (text: string, bodyweight: boolean) => number | null;
}>('lib/setEntry.ts', {
  'react-native': { ActionSheetIOS: { showActionSheetWithOptions: vi.fn() } },
  './haptics': { haptics: { tap: vi.fn(), select: vi.fn() } },
  zustand: { create: () => () => undefined },
});

describe('the weight a set logs', () => {
  it('is 0 when left empty on a bodyweight movement', () => {
    expect(weightToLog('', true)).toBe(0);
    expect(weightToLog('  ', true)).toBe(0);
  });

  it('is what was typed on a bodyweight movement, extra load included', () => {
    expect(weightToLog('25', true)).toBe(25);
    expect(weightToLog('12,5', true)).toBe(12.5);
  });

  it('is still needed on a loaded movement', () => {
    expect(weightToLog('', false)).toBeNull();
    expect(weightToLog('135', false)).toBe(135);
  });

  it('knows a bodyweight movement by its equipment, however it is written', () => {
    expect(isBodyweight({ equipment: 'bodyweight' })).toBe(true);
    expect(isBodyweight({ equipment: 'Bodyweight' })).toBe(true);
    expect(isBodyweight({ equipment: 'Barbell' })).toBe(false);
    expect(isBodyweight({ equipment: null })).toBe(false);
    expect(isBodyweight(undefined)).toBe(false);
  });
});
