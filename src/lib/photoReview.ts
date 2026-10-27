// Reviewing and logging a worker photo analysis, shared by the web food logger
// and the native app.
import { combineIntoOneMeal } from '@/lib/combineMeal';
import type { PhotoAnalysisItem, PhotoAnalysisProvider } from '@/lib/photoAnalysis';
import { searchUsdaFoodsSecure } from '@/lib/usdaClient';
import type { Food } from '@/types';

export const MAX_PHOTO_UPLOAD_BYTES = 10 * 1024 * 1024;
// 2576px is the long edge the vision models accept at full resolution; the
// byte budget scales with the pixel count so the quality loop isn't forced to
// claw the resolution back as compression artifacts.
export const MAX_ANALYSIS_DATA_URL_CHARS = 4_400_000;
export const MAX_ANALYSIS_IMAGE_DIMENSION = 2576;
// portion accuracy degrades badly below this
export const MIN_ANALYSIS_JPEG_QUALITY = 0.6;
export const COMBINE_MEAL_KEY = 'hyper.nutrition.combine-meal';

export interface PhotoReviewItem {
  id: string;
  name: string;
  searchQuery: string;
  amountGrams: number;
  modelAmountGrams: number;
  modelCalories: number;
  modelProtein: number;
  modelCarbs: number;
  modelFat: number;
  confidence: number;
  notes: string;
  groundedFood: Food | null;
  groundingCandidates: Food[];
  persistedFoodId?: string;
}

/** The context line sent with the photos. */
export function buildPhotoHint(input: { plateDiameter: string; ingredients: string; details: string }): string {
  return [
    input.plateDiameter.trim() ? `Measured plate diameter: ${input.plateDiameter.trim()} cm.` : 'Plate diameter not measured.',
    input.ingredients.trim()
      ? `Oils, sauces, dressings, or hidden ingredients: ${input.ingredients.trim()}.`
      : 'Oils, sauces, dressings, or hidden ingredients were not specified.',
    input.details.trim() ? `Other details: ${input.details.trim()}.` : '',
  ].filter(Boolean).join(' ');
}

/**
 * Review rows for the model's items, each with up to three USDA candidates
 * measured in grams (volume matches would silently assume 1 g/ml). Grounding
 * is best-effort and never applied until the person picks a candidate.
 */
export async function groundPhotoItems(
  items: PhotoAnalysisItem[],
  search: (query: string) => Promise<Food[]> = searchUsdaFoodsSecure,
  stamp = Date.now(),
): Promise<PhotoReviewItem[]> {
  return Promise.all(items.map(async (item, index): Promise<PhotoReviewItem> => {
    let matches: Food[] = [];
    try {
      matches = await search(item.search_query);
    } catch {
      // the model's estimate stays editable and loggable
    }
    return {
      id: `photo-${stamp}-${index}`,
      name: item.name,
      searchQuery: item.search_query,
      amountGrams: item.estimated_grams,
      modelAmountGrams: item.estimated_grams,
      modelCalories: item.calories,
      modelProtein: item.protein_g,
      modelCarbs: item.carbs_g,
      modelFat: item.fat_g,
      confidence: item.confidence,
      notes: item.notes,
      groundedFood: null,
      groundingCandidates: matches.filter((food) => food.serving_unit.toLowerCase() === 'g').slice(0, 3),
    };
  }));
}

/** An item's macros at its reviewed grams, from the chosen USDA match or the model. */
export function photoItemTotals(item: PhotoReviewItem) {
  const basisGrams = item.groundedFood?.serving_size || item.modelAmountGrams;
  const factor = item.amountGrams / Math.max(1, basisGrams);
  const scale = (value: number) => Math.round(value * factor * 10) / 10;
  return {
    calories: scale(item.groundedFood?.calories ?? item.modelCalories),
    protein: scale(item.groundedFood?.protein ?? item.modelProtein),
    carbs: scale(item.groundedFood?.carbs ?? item.modelCarbs),
    fat: scale(item.groundedFood?.fat ?? item.modelFat),
  };
}

