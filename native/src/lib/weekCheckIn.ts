// The Monday check-in on Today and its Last week screen: one read of the week
// before, kept for the signed-in account until the day moves on. The rules
// are the shared src/lib/weekCheckIn; the card can be put away until next
// Monday, on this phone, per account.
import { create } from 'zustand';

import { captureAccountScope } from '@/lib/accountScope';
import { estimatedMax } from '@/lib/movementHistory';
import { summarizeWeekVolume } from '@/lib/todayModel';
import {
  checkInWeek, paceCall, readWeekCheckIn, type WeekCheckIn, type WeekRecord, type WeekWeight,
} from '@/lib/weekCheckIn';
import { formatWeight, kgToUnit, type WeightUnit } from '@/lib/weightDisplayCore';
import { useAppStore } from '@/stores/appStore';
import { useAuthStore } from '@/stores/authStore';
import type { MuscleVolume } from '@/types';

import { formatLoad, formatWhole } from './format';

type CheckInState = {
  /** Whose week, and which: "<user id>:<Monday>". */
  key: string | null;
  checkIn: WeekCheckIn | null;
  loading: boolean;
  failed: boolean;
  /** The Monday of the week put away on this phone, for the signed-in account. */
  hidden: string | null;
};

export const useWeekCheckInStore = create<CheckInState>(() => ({ key: null, checkIn: null, loading: false, failed: false, hidden: null }));

const hiddenKey = (userId: string) => `hyper:week-check-in-hidden:${userId}`;

function readHidden(userId: string): string | null {
  try {
    return globalThis.localStorage?.getItem(hiddenKey(userId)) ?? null;
  } catch {
    return null;
  }
}

const currentUserId = () => useAuthStore.getState().user?.id ?? null;

let readsStarted = 0;

/**
 * Reads the week before `todayKey` for the signed-in account. A read for
 * another account or week replaces what is kept; a failed read keeps what is
 * shown and says so only while nothing is.
 */
export async function loadWeekCheckIn(todayKey: string): Promise<void> {
  const userId = currentUserId();
  if (!userId) return;
  const key = `${userId}:${checkInWeek(todayKey).start}`;
  const isCurrent = captureAccountScope();
  const read = ++readsStarted;
  const kept = useWeekCheckInStore.getState();
  useWeekCheckInStore.setState({
    key,
    loading: true,
    failed: false,
    hidden: readHidden(userId),
    ...(kept.key === key ? null : { checkIn: null }),
  });
  try {
    const checkIn = await readWeekCheckIn({ userId, todayKey, landmarks: useAppStore.getState().volumeLandmarks });
    if (!isCurrent() || read !== readsStarted) return;
    useWeekCheckInStore.setState({ checkIn, loading: false, failed: false });
  } catch {
    if (!isCurrent() || read !== readsStarted) return;
    useWeekCheckInStore.setState((state) => ({ loading: false, failed: state.checkIn === null }));
  }
}

/** The kept check-in, only when it is the signed-in account's week before `todayKey`. */
export function useWeekCheckIn(todayKey: string): Pick<CheckInState, 'checkIn' | 'loading' | 'failed'> & { hidden: boolean } {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const week = checkInWeek(todayKey).start;
  const state = useWeekCheckInStore();
  const ours = userId !== null && state.key === `${userId}:${week}`;
  return {
    checkIn: ours ? state.checkIn : null,
    loading: ours ? state.loading : true,
    failed: ours && state.failed,
    hidden: ours && state.hidden === week,
  };
}

/** Puts the card away until next Monday, on this phone. */
export function hideWeekCheckIn(todayKey: string) {
  const userId = currentUserId();
  if (!userId) return;
  const week = checkInWeek(todayKey).start;
  try {
    globalThis.localStorage?.setItem(hiddenKey(userId), week);
  } catch {
    // holds until the app closes
  }
  useWeekCheckInStore.setState({ hidden: week });
}

