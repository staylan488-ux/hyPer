// Logging a past meal again: Fuel's "Copy to today" writes the same foods and
// amounts at the same clock times into the matching meal of another day.
import { format } from 'date-fns';

import { getLogDate } from '@/components/nutrition/nutritionLogUtils';
import { nutritionGroupLabel } from '@/lib/nutritionGroups';
import { buildEntryPayload, type NutritionEntryPayload } from '@/lib/saveNutritionEntry';
import { supabase } from '@/lib/supabase';
import type { NutritionGroup } from '@/types';

export type RepeatableEntry = {
  food_id: string;
  servings: number;
  source?: string | null;
  date: string;
  logged_at: string | null;
  created_at?: string | null;
};

/**
 * Where a copied meal goes on the other day: the same named meal (Breakfast,
 * Lunch, Dinner), else the meal or snack with the same number ("Snack 2"),
 * else Unassigned. Unassigned entries stay Unassigned.
 */
export function matchingGroup(
  source: NutritionGroup | null,
  sourceDayGroups: NutritionGroup[],
  targetDayGroups: NutritionGroup[],
): NutritionGroup | null {
  if (!source) return null;
  if (source.label) return targetDayGroups.find((group) => group.label === source.label) ?? null;
  const name = nutritionGroupLabel(source, sourceDayGroups.some((group) => group.id === source.id) ? sourceDayGroups : [source]);
  return targetDayGroups.find((group) => !group.label && group.kind === source.kind && nutritionGroupLabel(group, targetDayGroups) === name) ?? null;
}

/** The source a copy keeps: an import's source names the import, so its copy is a manual log. */
export function repeatLogSource(source?: string | null): string {
  if (!source || source === 'cronometer_csv') return 'manual';
  return source;
}

/** The rows a copy writes: each entry's food and amount at its own clock time on the target day. */
export function buildRepeatedEntries(entries: readonly RepeatableEntry[], targetDayKey: string, group: NutritionGroup | null): NutritionEntryPayload[] {
  const day = new Date(`${targetDayKey}T12:00:00`);
  return entries.map((entry) => buildEntryPayload({
    foodId: entry.food_id,
    servings: Number(entry.servings) || 1,
    source: repeatLogSource(entry.source),
    entryDate: day,
    time: format(getLogDate(entry), 'HH:mm'),
    group,
  }));
}

/** A day's entries in one meal; null is Unassigned, which also holds entries whose meal is gone. */
export function entriesInMeal<T extends { group_id?: string | null }>(dayLogs: readonly T[], dayGroups: readonly NutritionGroup[], meal: NutritionGroup | null): T[] {
  if (meal) return dayLogs.filter((log) => log.group_id === meal.id);
  const ids = new Set(dayGroups.map((group) => group.id));
  return dayLogs.filter((log) => !log.group_id || !ids.has(log.group_id));
}

/**
 * True when the meal a copy goes into already has every food being copied,
 * so a second copy asks before doubling it. Pass that meal's entries only: a
 * staple eaten at another meal today is no reason to ask.
 */
export function alreadyOnDay(entries: readonly { food_id: string }[], dayLogs: readonly { food_id: string }[]): boolean {
  if (entries.length === 0) return false;
  const foods = new Set(dayLogs.map((log) => log.food_id));
  return entries.every((entry) => foods.has(entry.food_id));
}

/**
 * Writes a copy in one request under one retry-safe id per row: a retry after
 * a lost answer rewrites the same rows instead of logging the meal twice.
 * Returns the error code on failure ('23503' when the meal was deleted elsewhere).
 */
export async function saveRepeatedEntries(
  userId: string,
  rows: readonly NutritionEntryPayload[],
  ids: readonly string[],
): Promise<{ ok: true } | { ok: false; code: string | null }> {
  if (rows.length === 0 || rows.length !== ids.length) return { ok: false, code: null };
  const { error } = await supabase
    .from('nutrition_logs')
    .upsert(rows.map((row, index) => ({ id: ids[index], user_id: userId, ...row })), { onConflict: 'id' });
  if (error) {
    console.error('Error copying nutrition entries:', error);
    return { ok: false, code: (error as { code?: string }).code ?? null };
  }
  return { ok: true };
}
