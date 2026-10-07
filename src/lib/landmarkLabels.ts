/**
 * Where the MAV name sits on a landmark rail. MEV and MRV are named under
 * their ticks; the adaptive band's name ("MAV 12–18") goes under the band's
 * centre, slid along the rail as far as it needs to clear both neighbours.
 * Only when even that leaves no room does it fall back to "MAV", or drop out.
 */
export interface LandmarkLabelInput {
  mev: number;
  mavLow: number;
  mavHigh: number;
  mrv: number;
  /** Position of a value along the rail, 0–1. */
  share: (value: number) => number;
  /** Rail width in px. */
  rail: number;
}

/** Width of one 10px tracked tabular character, px. */
const CHAR = 6.6;
/** Clear space between neighbouring names, px (about two characters, so
 * "MEV 12" and "MAV 14–20" never read as one run). */
const GAP = 14;
/** The least clear space for the bare "MAV" fallback, px. */
const MIN_GAP = 8;
/** Below this share the MEV name starts at its tick instead of centring. */
export const LEADING_SHARE = 0.08;

const width = (text: string) => text.length * CHAR;

export function mavLabelPlacement({ mev, mavLow, mavHigh, mrv, share, rail }: LandmarkLabelInput): { text: string; x: number } | null {
  const mevText = `MEV ${mev}`;
  const mrvText = `MRV ${mrv}`;
  const mevX = share(mev) * rail;
  const mevRight = share(mev) < LEADING_SHARE ? mevX + width(mevText) : mevX + width(mevText) / 2;
  const mrvLeft = share(mrv) * rail - width(mrvText) / 2;
  const centre = share((mavLow + mavHigh) / 2) * rail;
  // The full name keeps a generous gap; the bare "MAV" fallback, the last
  // resort before dropping the name, may sit closer.
  for (const [text, gap] of [[`MAV ${mavLow}–${mavHigh}`, GAP], ['MAV', MIN_GAP]] as const) {
    const low = mevRight + gap;
    const high = mrvLeft - gap;
    const half = width(text) / 2;
    if (high - low >= half * 2) return { text, x: Math.min(high - half, Math.max(low + half, centre)) };
  }
  return null;
}
