import { View } from 'react-native';

import { warnsOverTarget } from '@/lib/fuelSummary';
import type { NutritionGoal } from '@/lib/nutritionCalculator';
import { Track } from '~/components/Track';
import { useBlanc } from '~/theme/blanc';

/**
 * What a day under its date says about its food (Fuel's week strip, the month
 * sheet): a short Track filled to the day's kcal against the calorie target,
 * full once it is met and red past it only where that warns for the goal
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
  return (
    <View style={{ height: 4, alignItems: 'center', justifyContent: 'center' }}>
      {!logged ? null : target && target > 0 && typeof kcal === 'number' ? (
        <View style={{ width: 20 }}>
          <Track progress={kcal / target} warnOver={warnsOverTarget('calories', goal)} />
        </View>
      ) : (
        <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: c.graphite }} />
      )}
    </View>
  );
}
