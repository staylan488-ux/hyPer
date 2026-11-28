// Pure meal helpers, covered by tests/nativeSessionModel.test.ts.
import { isSameDay, subDays } from 'date-fns';

import type { NutritionLog } from '@/types';

export type MealType = NonNullable<NutritionLog['meal_type']>;

/** Small hours (00:00–03:59): entries stay in No meal and Yesterday defaults to the live clock. */
export const LATE_NIGHT_END_HOUR = 4;

/** True during the small hours after midnight (00:00–03:59) in local time. */
export function isLateNightTime(date = new Date()): boolean {
  return date.getHours() < LATE_NIGHT_END_HOUR;
}

/**
 * The named meal that fits this local time, or null in the small hours
 * (00:00–03:59), which belong to No meal.
 * - Breakfast: 04:00–10:59
 * - Lunch: 11:00–15:59
 * - Dinner: 16:00–23:59
 */
export function mealForTime(date = new Date()): MealType | null {
  const minutes = date.getHours() * 60 + date.getMinutes();
  if (minutes < LATE_NIGHT_END_HOUR * 60) return null;
  if (minutes < 11 * 60) return 'breakfast';
  if (minutes < 16 * 60) return 'lunch';
  return 'dinner';
}

/**
 * Whether a new entry on `entryDay` should default its time to the live clock:
 * always on today, and also on yesterday during the small hours (00:00–03:59).
 */
export function usesLiveClockForDay(entryDay: Date, now = new Date()): boolean {
  if (isSameDay(entryDay, now)) return true;
  return isSameDay(entryDay, subDays(now, 1)) && isLateNightTime(now);
}
