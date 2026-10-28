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
