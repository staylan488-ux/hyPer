import { createContext, useContext, type Dispatch, type SetStateAction } from 'react';

import type { PendingEntryId } from '@/lib/pendingEntryId';
import type { BarcodeProvider } from '@/lib/saveNutritionEntry';
import type { MealIngredient } from '@/lib/mealComposition';
import type { Food, NutritionGroup } from '@/types';
import type { FoodLog } from '~/lib/fuel';
import type { When } from '~/lib/foodLogger';

/** Where a chosen food came from, for its review line and log source. */
export type ChosenMeta = { source: 'barcode'; barcode: string; provider: BarcodeProvider } | null;

export type QuickAddState = 'saving' | 'done' | 'error';

/**
 * A quick add not confirmed yet: its retry-safe id, and the time, meal and
 * day groups it was first sent with, so a retry writes that same entry.
 */
export type PendingQuickAdd = { pending: PendingEntryId; when: When; groups: NutritionGroup[]; inFlight: boolean };

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
  /** Claims the sheet for a lookup; the returned cleanup releases only that claim, once. Closing asks first meanwhile. */
  beginBusy: () => () => void;
  /** Claims the sheet for a read that opens a food (Search's portion read): Snap a meal is refused meanwhile, and closing doesn't ask. */
  beginRead: () => () => void;
  /** Holds the sheet open while a save runs; the returned cleanup releases only that claim, once. */
  beginSave: () => () => void;
  /**
   * List saves survive switching tabs or opening a food review. Each is kept
   * by its destination (day and meal) and food, so a food added to Breakfast
   * can still be added to Lunch.
   */
  quickAddStates: Record<string, QuickAddState>;
  setQuickAddStates: Dispatch<SetStateAction<Record<string, QuickAddState>>>;
  pendingQuickAdds: Map<string, PendingQuickAdd>;
};

export const LoggerContext = createContext<LoggerContextValue | null>(null);

export function useLogger(): LoggerContextValue {
  const value = useContext(LoggerContext);
  if (!value) throw new Error('useLogger outside the Log food sheet');
  return value;
}
