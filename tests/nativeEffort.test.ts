import { beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';

import { loadNativeModule } from './helpers/loadNativeModule';

// How hard a set was: rated in reps in reserve by default, or RPE by choice,
// and always stored as RPE (native/src/lib/setEntry.ts).

const showActionSheetWithOptions = vi.fn();
type Scale = 'rir' | 'rpe';
const entry = loadNativeModule<{
  chooseRpe: (onChoose: (rpe: number | null) => void) => void;
  chooseEffortScale: (scale: Scale) => void;
  effortChip: (rpe: number | null, scale: Scale) => { label: string; accessibilityLabel: string };
  effortLabel: (rpe: number, scale: Scale) => string;
  useEffortScaleStore: { getState: () => { scale: Scale }; setState: (state: { scale: Scale }) => void };
}>('lib/setEntry.ts', {
  'react-native': { ActionSheetIOS: { showActionSheetWithOptions } },
  './haptics': { haptics: { tap: vi.fn(), select: vi.fn() } },
  zustand: { create },
});

beforeEach(() => {
  showActionSheetWithOptions.mockReset();
  entry.useEffortScaleStore.setState({ scale: 'rir' });
});

describe('rating a set', () => {
  it('asks for reps in reserve by default and saves it as RPE', () => {
    const chosen = vi.fn();
    entry.chooseRpe(chosen);
    const [sheet, pick] = showActionSheetWithOptions.mock.calls[0] as [{ options: string[]; title: string }, (index: number) => void];
    expect(sheet.title).toBe('How many more reps could you have done?');
    expect(sheet.options).toEqual(['Cancel', '0', '1', '2', '3', '4 or more', 'No rating']);
    pick(3);
    expect(chosen).toHaveBeenLastCalledWith(8);
    pick(5);
    expect(chosen).toHaveBeenLastCalledWith(6);
    pick(6);
    expect(chosen).toHaveBeenLastCalledWith(null);
  });

  it('asks for RPE when that is the chosen scale', () => {
    entry.chooseEffortScale('rpe');
    expect(entry.useEffortScaleStore.getState().scale).toBe('rpe');
    entry.chooseRpe(vi.fn());
    const [sheet] = showActionSheetWithOptions.mock.calls[0] as [{ options: string[] }];
    expect(sheet.options[1]).toBe('RPE 6');
  });

  it('shows a stored RPE on either scale, older half steps included', () => {
    expect(entry.effortLabel(8, 'rir')).toBe('RIR 2');
    expect(entry.effortLabel(8.5, 'rir')).toBe('RIR 1.5');
    expect(entry.effortLabel(6, 'rir')).toBe('RIR 4+');
    expect(entry.effortLabel(8, 'rpe')).toBe('RPE 8');
    expect(entry.effortChip(9, 'rir')).toEqual({ label: 'RIR 1', accessibilityLabel: '1 rep in reserve. Change' });
    expect(entry.effortChip(null, 'rir')).toEqual({ label: 'Add RIR', accessibilityLabel: 'Add reps in reserve' });
    expect(entry.effortChip(null, 'rpe')).toEqual({ label: 'Add RPE', accessibilityLabel: 'Add RPE' });
  });
});
