// Changes to one day of the food log (meal groups and entries), shared by the
// web Fuel page and the native app. Each returns what changed, or a failure,
// and leaves screen state to the caller.
import { isLateNightEntry, planEntryDayMove, type EntryDayPatch } from '@/lib/entryDay';
import {
  changedGroupOrders,
  insertNutritionGroupByTime,
  legacyMealTypeForGroup,
  missingDefaultNamedMeals,
  moveNutritionGroup,
  normalizeNutritionGroupOrder,
} from '@/lib/nutritionGroups';
import { supabase } from '@/lib/supabase';
import type { NutritionGroup } from '@/types';

/** Writes each group's sort_order; false when any write failed. */
export async function persistGroupOrder(groups: NutritionGroup[]): Promise<boolean> {
  const results = await Promise.all(groups.map((group) => (
    supabase
      .from('nutrition_groups')
      .update({ sort_order: group.sort_order })
      .eq('id', group.id)
      .eq('user_id', group.user_id)
  )));
  const failed = results.find((result) => result.error);
  if (failed?.error) {
    console.error('Error ordering nutrition groups:', failed.error);
    return false;
  }
  return true;
}

/** Merges changed or new groups into a list (a month's or a day's). */
export function mergeGroups(current: NutritionGroup[], changed: NutritionGroup[]): NutritionGroup[] {
  const byId = new Map(changed.map((group) => [group.id, group]));
  return [
    ...current.map((group) => byId.get(group.id) || group),
    ...changed.filter((group) => !current.some((candidate) => candidate.id === group.id)),
  ];
}

export type GroupsResult = { ok: true; groups: NutritionGroup[] } | { ok: false; inserted: boolean };

/**
 * Creates the day's missing Breakfast, Lunch and Dinner groups, then puts the
 * named meals back in order. On success returns the day's groups as changed;
 * `inserted` on a failure says whether rows were created (reload the day).
 */
export async function ensureDefaultGroups(userId: string, dateKey: string, dayGroups: NutritionGroup[]): Promise<GroupsResult | null> {
  const missing = missingDefaultNamedMeals(dayGroups);
  if (missing.length === 0) return null;

  const { data, error } = await supabase.from('nutrition_groups').insert(
    missing.map((label, index) => ({
      user_id: userId,
      date: dateKey,
      kind: 'meal' as const,
      label,
      sort_order: dayGroups.length + index,
    })),
  ).select('*');
  if (error || !data) {
    console.error('Error creating default nutrition groups:', error);
    return { ok: false, inserted: false };
  }

  const inserted = data as NutritionGroup[];
  const normalized = normalizeNutritionGroupOrder([...dayGroups, ...inserted]);
  if (!await persistGroupOrder(changedGroupOrders([...dayGroups, ...inserted], normalized))) {
    return { ok: false, inserted: true };
  }
  return { ok: true, groups: normalized };
}

/** Adds a meal or snack, placed by the current clock against 08:00, 12:00 and 18:00. */
export async function createNutritionGroup(
  userId: string,
  dateKey: string,
  kind: 'meal' | 'snack',
  dayGroups: NutritionGroup[],
  at: Date = new Date(),
): Promise<GroupsResult> {
  const { data, error } = await supabase.from('nutrition_groups').insert({
    user_id: userId,
    date: dateKey,
    kind,
    label: null,
    sort_order: dayGroups.length,
  }).select('*').single();
  if (error || !data) {
    console.error('Error creating nutrition group:', error);
    return { ok: false, inserted: false };
  }

  const created = data as NutritionGroup;
  const normalized = insertNutritionGroupByTime(dayGroups, created, at);
  if (!await persistGroupOrder(changedGroupOrders([...dayGroups, created], normalized))) {
    return { ok: false, inserted: true };
  }
  return { ok: true, groups: normalized };
}

/**
 * Moves a group one place up or down. Null when the move is not allowed
 * (an edge, or it would break Breakfast < Lunch < Dinner).
 */
export async function reorderNutritionGroup(
  dayGroups: NutritionGroup[],
  groupId: string,
  direction: -1 | 1,
): Promise<GroupsResult | null> {
  const reordered = moveNutritionGroup(dayGroups, groupId, direction);
  if (!reordered) return null;
  if (!await persistGroupOrder(changedGroupOrders(dayGroups, reordered))) return { ok: false, inserted: false };
  return { ok: true, groups: reordered };
}

/** True when a group can move that way. */
export function canReorderNutritionGroup(dayGroups: NutritionGroup[], groupId: string, direction: -1 | 1): boolean {
  return moveNutritionGroup(dayGroups, groupId, direction) !== null;
}

/** Deletes a custom group after moving its entries to Unassigned. Named meals stay. */
export async function deleteNutritionGroup(group: NutritionGroup): Promise<boolean> {
  if (group.label) return false;
  const { error: moveError } = await supabase.from('nutrition_logs')
    .update({ group_id: null, meal_type: null })
    .eq('user_id', group.user_id)
    .eq('group_id', group.id);
  if (moveError) {
    console.error('Error unassigning group entries:', moveError);
    return false;
  }
  const { error } = await supabase.from('nutrition_groups').delete().eq('id', group.id).eq('user_id', group.user_id);
  if (error) {
    console.error('Error deleting nutrition group:', error);
    return false;
  }
  return true;
}

export type EntryGroupPatch = { group_id: string | null; sort_order: number; meal_type: ReturnType<typeof legacyMealTypeForGroup> };

/** Moves an entry to the end of a group (or Unassigned); the written patch, or null. */
export async function moveEntryToGroup(
  logId: string,
  groupId: string | null,
  dayGroups: NutritionGroup[],
  dayLogs: ReadonlyArray<{ group_id?: string | null }>,
): Promise<EntryGroupPatch | null> {
  const group = groupId ? dayGroups.find((candidate) => candidate.id === groupId) || null : null;
  const patch: EntryGroupPatch = {
    group_id: groupId,
    sort_order: dayLogs.filter((log) => (log.group_id || null) === groupId).length,
    meal_type: legacyMealTypeForGroup(group),
  };
  const { error } = await supabase.from('nutrition_logs').update(patch).eq('id', logId);
  if (error) {
    console.error('Error moving nutrition entry:', error);
    return null;
  }
  return patch;
}

/**
 * "Move to yesterday" is offered on today's entries only while it is still
 * before 05:00 and one of today's entries was logged before then.
 */
export function offersMoveToPreviousDay(dayLogs: ReadonlyArray<{ date: string; logged_at?: string | null }>, now = new Date()): boolean {
  return dayLogs.some((log) => isLateNightEntry({ date: log.date, logged_at: log.logged_at }, now));
}

/** Shifts an entry's date and time back one local day; the patch, or null. */
export async function moveEntryToPreviousDay(log: { id: string; date: string; logged_at?: string | null }): Promise<EntryDayPatch | null> {
  const patch = planEntryDayMove({ date: log.date, logged_at: log.logged_at }, -1);
  if (!patch) return null;
  const { error } = await supabase.from('nutrition_logs').update(patch).eq('id', log.id);
  if (error) {
    console.error('Error moving nutrition entry to the previous day:', error);
    return null;
  }
  return patch;
}

/** Deletes an entry (no confirm, as on the web). */
export async function deleteNutritionEntry(logId: string): Promise<boolean> {
  try {
    const { error } = await supabase.from('nutrition_logs').delete().eq('id', logId);
    if (error) {
      console.error('Error deleting entry:', error);
      return false;
    }
    return true;
  } catch (error) {
    console.error('Error deleting entry:', error);
    return false;
  }
}
