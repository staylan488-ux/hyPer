// The words on a movement's history page. Pure, so the root test suite covers
// them (tests/nativeMovementHistory.test.ts).
import { format, parseISO } from 'date-fns';

import { isBodyweightSet, type MovementHistory, type MovementMode, type SetFigures, type TrendPoint } from '@/lib/movementHistory';

import { formatSet, formatWhole } from './format';

/** "Sat, Nov 8" this year, "Nov 8, 2025" before it, "Today" today. */
export function sessionDate(day: string, todayKey: string): string {
  if (day === todayKey) return 'Today';
  const date = parseISO(day);
  return day.slice(0, 4) === todayKey.slice(0, 4) ? format(date, 'EEE, MMM d') : format(date, 'MMM d, yyyy');
}

/**
 * A session's sets on one line, in order: "225 × 5 · 225 × 5 · 215 × 6",
 * or "12 · 10 · 8 reps" when none moved a load. A 0 × 0 set (a hold, a miss)
 * stays, as it was logged.
 */
export function setsLine(sets: SetFigures[]): string {
  if (sets.length === 0) return '';
  if (sets.every((set) => set.weight === 0)) {
    const reps = sets.map((set) => String(set.reps));
    const last = sets[sets.length - 1].reps;
    return `${reps.join(' · ')} ${sets.length === 1 && last === 1 ? 'rep' : 'reps'}`;
  }
  return sets.map((set) => formatSet(set.weight, set.reps, { unit: false })).join(' · ');
}

/** A trend point read on the chart: "225 lb × 5 · est. max 262 lb", "225 lb × 1", or "14 reps". */
export function trendPointLabel(point: Pick<TrendPoint, 'set' | 'value'>, mode: MovementMode): string {
  const set = formatSet(point.set.weight, point.set.reps);
  if (mode === 'reps' || point.set.reps === 1) return set;
  return `${set} · est. max ${formatWhole(point.value)} lb`;
}

const signed = (value: number) => (value > 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : '0');

/**
 * The chart's resting line, first session to latest: "+15 lb since Mar 4",
 * "+3 reps since Mar 4", or "Level since Mar 4". Empty with under two sessions.
 */
export function trendSummary(history: Pick<MovementHistory, 'trend' | 'mode'>, todayKey: string): string {
  const { trend, mode } = history;
  if (trend.length < 2) return '';
  const first = trend[0];
  const change = Math.round(trend[trend.length - 1].value - first.value);
  const since = `since ${first.day.slice(0, 4) === todayKey.slice(0, 4) ? format(parseISO(first.day), 'MMM d') : format(parseISO(first.day), 'MMM d, yyyy')}`;
  if (change === 0) return `Level ${since}`;
  const unit = mode === 'load' ? 'lb' : Math.abs(change) === 1 ? 'rep' : 'reps';
  return `${signed(change)} ${unit} ${since}`;
}

export type RecordRow = { key: string; title: string; value: string; day: string; detail?: string };

/**
 * The Records rows: the estimated max with the set that made it, the
 * heaviest load (left out when it is that same set), and the most
 * bodyweight reps. Each names its day.
 */
export function recordRows(records: MovementHistory['records'], todayKey: string): RecordRow[] {
  const rows: RecordRow[] = [];
  const { estMax, heaviest, mostReps } = records;
  if (estMax) {
    const single = estMax.reps === 1;
    rows.push({
      key: 'max',
      title: 'Est. max',
      value: `${formatWhole(estMax.value)} lb`,
      day: estMax.day,
      // A single is its own max: the set would only repeat the figure.
      detail: [single ? null : formatSet(estMax.weight, estMax.reps), sessionDate(estMax.day, todayKey)].filter(Boolean).join(' · '),
    });
  }
  const sameSet = heaviest && estMax && heaviest.workoutId === estMax.workoutId && heaviest.weight === estMax.weight && heaviest.reps === estMax.reps;
  if (heaviest && !sameSet) {
    rows.push({ key: 'heaviest', title: 'Heaviest', value: formatSet(heaviest.weight, heaviest.reps), day: heaviest.day, detail: sessionDate(heaviest.day, todayKey) });
  }
  if (mostReps && isBodyweightSet(mostReps)) {
    rows.push({ key: 'reps', title: 'Most reps', value: formatSet(0, mostReps.reps), day: mostReps.day, detail: sessionDate(mostReps.day, todayKey) });
  }
  return rows;
}

/** The figure at the top: the latest session's estimated max (lb) or most reps, with what it is. */
export function latestFigure(history: Pick<MovementHistory, 'trend' | 'mode'>): { figure: string; unit: string; what: string } | null {
  const latest = history.trend[history.trend.length - 1];
  if (!latest) return null;
  if (history.mode === 'reps') return { figure: String(latest.value), unit: latest.value === 1 ? 'rep' : 'reps', what: 'Most reps' };
  return { figure: formatWhole(latest.value), unit: 'lb', what: 'Est. max' };
}
