// The food log behind Fuel and Today, read and written through the shared
// nutrition helpers (the same queries and writes as the web Fuel page).
//
// Fuel shows one month at a time, like the web page: the selected day's
// entries and meal groups come from the loaded month. Today's totals are kept
// apart so Today stays right while Fuel looks at another month.
import { endOfMonth, format, parseISO, startOfMonth } from 'date-fns';
import { create } from 'zustand';

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
import { getSessionUserId } from '@/lib/sessionUser';
import { supabase } from '@/lib/supabase';
import type { Food, NutritionGroup, NutritionLog } from '@/types';

import { mealForTime } from './meals';

export type FoodLog = NutritionLog & { created_at?: string | null; food: Food | null };

const FOOD_COLUMNS = 'id, user_id, name, description, calories, protein, carbs, fat, serving_size, serving_unit, source, fdc_id';

export const dayKey = (date: Date) => format(date, 'yyyy-MM-dd');
export const today = () => dayKey(new Date());
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
  addGroup: (kind: 'meal' | 'snack') => Promise<boolean>;
  reorderGroup: (groupId: string, direction: -1 | 1) => Promise<boolean>;
  deleteGroup: (group: NutritionGroup) => Promise<boolean>;
};

// The latest month request wins; an older answer is dropped.
let monthRequest = 0;
const defaultsFailed = new Set<string>();
// A second caller waits for the same creation instead of reading before it lands.
const defaultsInFlight = new Map<string, Promise<void>>();

