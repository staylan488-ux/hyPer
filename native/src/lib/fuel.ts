// The food log behind Fuel and Today, read and written through the shared
// nutrition helpers (the same queries and writes as the web Fuel page).
//
// Fuel shows one month at a time, like the web page: the selected day's
// entries and meal groups come from the loaded month. Today's totals are kept
// apart so Today stays right while Fuel looks at another month.
import { endOfMonth, format, parseISO, startOfMonth } from 'date-fns';
import { create } from 'zustand';

import { captureAccountScope } from '@/lib/accountScope';
import { fetchNutritionLogsWithFoods } from '@/lib/nutritionLogQueries';
import {
  createNutritionGroup,
  deleteNutritionEntry,
  deleteNutritionGroup,
  ensureDefaultGroups,
  mergeGroups,
  moveEntryToGroup,
  moveEntryToPreviousDay,
  reorderNutritionGroup,
} from '@/lib/nutritionDay';
import { sortNutritionGroups } from '@/lib/nutritionGroups';
import { sumMacros, type MacroTotals } from '@/lib/nutritionMacros';
import { buildRepeatedEntries, entriesInMeal, matchingGroup, saveRepeatedEntries } from '@/lib/repeatEntries';
import { getSessionUserId } from '@/lib/sessionUser';
import { supabase } from '@/lib/supabase';
import type { Food, NutritionGroup, NutritionLog } from '@/types';

import { mealForTime } from './meals';

export type FoodLog = NutritionLog & { created_at?: string | null; food: Food | null };

const FOOD_COLUMNS = 'id, user_id, name, description, calories, protein, carbs, fat, serving_size, serving_unit, source, fdc_id';

export const dayKey = (date: Date) => format(date, 'yyyy-MM-dd');
export const today = () => dayKey(new Date());

/**
 * Today's key, read from the clock on every render. A hook by name, so the
 * React Compiler runs it each time instead of keeping the first render's day
 * on a screen that stays open past midnight.
 */
export function useTodayKey(): string {
  return today();
}
const monthOf = (key: string) => key.slice(0, 7);

export { mealForTime } from './meals';

const emptyTotals: MacroTotals = { calories: 0, protein: 0, carbs: 0, fat: 0 };

