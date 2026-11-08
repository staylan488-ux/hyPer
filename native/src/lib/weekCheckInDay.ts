// Whether Today shows the Monday check-in. Apart from the rest of
// ./weekCheckIn because it reads debug launch arguments through React Native.
import { isCheckInDay } from '@/lib/weekCheckIn';
import { readDevLaunch } from '~/platform/devLaunch';

/** Debug builds only: `-hyperAction weekCheckIn` shows Monday's card on any day, for a simulator check. */
const devMonday = readDevLaunch().action === 'weekCheckIn';

/** Mondays (any day in a debug check launched for it). */
export function isCheckInToday(todayKey: string): boolean {
  return devMonday || isCheckInDay(todayKey);
}
