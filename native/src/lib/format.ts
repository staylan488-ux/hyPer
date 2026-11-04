const whole = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const tenths = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });

/** 1258 -> "1,258". */
export const formatWhole = (value: number) => whole.format(Math.round(value));

/** 102.5 -> "102.5", 80 -> "80". */
export const formatLoad = (value: number | null | undefined) =>
  value === null || value === undefined || !Number.isFinite(value) ? '–' : tenths.format(value);

/** Seconds -> "1:05" or "12:03" or "1:02:03". */
export function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** "8–10 reps", "10 reps", or null without a plan. */
export function formatRepRange(min?: number | null, max?: number | null): string | null {
  if (!min && !max) return null;
  if (min && max && min !== max) return `${min}–${max} reps`;
  return `${min || max} reps`;
}

const finite = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value);

/**
 * A set as the app writes it: "80 lb × 10" ("80 × 10" with `unit: false`),
 * "10 reps" for a set with no load (bodyweight never reads "0 lb"), "80 lb"
 * before reps are known, and "" with neither.
 */
export function formatSet(weight: number | null | undefined, reps: number | null | undefined, opts?: { unit?: boolean }): string {
  const load = finite(weight) && weight > 0 ? `${formatLoad(weight)}${opts?.unit === false ? '' : ' lb'}` : null;
  if (!finite(reps)) return load ?? '';
  return load ? `${load} × ${reps}` : `${reps} ${reps === 1 ? 'rep' : 'reps'}`;
}

/** A target: "4 × 8–10", "4 × 8" (equal reps), "3–5 × 8–12" with a set range, "4 sets" without reps. */
export function formatTarget(
  sets: number,
  repMin?: number | null,
  repMax?: number | null,
  setRange?: { min: number; max: number } | null,
): string {
  const ranged = setRange && setRange.min !== setRange.max;
  const count = ranged ? `${setRange.min}–${setRange.max}` : String(sets);
  const low = finite(repMin) && repMin > 0 ? repMin : null;
  const high = finite(repMax) && repMax > 0 ? repMax : null;
  if (low === null && high === null) return `${count} ${!ranged && sets === 1 ? 'set' : 'sets'}`;
  const reps = low !== null && high !== null && low !== high ? `${low}–${high}` : String(low ?? high);
  return `${count} × ${reps}`;
}

/** Minutes -> "23 min", "1 h", "1 h 5 min". */
export function formatMinutes(minutes: number): string {
  if (minutes <= 0) return '0 min';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h === 0 ? `${m} min` : m === 0 ? `${h} h` : `${h} h ${m} min`;
}