/** The line shown when the worker answered with the other provider than the one chosen. */
export function providerFallbackNote(chosen: PhotoAnalysisProvider, actual: PhotoAnalysisProvider, verb: string): string {
  if (chosen === actual) return '';
  return `${providerName(chosen)} was unavailable, so ${providerName(actual)} ${verb}. `;
}

export function providerName(provider: PhotoAnalysisProvider): string {
  return provider === 'anthropic' ? 'Claude' : 'OpenAI';
}

/** "USDA confirmed", "Match not chosen" or the model's confidence. */
export function photoItemStatus(item: PhotoReviewItem): string {
  if (item.groundedFood) return 'USDA confirmed';
  if (item.groundingCandidates.length > 0) return 'Match not chosen';
  return `${Math.round(item.confidence * 100)}% estimate`;
}

export function photoItemsInvalid(items: readonly PhotoReviewItem[]): boolean {
  return items.some((item) => !item.name.trim() || !Number.isFinite(item.amountGrams) || item.amountGrams <= 0);
}

/** The food an item logs as, and how many of its servings. */
export function photoItemFood(item: PhotoReviewItem): { food: Food; servings: number } {
  if (item.groundedFood) {
    return { food: item.groundedFood, servings: item.amountGrams / Math.max(1, item.groundedFood.serving_size || 100) };
  }
  const totals = photoItemTotals(item);
  return {
    food: {
      id: item.persistedFoodId || `photo-${item.id}`,
      user_id: null,
      name: item.name.trim(),
      ...totals,
      serving_size: item.amountGrams,
      serving_unit: 'g',
      // saved as custom, so it appears in Saved
      source: 'custom',
      fdc_id: null,
    },
    servings: 1,
  };
}

/**
 * Logs a reviewed plate: one combined entry (several items with "Log as one
 * meal" on), or one entry per item. Each logged item leaves the review through
 * `onItemLogged`; on a failure part-way the error says to retry the rest.
 */
export async function logPhotoItems(input: {
  items: PhotoReviewItem[];
  combine: boolean;
  summary: string;
  provider: PhotoAnalysisProvider;
  ensureFood: (food: Food) => Promise<string | null>;
  saveEntry: (foodId: string, servings: number, source: string) => Promise<boolean>;
  onFoodPersisted?: (itemId: string, foodId: string) => void;
  onItemLogged?: (itemId: string) => void;
}): Promise<void> {
  const source = input.provider === 'anthropic' ? 'photo_anthropic' : 'photo_openai';

  if (input.combine && input.items.length > 1) {
    const meal = combineIntoOneMeal(
      input.items.map((item) => ({ name: item.name.trim(), amountGrams: item.amountGrams, ...photoItemTotals(item) })),
      input.summary,
    );
    if (!meal) throw new Error('Could not combine the meal.');
    const foodId = await input.ensureFood({
      id: `photo-meal-${Date.now()}`,
      user_id: null,
      name: meal.name,
      calories: meal.calories,
      protein: meal.protein,
      carbs: meal.carbs,
      fat: meal.fat,
      serving_size: meal.totalGrams,
      serving_unit: 'g',
      source: 'custom',
      fdc_id: null,
      description: meal.description,
    });
    if (!foodId) throw new Error('Could not save the meal.');
    if (!await input.saveEntry(foodId, 1, source)) throw new Error('Could not log the meal.');
    return;
  }

  let logged = 0;
  try {
    for (const item of input.items) {
      const { food, servings } = photoItemFood(item);
      const foodId = await input.ensureFood(food);
      if (!foodId) throw new Error(`Could not save ${item.name}.`);
      input.onFoodPersisted?.(item.id, foodId);
      if (!await input.saveEntry(foodId, servings, source)) throw new Error(`Could not log ${item.name}.`);
      logged += 1;
      input.onItemLogged?.(item.id);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not save the photo items.';
    throw new Error(logged > 0
      ? `${message} ${logged} already logged item${logged === 1 ? ' was' : 's were'} removed from this review. Retry only the remaining items.`
      : message);
  }
}