/** Sign-out: nothing of the account stays in memory. */
export function resetWeekCheckIn() {
  readsStarted += 1;
  useWeekCheckInStore.setState({ key: null, checkIn: null, loading: false, failed: false, hidden: null });
}

// ── Words ────────────────────────────────────────────────────────────────

/** "+0.4 lb", "−0.2 kg"; a change that rounds to nothing has no sign ("0.0 lb"). */
export function signedWeight(kilograms: number, unit: WeightUnit): string {
  const shown = Math.abs(kgToUnit(kilograms, unit)).toFixed(1);
  const sign = Number(shown) === 0 ? '' : kilograms > 0 ? '+' : '−';
  return `${sign}${shown} ${unit}`;
}

/** The goal's pace: "+0.5 lb a week". */
export function paceWeekLabel(paceKg: number, unit: WeightUnit): string {
  return `${signedWeight(paceKg, unit)} a week`;
}

/** The week's weight in words: the change and where it sits against the goal's pace, or the average alone. */
export function weightLine(weight: WeekWeight, unit: WeightUnit, paceKg: number | null): { value: string; after: string } {
  if (weight.changeKg === null) return { value: `${formatWeight(weight.averageKg, unit)} ${unit}`, after: ' average' };
  return { value: signedWeight(weight.changeKg, unit), after: paceKg === null ? '' : ` · ${paceCall(weight.changeKg, paceKg)}` };
}

/**
 * What a record beat, named as the movement's Records and Session complete
 * name it: "Est. max 239 lb · was 233", "Heaviest · was 202.5 lb", "Most reps
 * · was 6". Loads are in pounds, as sets are logged.
 */
export function recordDetail(record: WeekRecord): string {
  if (record.kind === 'max') {
    return `Est. max ${formatWhole(estimatedMax(record.set) ?? 0)} lb · was ${formatWhole(estimatedMax(record.previous) ?? 0)}`;
  }
  if (record.kind === 'heaviest') return `Heaviest · was ${formatLoad(record.previous.weight)} lb`;
  return `Most reps · was ${record.previous.reps}`;
}

/** "Under its minimum of 8", "Over its ceiling of 22", or nothing in range. */
export function muscleNote(volume: MuscleVolume): string | undefined {
  if (!volume.landmark) return undefined;
  if (volume.status === 'below_mev') return `Under its minimum of ${volume.landmark.mev}`;
  if (volume.status === 'above_mrv') return `Over its ceiling of ${volume.landmark.mrv}`;
  return undefined;
}

/** "9 of 11 muscles in range", over the graded muscles trained. */
export function musclesInRange(muscles: MuscleVolume[]): string | null {
  const week = summarizeWeekVolume(muscles);
  return week.trained > 0 ? `${week.inRange} of ${week.trained} muscles in range` : null;
}

export type CheckInLine = { label: string; value: string; after: string };

/**
 * Today's card, a line for each thing the week holds: the figure in ink and
 * its words in graphite. Past a target reads as plainly as under it.
 */
export function checkInLines(checkIn: WeekCheckIn, unit: WeightUnit, target: { calories: number; protein: number } | null, paceKg: number | null): CheckInLine[] {
  const lines: CheckInLine[] = [];
  if (checkIn.weight) lines.push({ label: 'Weight', ...weightLine(checkIn.weight, unit, paceKg) });
  if (checkIn.eating) {
    lines.push({ label: 'Calories a day', value: formatWhole(checkIn.eating.calories), after: target ? ` of ${formatWhole(target.calories)} kcal` : ' kcal' });
    lines.push({ label: 'Protein a day', value: formatWhole(checkIn.eating.protein), after: target ? ` of ${formatWhole(target.protein)} g` : ' g' });
  }
  if (checkIn.sets > 0) {
    const range = musclesInRange(checkIn.muscles);
    lines.push({ label: 'Sets', value: formatWhole(checkIn.sets), after: range ? ` · ${range}` : '' });
  }
  if (checkIn.records.length > 0) lines.push({ label: 'Records', value: formatWhole(checkIn.records.length), after: ' new' });
  return lines;
}
