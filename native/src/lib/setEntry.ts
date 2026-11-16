// Entering a set's numbers, the same way wherever a set is logged or edited.
import { ActionSheetIOS } from 'react-native';
import { create } from 'zustand';

import { haptics } from './haptics';

export const RPE_CHOICES = [6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10];

// ── How hard a set was: reps in reserve (the default) or RPE ────────────
// Stored as RPE whatever the scale (2 in reserve = RPE 8), so the history,
// the set targets and the database read one number. The scale is a
// per-phone choice in You › App.

export type EffortScale = 'rir' | 'rpe';
const SCALE_KEY = 'hyper.effortScale';

function storedScale(): EffortScale {
  try {
    return globalThis.localStorage?.getItem(SCALE_KEY) === 'rpe' ? 'rpe' : 'rir';
  } catch {
    return 'rir';
  }
}

export const useEffortScaleStore = create<{ scale: EffortScale }>(() => ({ scale: storedScale() }));

export function chooseEffortScale(scale: EffortScale) {
  try {
    globalThis.localStorage?.setItem(SCALE_KEY, scale);
  } catch {
    // The choice still applies until the app closes.
  }
  useEffortScaleStore.setState({ scale });
}

export const EFFORT_SCALE_LABELS: Record<EffortScale, string> = { rir: 'Reps in reserve', rpe: 'RPE' };

/** Reps in reserve chosen in whole reps; 4+ covers everything easier. */
export const RIR_CHOICES = [0, 1, 2, 3, 4] as const;
export const rirToRpe = (rir: number) => 10 - rir;
const rirFromRpe = (rpe: number) => Math.max(0, Math.round((10 - rpe) * 10) / 10);

/** A stored RPE as the scale shows it: "RIR 2", "RIR 4+", or "RPE 8". */
export function effortLabel(rpe: number, scale: EffortScale): string {
  if (scale === 'rpe') return `RPE ${rpe}`;
  const rir = rirFromRpe(rpe);
  return `RIR ${rir >= 4 ? '4+' : rir}`;
}

/** The same, as VoiceOver should say it: "2 reps in reserve". */
export function effortSpoken(rpe: number, scale: EffortScale): string {
  if (scale === 'rpe') return `RPE ${rpe}`;
  const rir = rirFromRpe(rpe);
  if (rir >= 4) return '4 or more reps in reserve';
  return `${rir} ${rir === 1 ? 'rep' : 'reps'} in reserve`;
}

/** The chip that rates a set: "Add RIR" or "RIR 2", and what VoiceOver says for it. */
export function effortChip(rpe: number | null | undefined, scale: EffortScale): { label: string; accessibilityLabel: string } {
  if (rpe) return { label: effortLabel(rpe, scale), accessibilityLabel: `${effortSpoken(rpe, scale)}. Change` };
  return scale === 'rpe' ? { label: 'Add RPE', accessibilityLabel: 'Add RPE' } : { label: 'Add RIR', accessibilityLabel: 'Add reps in reserve' };
}

/** A typed weight or rep count: zero or more, with a comma read as a decimal point. */
export const parseNumber = (text: string) => {
  const value = Number.parseFloat(text.replace(',', '.'));
  return Number.isFinite(value) && value >= 0 ? value : null;
};

/** A bodyweight movement carries no load of its own. */
export const isBodyweight = (exercise: { equipment: string | null } | null | undefined) =>
  exercise?.equipment?.trim().toLowerCase() === 'bodyweight';

/** The weight a set logs: as typed, or 0 when left empty on a bodyweight movement. */
export const weightToLog = (text: string, bodyweight: boolean) =>
  bodyweight && text.trim() === '' ? 0 : parseNumber(text);

/**
 * Asks how hard the set was, on the person's scale: reps in reserve from 0 to
 * 4+ (saved as RPE 10 to 6), or an RPE from 6 to 10; or none.
 */
export function chooseRpe(onChoose: (rpe: number | null) => void) {
  haptics.tap();
  if (useEffortScaleStore.getState().scale === 'rir') {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: 'How many more reps could you have done?',
        message: 'Reps in reserve: 0 means nothing left, 2 means two more were possible.',
        options: ['Cancel', ...RIR_CHOICES.map((value) => (value === 4 ? '4 or more' : String(value))), 'No rating'],
        cancelButtonIndex: 0,
      },
      (index) => {
        if (index === 0) return;
        haptics.select();
        onChoose(index <= RIR_CHOICES.length ? rirToRpe(RIR_CHOICES[index - 1]) : null);
      },
    );
    return;
  }
  ActionSheetIOS.showActionSheetWithOptions(
    {
      title: 'How hard was that set?',
      // The scale in words, for anyone new to RPE.
      message: '10 means no reps left. 9 means 1 more was possible, 8 means 2, 7 means 3.',
      options: ['Cancel', ...RPE_CHOICES.map((value) => `RPE ${value}`), 'No RPE'],
      cancelButtonIndex: 0,
    },
    (index) => {
      if (index === 0) return;
      haptics.select();
      onChoose(index <= RPE_CHOICES.length ? RPE_CHOICES[index - 1] : null);
    },
  );
}
