// The Log food sheet's Recent list: the foods a person has eaten lately, the
// most often eaten first, each with the amount they usually log. Read from the
// food log itself, so nothing has to be saved on purpose first.
import { differenceInCalendarDays, format, parseISO, subDays } from 'date-fns';

import { normalizeFoodName } from '@/components/nutrition/foodLoggerUtils';
import { getLogTimestamp } from '@/components/nutrition/nutritionLogUtils';
import {
  amountForUnit,
  formatMeasurementAmount,
  getCompatibleMeasurementUnits,
  servingsForAmount,
  type MeasurementUnit,
} from '@/lib/foodUnits';
import { fetchNutritionLogsWithFoods } from '@/lib/nutritionLogQueries';
import type { Food } from '@/types';

/** Days of the log the list looks back over, today included. */
export const RECENT_WINDOW_DAYS = 28;
/** A day a food was eaten counts half as much after this many days. */
export const RECENT_HALF_LIFE_DAYS = 10;
/** Foods the list shows at most. */
export const RECENT_LIMIT = 25;

const RECENT_FOOD_COLUMNS = 'id, user_id, name, description, calories, protein, carbs, fat, serving_size, serving_unit, source, fdc_id';

export type RecentLog = {
  food_id: string;
  servings: number;
  source?: string | null;
  date: string;
  logged_at: string | null;
  created_at?: string | null;
  food: Food | null;
};

export type RecentFood = {
  /** One food across its rows: the same name, macros and serving basis. */
  key: string;
  /** The row logged most recently; a new log points at it. */
  food: Food;
  /** The amount logged most often (the latest of a tie), in servings of the food. */
  servings: number;
  /** The latest log's source, so an AI estimate logged again still says so. */
  source: string;
  /** Days it was eaten in the window. */
  days: number;
  /** When it was last added to the log (ms), for hiding it until it is logged again. */
  addedAt: number;
};

/** Times a food was hidden from the list (ms), by its key. */
export type HiddenRecentFoods = Readonly<Record<string, number>>;

const tenth = (value: unknown) => Math.round((Number(value) || 0) * 10) / 10;

/**
 * A food's identity across rows. A food logged by hand twice, or the same
 * product scanned on two days, can sit in two rows; the same name, macros and
 * serving basis is the same food.
 */
export function recentFoodKey(food: Pick<Food, 'name' | 'calories' | 'protein' | 'carbs' | 'fat' | 'serving_size' | 'serving_unit'>): string {
  return [
    normalizeFoodName(food.name || ''),
    tenth(food.calories),
    tenth(food.protein),
    tenth(food.carbs),
    tenth(food.fat),
    tenth(food.serving_size || 1),
    (food.serving_unit || 'serving').trim().toLowerCase(),
  ].join('|');
}

const addedTime = (log: RecentLog) => {
  const created = log.created_at ? new Date(log.created_at).getTime() : Number.NaN;
  return Number.isFinite(created) ? created : getLogTimestamp(log);
};

/**
 * The Recent list from the window's logs. Each day a food was eaten counts,
 * weighted down by age (half every RECENT_HALF_LIFE_DAYS), so a food eaten
 * every day this week comes before one eaten often a month ago; ties go to the
 * one eaten last. A hidden food stays out until it is logged again.
 */