type FuelState = {
  /** The day Fuel shows. */
  selected: string;
  /** The month whose entries are loaded (yyyy-MM), or null before the first load. */
  loadedMonth: string | null;
  logs: FoodLog[];
  groups: NutritionGroup[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  todayKey: string;
  todayTotals: MacroTotals;
  /** The account and day whose totals have actually loaded, including an empty day. */
  todayLoadedForUserId: string | null;
  todayLoadedKey: string | null;
  /** The day whose totals are the phone's copy (launchCache.ts) until a read for it lands; no loaded marker. */
  todayCopyKey: string | null;
  /** Shows a day, loading its month when needed. */
  select: (key: string) => void;
  /** Reloads the shown month (and today's totals when today is in another month). */
  refresh: () => Promise<void>;
  /** The account load: today's totals; Fuel left on the old today moves on. */
  loadToday: (key?: string) => Promise<void>;
  /** Creates a day's missing Breakfast, Lunch and Dinner (a failed day is not retried this session). */
  ensureDayGroups: (key: string) => Promise<void>;
  deleteEntry: (id: string) => Promise<boolean>;
  moveEntry: (id: string, groupId: string | null) => Promise<boolean>;
  moveEntryToYesterday: (id: string) => Promise<boolean>;
  /** Logs a past day's entries again today, in the matching meal, then shows today. */
  copyToToday: (entries: FoodLog[], group: NutritionGroup | null) => Promise<boolean>;
  addGroup: (kind: 'meal' | 'snack') => Promise<boolean>;
  reorderGroup: (groupId: string, direction: -1 | 1) => Promise<boolean>;
  deleteGroup: (group: NutritionGroup) => Promise<boolean>;
};

/**
 * Today's totals as Today shows them: nothing eaten until they have loaded for
 * the current today, or the phone's copy of the current today stands in
 * (restoreFuelCopy). A new day whose read failed keeps the old day's totals in
 * the store (still right for that day); they are never shown as today's.
 */
export const todayTotalsShown = (state: Pick<FuelState, 'todayKey' | 'todayLoadedKey' | 'todayTotals'> & { todayCopyKey?: string | null }): MacroTotals =>
  state.todayLoadedKey === state.todayKey || state.todayCopyKey === state.todayKey ? state.todayTotals : emptyTotals;

// The latest month request wins; an older answer is dropped.
let monthRequest = 0;
let todayRequest = 0;
const defaultsFailed = new Set<string>();
// A second caller waits for the same creation instead of reading before it lands.
const defaultsInFlight = new Map<string, Promise<void>>();
// A copy's row ids until it is confirmed, so a retry after a lost answer rewrites the same rows.
const copyIds = new Map<string, string[]>();
// Today's month as the phone's copy (launchCache.ts), until a real read replaces it.
let monthFromCopy = false;

export const useFuelStore = create<FuelState>((set, get) => {
  const loadMonth = async (month: string) => {
    const isCurrent = captureAccountScope();
    const request = ++monthRequest;
    const userId = await getSessionUserId();
    if (!userId || request !== monthRequest || !isCurrent()) return;
    const { loadedMonth, logs: shown } = get();
    // A reload of the month on screen reads its foods alongside its logs.
    const expectedFoodIds = loadedMonth === month ? shown.map((log) => log.food_id) : undefined;
    if (loadedMonth !== month) set({ status: 'loading' });
    const start = parseISO(`${month}-01`);
    const from = dayKey(startOfMonth(start));
    const to = dayKey(endOfMonth(start));
    const [logsResult, groupsResult] = await Promise.all([
      fetchNutritionLogsWithFoods<NutritionLog, Food>(userId, { from, to }, '*', FOOD_COLUMNS, expectedFoodIds),
      supabase
        .from('nutrition_groups')
        .select('*')
        .eq('user_id', userId)
        .gte('date', from)
        .lte('date', to)
        .order('sort_order', { ascending: true }),
    ]);
    if (request !== monthRequest || !isCurrent()) return;
    if (logsResult.error || !logsResult.data || groupsResult.error) {
      // a month already on screen keeps what it shows
      set({ status: get().loadedMonth === month ? 'ready' : 'error' });
      return;
    }
    const logs = logsResult.data as FoodLog[];
    const { todayKey } = get();
    monthFromCopy = false;
    set({
      loadedMonth: month,
      logs,
      groups: (groupsResult.data ?? []) as NutritionGroup[],
      status: 'ready',
      ...(monthOf(todayKey) === month ? {
        todayTotals: sumMacros(logs.filter((log) => log.date === todayKey)),
        todayLoadedForUserId: userId,
        todayLoadedKey: todayKey,
        todayCopyKey: null,
      } : {}),
    });
    void get().ensureDayGroups(get().selected);
  };

  const dayGroups = (key = get().selected) => sortNutritionGroups(get().groups.filter((group) => group.date === key));
  const dayLogs = (key = get().selected) => get().logs.filter((log) => log.date === key);
  const syncTodayTotals = () => {
    const { todayKey, loadedMonth, logs } = get();
    if (loadedMonth === monthOf(todayKey)) set({ todayTotals: sumMacros(logs.filter((log) => log.date === todayKey)) });
  };
  // An edit while the month on screen is the phone's copy: the account load's
  // first read may have left before it and would bring the old rows back, so
  // that read is dropped and the month is read again once the edit settles.
  const editsCopy = <A extends unknown[], R>(edit: (...args: A) => Promise<R>) => async (...args: A): Promise<R> => {
    if (!monthFromCopy) return edit(...args);
    monthRequest += 1;
    try {
      return await edit(...args);
    } finally {
      void loadMonth(monthOf(get().selected));
    }
  };

  return {
    selected: today(),
    loadedMonth: null,
    logs: [],
    groups: [],
    status: 'idle',
    todayKey: today(),
    todayTotals: emptyTotals,
    todayLoadedForUserId: null,
    todayLoadedKey: null,
    todayCopyKey: null,

    select: (key) => {
      set({ selected: key });
      if (monthOf(key) !== get().loadedMonth) void loadMonth(monthOf(key));
      else void get().ensureDayGroups(key);
    },

    refresh: async () => {
      const { selected, todayKey } = get();
      await Promise.all([
        loadMonth(monthOf(selected)),
        monthOf(todayKey) !== monthOf(selected) ? get().loadToday(todayKey) : undefined,
      ]);
    },

    loadToday: async (key = today()) => {
      const isCurrent = captureAccountScope();
      const request = ++todayRequest;
      const previous = get().todayKey;
      if (previous !== key && get().selected === previous) set({ selected: key });
      set({ todayKey: key });
      if (monthOf(key) === monthOf(get().selected)) {
        await loadMonth(monthOf(key));
        return;
      }
      const userId = await getSessionUserId();
      if (!userId || !isCurrent() || request !== todayRequest) return;
      const { data, error } = await fetchNutritionLogsWithFoods<NutritionLog, Food>(
        userId,
        { from: key, to: key },
        '*',
        FOOD_COLUMNS,
      );
      if (!error && data && get().todayKey === key && isCurrent() && request === todayRequest) {
        set({ todayTotals: sumMacros(data), todayLoadedForUserId: userId, todayLoadedKey: key, todayCopyKey: null });
      }
    },

    ensureDayGroups: (key) => {
      if (monthFromCopy || get().loadedMonth !== monthOf(key) || defaultsFailed.has(key)) return Promise.resolve();
      const running = defaultsInFlight.get(key);
      if (running) return running;
      const groups = dayGroups(key);
      const task = (async () => {
        const userId = await getSessionUserId();
        if (!userId) return;
        const result = await ensureDefaultGroups(userId, key, groups);
        if (!result) return;
        if (!result.ok) {
          if (!result.inserted) defaultsFailed.add(key);
          await loadMonth(monthOf(key));
          return;
        }
        if (get().loadedMonth === monthOf(key)) set({ groups: mergeGroups(get().groups, result.groups) });
      })().finally(() => {
        defaultsInFlight.delete(key);
      });
      defaultsInFlight.set(key, task);
      return task;
    },

    deleteEntry: editsCopy(async (id: string) => {
      const removed = get().logs.find((log) => log.id === id);
      // gone at once, back if the delete fails (no confirm, as on the web);
      // Today and the widgets follow at once too
      set({ logs: get().logs.filter((log) => log.id !== id) });
      syncTodayTotals();
      const ok = await deleteNutritionEntry(id);
      if (!ok && removed && !get().logs.some((log) => log.id === id)) {
        set({ logs: [...get().logs, removed] });
        syncTodayTotals();
      }
      return ok;
    }),

    moveEntry: editsCopy(async (id: string, groupId: string | null) => {
      // a dropped connection reports a failure instead of nothing at all
      const patch = await moveEntryToGroup(id, groupId, dayGroups(), dayLogs()).catch(() => null);
      if (!patch) return false;
      set({ logs: get().logs.map((log) => (log.id === id ? { ...log, ...patch } : log)) });
      return true;
    }),

    moveEntryToYesterday: async (id) => {
      const log = get().logs.find((candidate) => candidate.id === id);
      if (!log || !(await moveEntryToPreviousDay(log).catch(() => null))) return false;
      await get().refresh();
      return true;
    },

    copyToToday: async (entries, group) => {
      const copied = entries.filter((log) => log.food);
      const userId = await getSessionUserId();
      if (!userId || copied.length === 0) return false;
      const key = today();
      // Today's meals, with Breakfast, Lunch and Dinner made if missing (read
      // directly, not from the month, while Fuel shows another month or the
      // phone's copy of this one).
      const targetGroups = await loadDayGroups(key);
      const sourceGroups = group ? sortNutritionGroups(get().groups.filter((candidate) => candidate.date === group.date)) : [];
      const target = matchingGroup(group, sourceGroups, targetGroups);
      const retryKey = `${key}:${target?.id ?? ''}:${copied.map((log) => log.id).join(',')}`;
      const ids = copyIds.get(retryKey) ?? copied.map(() => crypto.randomUUID());
      copyIds.set(retryKey, ids);
      let saved = await saveRepeatedEntries(userId, buildRepeatedEntries(copied, key, target), ids).catch(() => ({ ok: false as const, code: null }));
      // Today's meal was deleted on another device: log the copy Unassigned, as a single entry does.
      if (!saved.ok && saved.code === '23503' && target) {
        saved = await saveRepeatedEntries(userId, buildRepeatedEntries(copied, key, null), ids).catch(() => ({ ok: false as const, code: null }));
      }
      if (!saved.ok) return false;
      copyIds.delete(retryKey);
      get().select(key);
      await get().refresh();
      return true;
    },

    addGroup: editsCopy(async (kind: 'meal' | 'snack') => {
      const userId = await getSessionUserId();
      if (!userId) return false;
      const result = await createNutritionGroup(userId, get().selected, kind, dayGroups());
      if (!result.ok) {
        if (result.inserted) await get().refresh();
        return false;
      }
      set({ groups: mergeGroups(get().groups, result.groups) });
      return true;
    }),

    reorderGroup: editsCopy(async (groupId: string, direction: -1 | 1) => {
      const result = await reorderNutritionGroup(dayGroups(), groupId, direction).catch(() => null);
      if (!result) return false;
      if (!result.ok) {
        await get().refresh();
        return false;
      }
      set({ groups: mergeGroups(get().groups, result.groups) });
      return true;
    }),

    deleteGroup: editsCopy(async (group: NutritionGroup) => {
      if (!(await deleteNutritionGroup(group).catch(() => false))) return false;
      set({
        groups: get().groups.filter((candidate) => candidate.id !== group.id),
        logs: get().logs.map((log) => (log.group_id === group.id ? { ...log, group_id: null, meal_type: null } : log)),
      });
      return true;
    }),
  };
});

/** The selected day's entries and groups, from the loaded month. */
export function useFuelDay() {
  const selected = useFuelStore((state) => state.selected);
  const logs = useFuelStore((state) => state.logs);
  const groups = useFuelStore((state) => state.groups);
  const loadedMonth = useFuelStore((state) => state.loadedMonth);
  const status = useFuelStore((state) => state.status);
  const loaded = loadedMonth === monthOf(selected);
  return {
    selected,
    loaded,
    status,
    logs: loaded ? logs.filter((log) => log.date === selected) : [],
    groups: loaded ? sortNutritionGroups(groups.filter((group) => group.date === selected)) : [],
  };
}

/**
 * The entries already in the meal today that a copy of `group` would go into,
 * or null when today's month is not loaded (not known here).
 */
export function todayLogsInMatchingMeal(group: NutritionGroup | null): FoodLog[] | null {
  const { loadedMonth, logs } = useFuelStore.getState();
  const key = today();
  if (loadedMonth !== monthOf(key) || monthFromCopy) return null;
  const todayGroups = groupsForDay(key);
  const target = matchingGroup(group, group ? groupsForDay(group.date) : [], todayGroups);
  return entriesInMeal(logs.filter((log) => log.date === key), todayGroups, target);
}

/** Groups of any day in the loaded month (the logger's "Add to" for an entry's own day). */
export function groupsForDay(key: string): NutritionGroup[] {
  return sortNutritionGroups(useFuelStore.getState().groups.filter((group) => group.date === key));
}

async function readDayGroups(userId: string, key: string): Promise<NutritionGroup[] | null> {
  const { data, error } = await supabase.from('nutrition_groups').select('*').eq('user_id', userId).eq('date', key);
  return error ? null : sortNutritionGroups((data ?? []) as NutritionGroup[]);
}

/**
 * A day's meal groups for the Log food sheet and Copy to today, with the day's
 * Breakfast, Lunch and Dinner made if missing: from the loaded month, else
 * read directly (Log food from Today while Fuel shows another month).
 */
export async function loadDayGroups(key: string): Promise<NutritionGroup[]> {
  const store = useFuelStore.getState();
  if (store.loadedMonth === monthOf(key) && !monthFromCopy) {
    await store.ensureDayGroups(key);
    return groupsForDay(key);
  }
  const userId = await getSessionUserId();
  if (!userId) return [];
  const groups = await readDayGroups(userId, key);
  if (!groups) return [];
  const made = await ensureDefaultGroups(userId, key, groups).catch(() => null);
  if (made?.ok) return sortNutritionGroups(made.groups);
  // made by another save meanwhile (one Breakfast a day), or made but not put in order
  return made ? (await readDayGroups(userId, key)) ?? groups : groups;
}

/** The day's named meal that fits the time (breakfast, lunch or dinner), if the day has it. */
export function suggestedGroup(groups: NutritionGroup[], at = new Date()): NutritionGroup | null {
  const meal = mealForTime(at);
  return groups.find((group) => group.label === meal) ?? null;
}

export const isFuelMonthFromCopy = () => monthFromCopy;

/**
 * Launch: today's figures (and its month, when known) from the phone's copy.
 * No markers: widgets and the copy's own writer still wait for a real read.
 */
export function restoreFuelCopy(copy: {
  todayKey: string;
  totals: MacroTotals;
  month: { month: string; logs: FoodLog[]; groups: NutritionGroup[] } | null;
}): boolean {
  const state = useFuelStore.getState();
  if (state.loadedMonth !== null || state.status !== 'idle' || state.todayLoadedForUserId !== null || copy.todayKey !== today()) return false;
  const month = copy.month?.month === monthOf(copy.todayKey) ? copy.month : null;
  monthFromCopy = month !== null;
  useFuelStore.setState({
    selected: copy.todayKey,
    todayKey: copy.todayKey,
    todayTotals: copy.totals,
    // Today shows these figures (todayTotalsShown), with no loaded marker.
    todayCopyKey: copy.todayKey,
    ...(month ? { loadedMonth: month.month, logs: month.logs, groups: month.groups, status: 'ready' as const } : {}),
  });
  return true;
}

/** Sign-out: nothing of this account's food stays on screen or reaches the next account's widget. */
export function resetFuel() {
  monthFromCopy = false;
  monthRequest += 1;
  todayRequest += 1;
  defaultsFailed.clear();
  defaultsInFlight.clear();
  copyIds.clear();
  const key = today();
  useFuelStore.setState({
    selected: key, loadedMonth: null, logs: [], groups: [], status: 'idle', todayKey: key,
    todayTotals: emptyTotals, todayLoadedForUserId: null, todayLoadedKey: null, todayCopyKey: null,
  });
}
