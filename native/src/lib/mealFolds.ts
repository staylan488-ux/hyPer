// Which of Fuel's meals are folded down to their heading (tap a meal's
// heading). Kept on this phone, per account: it is how this screen is laid
// out here, not part of the account's data.
//
// A fold remembers the entries the meal held when it was folded, so it holds
// only while the meal has nothing else: food logged or moved into a folded
// meal opens it, and the new entry is never out of sight.
import { create } from 'zustand';

/** Each folded meal's entries when it was folded, oldest fold first. */
export type MealFolds = Record<string, string[]>;

/** The newest folds kept; a day's meals are a handful, so this is weeks of them. */
export const MEAL_FOLD_LIMIT = 60;

const foldsKey = (userId: string) => `hyper:meal-folds:${userId}`;

/** A meal's key: its own id, or the day's for the entries in no meal. */
export const mealFoldKey = (day: string, groupId?: string) => groupId ?? `none:${day}`;

/** Whether a fold still holds: the meal has no entry it lacked when it was folded. */
export function foldHolds(held: readonly string[] | undefined, entryIds: readonly string[]): boolean {
  return Boolean(held) && entryIds.every((id) => held!.includes(id));
}

/** The folds with this meal folded over its entries, as the newest; the oldest go past the limit. */
export function withMealFold(folds: MealFolds, key: string, entryIds: readonly string[]): MealFolds {
  const next: [string, string[]][] = [...Object.entries(folds).filter(([other]) => other !== key), [key, [...entryIds]]];
  return Object.fromEntries(next.slice(-MEAL_FOLD_LIMIT));
}

/** The folds with this meal open. */
export function withoutMealFold(folds: MealFolds, key: string): MealFolds {
  return Object.fromEntries(Object.entries(folds).filter(([other]) => other !== key));
}

/** Kept folds made whole: only meals with a list of entry ids, within the limit. */
export function wholeMealFolds(kept: unknown): MealFolds {
  if (!kept || typeof kept !== 'object' || Array.isArray(kept)) return {};
  const whole = Object.entries(kept).filter(
    (entry): entry is [string, string[]] => Array.isArray(entry[1]) && entry[1].every((id) => typeof id === 'string'),
  );
  return Object.fromEntries(whole.slice(-MEAL_FOLD_LIMIT));
}

const NONE: MealFolds = {};

/** What this phone keeps for an account, read once a launch. */
const kept = new Map<string, MealFolds>();
function keptFolds(userId: string): MealFolds {
  let folds = kept.get(userId);
  if (!folds) {
    try {
      const saved = globalThis.localStorage?.getItem(foldsKey(userId));
      folds = wholeMealFolds(saved ? JSON.parse(saved) : null);
    } catch {
      folds = NONE;
    }
    kept.set(userId, folds);
  }
  return folds;
}

/** Each account's folds as changed this launch. */
const useFolds = create<{ folds: Record<string, MealFolds> }>(() => ({ folds: {} }));

/** An account's folds now: as changed this launch, or as this phone keeps them. */
export function mealFoldsOf(userId: string): MealFolds {
  return useFolds.getState().folds[userId] ?? keptFolds(userId);
}

/**
 * The entries a meal was folded over, or undefined while it is open. Read on
 * the first render that asks, so Fuel opens with its meals as they were left.
 */
export function useMealFold(userId: string | null | undefined, key: string): string[] | undefined {
  return useFolds((state) => (userId ? (state.folds[userId] ?? keptFolds(userId))[key] : undefined));
}

function keep(userId: string, folds: MealFolds) {
  useFolds.setState((state) => ({ folds: { ...state.folds, [userId]: folds } }));
  try {
    globalThis.localStorage?.setItem(foldsKey(userId), JSON.stringify(folds));
  } catch {
    // holds until the app closes
  }
}

/** Folds a meal over the entries it has now; shows at once and is kept. */
export function foldMeal(userId: string | null | undefined, key: string, entryIds: readonly string[]) {
  if (userId) keep(userId, withMealFold(mealFoldsOf(userId), key, entryIds));
}

/** Opens a meal; shows at once and is kept. */
export function unfoldMeal(userId: string | null | undefined, key: string) {
  if (userId && key in mealFoldsOf(userId)) keep(userId, withoutMealFold(mealFoldsOf(userId), key));
}
