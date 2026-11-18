// The Fuel reminder's tap asks for the Close the gap sheet (lib/launch.ts);
// Fuel's row answers it (fuel/GapPicks.tsx).
import { create } from 'zustand';

/**
 * The reminder's tap asks for the sheet: Fuel opens it once today's picks are
 * known, and only if there are some. An ask is good for a slow cold launch,
 * never for a later visit.
 */
export const GAP_SHEET_ASK_MS = 20_000;
export const useGapSheetAsk = create<{ askedAt: number | null }>(() => ({ askedAt: null }));
export const askGapSheet = (now = Date.now()) => useGapSheetAsk.setState({ askedAt: now });
/** Takes the ask, once: true while it is still fresh. */
export function takeGapSheetAsk(now = Date.now()): boolean {
  const { askedAt } = useGapSheetAsk.getState();
  if (askedAt === null) return false;
  useGapSheetAsk.setState({ askedAt: null });
  return now - askedAt <= GAP_SHEET_ASK_MS;
}
