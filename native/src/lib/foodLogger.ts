// The Log food sheet's saving rules, on the shared helpers
// (src/lib/saveNutritionEntry, foodPersistence, manualFood, photoReview,
// saveMealComposition).
import { format, isSameDay, startOfDay } from 'date-fns';

import { toLocalTimeInput } from '@/lib/foodLoggerUtils';
import { entryWriteId, type PendingEntryId } from '@/lib/pendingEntryId';
import { buildEntryPayload, persistNutritionEntry } from '@/lib/saveNutritionEntry';
import { supabase } from '@/lib/supabase';
import type { NutritionGroup } from '@/types';

import { useFuelStore, type FoodLog } from './fuel';
import { usesLiveClockForDay } from './meals';

/** When an entry is logged and where it goes. */
export type When = { date: Date; time: string; groupId: string | null };

export const SAVE_FAILED = 'Could not save this entry. Your changes are still here. Please try again.';

/**
 * The logger's defaults: an edit keeps its day (read at noon) and its time;
 * a new entry on today (or yesterday during 00:00–03:59) takes the live clock,
 * and other past days start at midnight.
 * Snap a meal supplies its validated press time, even across midnight.
 */
export function initialWhen(entry: FoodLog | null, selectedKey: string, groups: NutritionGroup[], fallbackGroupId: string | null, pressedAt?: Date | null): When {
  const day = entry?.date ?? selectedKey;
  const parsed = new Date(`${day}T12:00:00`);
  const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  const now = new Date();
  // An edit without a saved time reads its day at noon (today takes the clock);
  // a new entry takes the live clock on today or late-night yesterday, else midnight.
  const clockSource = !entry && pressedAt
    ? pressedAt
    : entry
      ? (isSameDay(date, now) ? now : date)
      : usesLiveClockForDay(date, now)
        ? now
        : startOfDay(date);
  const groupId = entry
    ? entry.group_id || groups.find((group) => group.label === entry.meal_type)?.id || null
    : fallbackGroupId;
  return { date, time: toLocalTimeInput(entry?.logged_at ?? null, clockSource), groupId };
}

/** True when the entry's day is the page's day, so that day's groups apply. */
export function usesDayGroups(when: When, selectedKey: string): boolean {
  return format(when.date, 'yyyy-MM-dd') === selectedKey;
}

/**
 * Saves one entry: an update by id when editing, else an upsert under the
 * retry-safe id (an explicit retry id wins, as for meal and photo items).
 */
export async function saveFoodEntry(input: {
  foodId: string;
  servings: number;
  source: string;
  when: When;
  groups: NutritionGroup[];
  editingId?: string;
  pending: PendingEntryId;
  retryId?: string;
}): Promise<void> {
  const group = input.groups.find((candidate) => candidate.id === input.when.groupId) ?? null;
  const payloadFor = (target: NutritionGroup | null) => buildEntryPayload({
    foodId: input.foodId,
    servings: input.servings,
    source: input.source,
    entryDate: input.when.date,
    time: input.when.time,
    group: target,
  });
  const writeId = entryWriteId(Boolean(input.editingId), input.retryId, input.pending);
  try {
    await persistNutritionEntry(payloadFor(group), input.editingId, writeId);
  } catch (failure) {
    // The meal was deleted on another device (its foreign key is gone): save
    // the entry Unassigned instead of failing on every retry.
    if (!group || (failure as { code?: string } | null)?.code !== '23503') throw failure;
    await persistNutritionEntry(payloadFor(null), input.editingId, writeId);
  }
  // confirmed: the next save is a new entry
  // Multi-item logging can stop after this item; its old reminder must go
  // even if a later item fails before the sheet's completion refresh.
  useFuelStore.getState().invalidateTotals();
  if (!input.retryId) input.pending.clear();
}

/** The session's access token for the food worker, or a sign-in message. */
export async function workerAccessToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Your session expired. Please sign out and sign back in.');
  return token;
}

/** "HH:mm" to a Date on the entry's day, for the time picker. */
export function timeAsDate(day: Date, time: string): Date {
  const [hours = 12, minutes = 0] = time.split(':').map(Number);
  const value = new Date(day);
  value.setHours(Number.isFinite(hours) ? hours : 12, Number.isFinite(minutes) ? minutes : 0, 0, 0);
  return value;
}