export function rankRecentFoods(
  logs: readonly RecentLog[],
  todayKey: string,
  options: { hidden?: HiddenRecentFoods; limit?: number } = {},
): RecentFood[] {
  const today = parseISO(todayKey);
  type Tally = {
    key: string;
    food: Food;
    source: string;
    latestEaten: number;
    addedAt: number;
    days: Map<string, number>;
    amounts: Map<number, { count: number; latest: number }>;
  };
  const tallies = new Map<string, Tally>();

  for (const log of logs) {
    const servings = Number(log.servings);
    if (!log.food || !log.food_id || !(servings > 0)) continue;
    const age = differenceInCalendarDays(today, parseISO(log.date));
    if (!(age >= 0 && age < RECENT_WINDOW_DAYS)) continue;

    const key = recentFoodKey(log.food);
    const eaten = getLogTimestamp(log);
    const added = addedTime(log);
    let tally = tallies.get(key);
    if (!tally) {
      tally = { key, food: log.food, source: log.source || 'manual', latestEaten: eaten, addedAt: added, days: new Map(), amounts: new Map() };
      tallies.set(key, tally);
    } else if (eaten > tally.latestEaten) {
      tally.food = log.food;
      tally.source = log.source || 'manual';
      tally.latestEaten = eaten;
    }
    tally.addedAt = Math.max(tally.addedAt, added);
    tally.days.set(log.date, age);

    const amount = Math.round(servings * 100) / 100;
    const seen = tally.amounts.get(amount);
    tally.amounts.set(amount, { count: (seen?.count ?? 0) + 1, latest: Math.max(seen?.latest ?? -Infinity, eaten) });
  }

  const hidden = options.hidden ?? {};
  const ranked = [...tallies.values()]
    .filter((tally) => !(hidden[tally.key] >= tally.addedAt))
    .map((tally) => {
      let usual = 1;
      let best = { count: 0, latest: -Infinity };
      for (const [amount, seen] of tally.amounts) {
        if (seen.count > best.count || (seen.count === best.count && seen.latest > best.latest)) {
          usual = amount;
          best = seen;
        }
      }
      let score = 0;
      for (const age of tally.days.values()) score += 0.5 ** (age / RECENT_HALF_LIFE_DAYS);
      return {
        recent: { key: tally.key, food: tally.food, servings: usual, source: tally.source, days: tally.days.size, addedAt: tally.addedAt },
        score,
        latestEaten: tally.latestEaten,
      };
    })
    .sort((a, b) => b.score - a.score || b.latestEaten - a.latestEaten || a.recent.food.name.localeCompare(b.recent.food.name));

  return ranked.slice(0, options.limit ?? RECENT_LIMIT).map((entry) => entry.recent);
}

/**
 * The usual amount as the food review's first input: in the food's own unit
 * when it is weighed or measured and converts cleanly (150 g rather than 1.5
 * servings), else in servings.
 */
export function usualAmountInput(food: Pick<Food, 'serving_size' | 'serving_unit'>, servings: number): { amount: string; unit: MeasurementUnit } {
  if (!(servings > 0)) return { amount: '1', unit: 'serving' };
  const inServings = formatMeasurementAmount(servings);
  const units = getCompatibleMeasurementUnits(food.serving_unit);
  if (units.length > 1) {
    const own = units.find((candidate) => candidate === food.serving_unit?.trim().toLowerCase()) ?? units[1];
    const amount = amountForUnit(food, inServings, 'serving', own);
    const back = servingsForAmount(food, amount, own);
    if (back !== null && Math.abs(back - servings) <= servings * 0.01) return { amount, unit: own };
  }
  return { amount: inServings, unit: 'serving' };
}

/** Hidden foods still worth remembering: one hidden before the window starts has no logs left to hide. */
export function pruneHiddenRecentFoods(hidden: HiddenRecentFoods, now = new Date()): Record<string, number> {
  const windowStart = subDays(now, RECENT_WINDOW_DAYS).getTime();
  return Object.fromEntries(Object.entries(hidden).filter(([, at]) => Number.isFinite(at) && at >= windowStart));
}

/** The window's logs with their foods, for rankRecentFoods. */
export async function loadRecentLogs(userId: string, now = new Date()): Promise<{ logs: RecentLog[] | null; error: unknown }> {
  const from = format(subDays(now, RECENT_WINDOW_DAYS - 1), 'yyyy-MM-dd');
  const { data, error } = await fetchNutritionLogsWithFoods<Omit<RecentLog, 'food'>, Food>(
    userId,
    { from },
    'food_id, servings, source, date, logged_at, created_at',
    RECENT_FOOD_COLUMNS,
  );
  if (error || !data) return { logs: null, error: error ?? new Error('No logs') };
  const logs = data.map((log): RecentLog => ({
    ...log,
    servings: Number(log.servings) || 0,
    food: log.food
      ? {
          ...log.food,
          calories: Number(log.food.calories) || 0,
          protein: Number(log.food.protein) || 0,
          carbs: Number(log.food.carbs) || 0,
          fat: Number(log.food.fat) || 0,
          serving_size: Number(log.food.serving_size) || 1,
          serving_unit: log.food.serving_unit || 'serving',
        }
      : null,
  }));
  return { logs, error: null };
}
