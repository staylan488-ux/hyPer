import { router } from 'expo-router';
import Animated from 'react-native-reanimated';

import { goalPaceKg, hasCheckIn, type WeekCheckIn } from '@/lib/weekCheckIn';
import { useAppStore } from '@/stores/appStore';
import { rowEnter } from '~/lib/motion';
import { checkInLines, hideWeekCheckIn } from '~/lib/weekCheckIn';
import { useWeightStore } from '~/lib/you';

import { Hairline, Row } from './Row';
import { SwipeRow } from './SwipeRow';

/**
 * Monday's look back at the week before, as one row under Today's Progress:
 * the first thing the week holds (its weight, when it has one), opening Last
 * week, where the rest is. A swipe puts it away until next Monday (a hold
 * lifts the whole group, to move it). Nothing shows until the week is read,
 * or when it holds nothing.
 */
export function WeekCheckInRow({ checkIn, todayKey }: { checkIn: WeekCheckIn; todayKey: string }) {
  const unit = useWeightStore((state) => state.unit);
  const target = useAppStore((state) => state.macroTarget);
  const profile = useAppStore((state) => state.nutritionProfile);
  if (!hasCheckIn(checkIn)) return null;

  const paceKg = checkIn.weight ? goalPaceKg(profile, checkIn.weight.averageKg) : null;
  const line = checkInLines(checkIn, unit, target, paceKg)[0];
  if (!line) return null;
  // The week's weight needs no name beside "Last week"; any other figure keeps its own ("Sets 24").
  const value = line.label === 'Weight' ? `${line.value}${line.after}` : `${line.label} ${line.value}${line.after}`;

  return (
    <Animated.View entering={rowEnter}>
      <Hairline />
      {/* Hide, also as the row's VoiceOver action. */}
      <SwipeRow name="Last week" actions={[{ label: 'Hide', destructive: true, onPress: () => hideWeekCheckIn(todayKey) }]}>
        <Row title="Last week" value={value} chevron onPress={() => router.push('/today/week')} />
      </SwipeRow>
    </Animated.View>
  );
}
