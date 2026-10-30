import { createContext, useContext } from 'react';

import type { BarcodeProvider } from '@/lib/saveNutritionEntry';
import type { MealIngredient } from '@/lib/mealComposition';
import type { Food, NutritionGroup } from '@/types';
import type { FoodLog } from '~/lib/fuel';
import type { When } from '~/lib/foodLogger';

/** Where a chosen food came from, for its review line and log source. */
export type ChosenMeta = { source: 'barcode'; barcode: string; provider: BarcodeProvider } | null;

export type LoggerContextValue = {
  /** Logging entries, or adding ingredients to a meal being built. */
  purpose: 'log' | 'ingredients';
  editing: FoodLog | null;
  selectedKey: string;
  /** The page day's meal groups. */
  groups: NutritionGroup[];
  when: When;
  setWhen: (when: When) => void;
  savedMeals: Food[] | null;
  reloadSavedMeals: () => Promise<void>;
  /** Opens the review for a food from a list, a search or a scan (at `servings`, else one serving). */
  chooseFood: (food: Food, meta?: ChosenMeta, servings?: number) => void;
  /** Adds ingredients to the meal being built (ingredients purpose only). */
  addIngredients: (ingredients: MealIngredient[]) => void;
  /** A saved composed meal: opens it in the meal builder (log purpose). */
  composeMeal: (food: Food, editSaved?: boolean) => void;
  /** Closes the sheet after a confirmed save. */
  complete: () => void;
  /** A photo, describe or barcode lookup is running. */
  setBusy: (busy: boolean) => void;
};

export const LoggerContext = createContext<LoggerContextValue | null>(null);

export function useLogger(): LoggerContextValue {
  const value = useContext(LoggerContext);
  if (!value) throw new Error('useLogger outside the Log food sheet');
  return value;
}
