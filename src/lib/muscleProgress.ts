/**
 * Progress's words for the live week: what is done and what is next, never
 * what was missed (owner decision, 2026-11-12). Band words appear only about
 * the program's design, never about the person's own weeks.
 */
import {
  MAIN_MUSCLES,
  VOLUME_BAND_LABELS,
  formatSetCount,
  isMainMuscle,
  muscleLabel,
  volumeBand,
  type MuscleSets,
} from '@/lib/muscleVolume';

const sessionsWord = (count: number) => (count === 1 ? 'session' : 'sessions');
const setsWord = (count: string) => (count === '1' ? 'set' : 'sets');

/**
 * The week in a few words: "3 sessions done. Legs A is next.", "All 6
 * sessions done.", "Push A is next." Null when there is nothing to say yet.
 */
export function weekLine(input: { done: number | null | undefined; target: number | null | undefined; next: string | null | undefined }): string | null {
  const done = input.done ?? 0;
  const target = input.target ?? null;
  if (target && done === target) return target === 1 ? 'This week’s session is done.' : `All ${target} sessions done.`;
  const parts: string[] = [];
  if (done > 0) parts.push(`${done} ${sessionsWord(done)} done.`);
  if (input.next && !(target && done >= target)) parts.push(`${input.next} is next.`);
  return parts.length ? parts.join(' ') : null;
}

export interface MuscleProgressRow {
  muscle: string;
  label: string;
  done: number;
  /** Planned this week; null with no plan. */
  planned: number | null;
  main: boolean;
}

/**
 * The week's muscles: every one planned or trained, most planned first, then
 * most done, then the main muscles' order.
 */
export function muscleProgressRows(done: MuscleSets, planned: MuscleSets | null): MuscleProgressRow[] {
  const muscles = new Set<string>();
  for (const [muscle, sets] of done) if (sets > 0) muscles.add(muscle);
  for (const [muscle, sets] of planned ?? []) if (sets > 0) muscles.add(muscle);
  const order = (muscle: string) => {
    const index = (MAIN_MUSCLES as readonly string[]).indexOf(muscle);
    return index < 0 ? MAIN_MUSCLES.length : index;
  };
  return [...muscles]
    .map((muscle) => ({
      muscle,
      label: muscleLabel(muscle),
      done: done.get(muscle) ?? 0,
      planned: planned ? planned.get(muscle) ?? 0 : null,
      main: isMainMuscle(muscle),
    }))
    .sort((a, b) => (b.planned ?? 0) - (a.planned ?? 0) || b.done - a.done || order(a.muscle) - order(b.muscle) || a.label.localeCompare(b.label));
}

/** "3 of 6 planned", or "3 sets" when nothing was planned for it. */
export function doneOfPlanned(done: number, planned: number | null): string {
  const count = formatSetCount(done);
  if (planned && planned > 0) return `${count} of ${formatSetCount(planned)} planned`;
  return `${count} ${setsWord(count)}`;
}

/** The share of the planned sets done, for the row's Track; null with nothing planned. */
export function plannedShare(done: number, planned: number | null): number | null {
  return planned && planned > 0 ? Math.min(1, done / planned) : null;
}

/**
 * The program's week for one muscle: "6 sets a week in the program, solid".
 * Only a main muscle takes a band word; any other is a plain count.
 */
export function programWeekLine(muscle: string, sets: number): string {
  if (!(sets > 0)) return 'Not in the program';
  const count = formatSetCount(sets);
  const band = isMainMuscle(muscle) ? `, ${VOLUME_BAND_LABELS[volumeBand(sets)].toLowerCase()}` : '';
  return `${count} ${setsWord(count)} a week in the program${band}`;
}

/** The usual week for one muscle, a plain figure with no band and no comparison: "About 3.5 sets a week lately". */
export function usualWeekLine(sets: number | undefined): string | null {
  if (!sets) return null;
  const count = formatSetCount(sets);
  if (count === '0') return null;
  return `About ${count} ${setsWord(count)} a week lately`;
}

// ── A program's design ──────────────────────────────────────────────

/** A muscle's sets in a program's list: "8.5 · solid" for a main muscle, the plain count for any other. */
export function programMuscleValue(row: { muscle: string; sets: number }): string {
  const count = formatSetCount(row.sets);
  return isMainMuscle(row.muscle) ? `${count} · ${VOLUME_BAND_LABELS[volumeBand(row.sets)].toLowerCase()}` : count;
}

/** A program's sets per week in one line: "Every main muscle is solid", "Side delts is low", "3 main muscles are low". */
export function programVolumeLine(lowLabels: readonly string[]): string {
  if (lowLabels.length === 0) return 'Every main muscle is solid';
  if (lowLabels.length === 1) return `${lowLabels[0]} is low`;
  if (lowLabels.length === 2) return `${lowLabels[0]} and ${lowLabels[1].toLowerCase()} are low`;
  return `${lowLabels.length} main muscles are low`;
}