export const useFuelStore = create<FuelState>((set, get) => {
  const loadMonth = async (month: string) => {
    const request = ++monthRequest;
    const userId = await getSessionUserId();
    if (!userId || request !== monthRequest) return;
    if (get().loadedMonth !== month) set({ status: 'loading' });
    const start = parseISO(`${month}-01`);
    const from = dayKey(startOfMonth(start));
    const to = dayKey(endOfMonth(start));
    const [logsResult, groupsResult] = await Promise.all([
      fetchNutritionLogsWithFoods<NutritionLog, Food>(userId, { from, to }, '*', FOOD_COLUMNS),
      supabase
        .from('nutrition_groups')
        .select('*')
        .eq('user_id', userId)
        .gte('date', from)
        .lte('date', to)
        .order('sort_order', { ascending: true }),
    ]);
    if (request !== monthRequest) return;
    if (logsResult.error || !logsResult.data || groupsResult.error) {
      // a month already on screen keeps what it shows
      set({ status: get().loadedMonth === month ? 'ready' : 'error' });
      return;
    }
    const logs = logsResult.data as FoodLog[];
    const { todayKey } = get();
    set({
      loadedMonth: month,
      logs,
      groups: (groupsResult.data ?? []) as NutritionGroup[],
      status: 'ready',
      ...(monthOf(todayKey) === month ? { todayTotals: sumMacros(logs.filter((log) => log.date === todayKey)) } : {}),
    });
    void get().ensureDayGroups(get().selected);
  };

  const dayGroups = (key = get().selected) => sortNutritionGroups(get().groups.filter((group) => group.date === key));
  const dayLogs = (key = get().selected) => get().logs.filter((log) => log.date === key);
  const syncTodayTotals = () => {
    const { todayKey, loadedMonth, logs } = get();
    if (loadedMonth === monthOf(todayKey)) set({ todayTotals: sumMacros(logs.filter((log) => log.date === todayKey)) });
  };

  return {
    selected: today(),
    loadedMonth: null,
    logs: [],
    groups: [],
    status: 'idle',
    todayKey: today(),
    todayTotals: emptyTotals,

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
      const previous = get().todayKey;
      if (previous !== key && get().selected === previous) set({ selected: key });
      set({ todayKey: key });
      if (monthOf(key) === monthOf(get().selected)) {
        await loadMonth(monthOf(key));
        return;
      }
      const userId = await getSessionUserId();
      if (!userId) return;
      const { data, error } = await fetchNutritionLogsWithFoods<NutritionLog, Food>(
        userId,
        { from: key, to: key },
        '*',
        FOOD_COLUMNS,
      );
      if (!error && data && get().todayKey === key) set({ todayTotals: sumMacros(data) });
    },

    ensureDayGroups: (key) => {
      if (get().loadedMonth !== monthOf(key) || defaultsFailed.has(key)) return Promise.resolve();
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

    deleteEntry: async (id) => {
      const removed = get().logs.find((log) => log.id === id);
      // gone at once, back if the delete fails (no confirm, as on the web)
      set({ logs: get().logs.filter((log) => log.id !== id) });
      const ok = await deleteNutritionEntry(id);
      if (!ok && removed && !get().logs.some((log) => log.id === id)) set({ logs: [...get().logs, removed] });
      syncTodayTotals();
      return ok;
    },

    moveEntry: async (id, groupId) => {
      const patch = await moveEntryToGroup(id, groupId, dayGroups(), dayLogs());
      if (!patch) return false;
      set({ logs: get().logs.map((log) => (log.id === id ? { ...log, ...patch } : log)) });
      return true;
    },

    moveEntryToYesterday: async (id) => {
      const log = get().logs.find((candidate) => candidate.id === id);
      if (!log || !(await moveEntryToPreviousDay(log))) return false;
      await get().refresh();
      return true;
    },

    addGroup: async (kind) => {
      const userId = await getSessionUserId();
      if (!userId) return false;
      const result = await createNutritionGroup(userId, get().selected, kind, dayGroups());
      if (!result.ok) {
        if (result.inserted) await get().refresh();
        return false;
      }
      set({ groups: mergeGroups(get().groups, result.groups) });
      return true;
    },

    reorderGroup: async (groupId, direction) => {
      const result = await reorderNutritionGroup(dayGroups(), groupId, direction);
      if (!result) return false;
      if (!result.ok) {
        await get().refresh();
        return false;
      }
      set({ groups: mergeGroups(get().groups, result.groups) });
      return true;
    },

    deleteGroup: async (group) => {
      if (!(await deleteNutritionGroup(group))) return false;
      set({
        groups: get().groups.filter((candidate) => candidate.id !== group.id),
        logs: get().logs.map((log) => (log.group_id === group.id ? { ...log, group_id: null, meal_type: null } : log)),
      });
      return true;
    },
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

/** Groups of any day in the loaded month (the logger's "Add to" for an entry's own day). */
export function groupsForDay(key: string): NutritionGroup[] {
  return sortNutritionGroups(useFuelStore.getState().groups.filter((group) => group.date === key));
}

/**
 * A day's meal groups for the Log food sheet: from the loaded month (making
 * sure the day has its Breakfast, Lunch and Dinner), else read directly.
 */
export async function loadDayGroups(key: string): Promise<NutritionGroup[]> {
  const store = useFuelStore.getState();
  if (store.loadedMonth === monthOf(key)) {
    await store.ensureDayGroups(key);
    return groupsForDay(key);
  }
  const userId = await getSessionUserId();
  if (!userId) return [];
  const { data, error } = await supabase.from('nutrition_groups').select('*').eq('user_id', userId).eq('date', key);
  return error ? [] : sortNutritionGroups((data ?? []) as NutritionGroup[]);
}

/** The day's named meal that fits the time (breakfast, lunch or dinner), if the day has it. */
export function suggestedGroup(groups: NutritionGroup[], at = new Date()): NutritionGroup | null {
  const meal = mealForTime(at);
  return groups.find((group) => group.label === meal) ?? null;
}

/** Sign-out: nothing of this account's food stays on screen or reaches the next account's widget. */
export function resetFuel() {
  monthRequest += 1;
  defaultsFailed.clear();
  defaultsInFlight.clear();
  const key = today();
  useFuelStore.setState({ selected: key, loadedMonth: null, logs: [], groups: [], status: 'idle', todayKey: key, todayTotals: emptyTotals });
}
