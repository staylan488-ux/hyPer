import { View } from 'react-native';

import { warnsOverTarget } from '@/lib/fuelSummary';
import type { NutritionGoal } from '@/lib/nutritionCalculator';
import { useBlanc } from '~/theme/blanc';

/**
 * The mark's size: wide enough that 88% and a met target look different,
 * and narrow enough for seven columns at every text size (the strip's cells
 * are 46 pt and the month's 44, neither growing with the text).
 */
export const DAY_MARK = { width: 28, height: 4 } as const;

/**
 * What a day under its date says about its food (Fuel's week strip, the month
 * sheet): a short bar filled in ink to the day's kcal against the calorie
 * target, the rest of it in `mark` so what is left reads too. Full in ink once
 * the target is met, and all red past it only where that warns for the goal
 * (never while gaining). A dot when there is nothing to measure against (no
 * target, or only the day's dates are known); nothing on a day with no entries.
 */
export function DayMark({ logged, kcal, target, goal }: {
  logged: boolean;
  kcal?: number | null;
  target?: number | null;
  goal?: NutritionGoal | null;
}) {
  const c = useBlanc();
  const progress = target && target > 0 && typeof kcal === 'number' ? kcal / target : null;
  const over = progress !== null && progress > 1 && warnsOverTarget('calories', goal);
  const filled = Math.max(0, Math.min(1, progress ?? 0));
  return (
    <View style={{ height: DAY_MARK.height, alignItems: 'center', justifyContent: 'center' }}>
      {!logged ? null : progress !== null ? (
        <View
          style={{
            width: DAY_MARK.width,
            height: DAY_MARK.height,
            borderRadius: DAY_MARK.height / 2,
            overflow: 'hidden',
            flexDirection: 'row',
            backgroundColor: over ? c.live : c.mark,
          }}>
          {over ? null : <View style={{ width: `${filled * 100}%`, height: DAY_MARK.height, backgroundColor: c.ink }} />}
        </View>
      ) : (
        <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: c.graphite }} />
      )}
    </View>
  );
}
