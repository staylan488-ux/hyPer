// The weekly weight rate as a summary shows it: one decimal ("+0.3 lb/wk").
// The shared weeklyRateLabel keeps two for the web; Body weight's chart line
// and You's card both use this, so they round alike.
import { kgToUnit, type WeightUnit } from '@/lib/weightDisplayCore';

/** "+0.3 lb/wk", "−0.5 kg/wk", or null without a rate. A rate that rounds to flat has no sign. */
export function summaryRateLabel(kgPerWeek: number | null, unit: WeightUnit): string | null {
  if (kgPerWeek === null || !Number.isFinite(kgPerWeek)) return null;
  const shown = Math.abs(kgToUnit(kgPerWeek, unit)).toFixed(1);
  const sign = Number(shown) === 0 ? '' : kgPerWeek > 0 ? '+' : '−';
  return `${sign}${shown} ${unit}/wk`;
}
