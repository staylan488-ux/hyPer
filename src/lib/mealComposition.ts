import type { Food } from '@/types';

/** Each food retains its original nutrient/serving basis; servings is the amount used. */
export interface MealIngredient {
  id: string;
  food: Food;
  servings: number;
}

export interface MealComposition {
  version: 1;
  ingredients: MealIngredient[];
}

export interface MealDraft {
  name: string;
  ingredients: MealIngredient[];
  time: string;
  groupId: string | null;
  method: 'saved' | 'search' | 'barcode' | 'manual' | 'photo';
  date: string;
  entryId: string;
  saveAsReusableMeal: boolean;
  foodId?: string;
  locked: boolean;
}

export interface MealTotals {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export const MEAL_COMPOSITION_PREFIX = 'hyper:meal-composition:v1:';
const DRAFT_PREFIX = 'hyper:meal-draft:v1:';
const MAX_INGREDIENTS = 200;
const MAX_PAYLOAD_LENGTH = 1_000_000;
const sources: Food['source'][] = ['custom', 'usda', 'fatsecret', 'open_food_facts', 'saved_meal', 'manual_entry', 'cronometer', 'photo'];

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, max = 500): value is string {
  return typeof value === 'string' && value.length <= max;
}

function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function nutrient(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function parseFood(value: unknown): Food | null {
  if (!record(value)
    || !boundedString(value.id) || !boundedString(value.name) || !value.name.trim()
    || !(value.user_id === null || boundedString(value.user_id))
    || !nutrient(value.calories) || !nutrient(value.protein) || !nutrient(value.carbs) || !nutrient(value.fat)
    || !positive(value.serving_size) || !boundedString(value.serving_unit) || !value.serving_unit.trim()
    || !sources.includes(value.source as Food['source'])
    || !(value.fdc_id === null || boundedString(value.fdc_id))) return null;

  for (const key of ['description', 'external_source', 'external_id', 'serving_label']) {
    if (value[key] !== undefined && value[key] !== null && !boundedString(value[key], key === 'description' ? 100_000 : 500)) return null;
  }
  // Explicit copying excludes unexpected fields from persisted data.
  return {
    id: value.id, user_id: value.user_id, name: value.name,
    calories: value.calories, protein: value.protein, carbs: value.carbs, fat: value.fat,
    serving_size: value.serving_size, serving_unit: value.serving_unit,
    source: value.source as Food['source'], fdc_id: value.fdc_id,
    ...(typeof value.description === 'string' ? { description: value.description } : {}),
    ...(typeof value.external_source === 'string' ? { external_source: value.external_source } : {}),
    ...(typeof value.external_id === 'string' ? { external_id: value.external_id } : {}),
    ...(typeof value.serving_label === 'string' ? { serving_label: value.serving_label } : {}),
  };
}

function parseIngredients(value: unknown, allowEmpty = false): MealIngredient[] | null {
  if (!Array.isArray(value) || value.length > MAX_INGREDIENTS || (!allowEmpty && !value.length)) return null;
  const result: MealIngredient[] = [];
  const ids = new Set<string>();
  for (const item of value) {
    if (!record(item) || !boundedString(item.id) || !item.id || ids.has(item.id) || !positive(item.servings)) return null;
    const food = parseFood(item.food);
    if (!food) return null;
    for (const key of ['calories', 'protein', 'carbs', 'fat'] as const) {
      if (!Number.isFinite(food[key] * item.servings)) return null;
    }
    ids.add(item.id);
    result.push({ id: item.id, food, servings: item.servings });
  }
  const totals = result.reduce((sum, item) => sum + (item.food.calories + item.food.protein + item.food.carbs + item.food.fat) * item.servings, 0);
  return Number.isFinite(totals) ? result : null;
}

export function createMealIngredient(food: Food, servings: number, id = crypto.randomUUID()): MealIngredient {
  const ingredients = parseIngredients([{ id, food, servings }]);
  if (!ingredients) throw new Error('Choose a valid food and a quantity greater than zero.');
  return ingredients[0];
}

export function getMealTotals(ingredients: MealIngredient[]): MealTotals {
  const valid = parseIngredients(ingredients, true);
  if (!valid) throw new Error('Meal ingredients contain an invalid food or quantity.');
  return valid.reduce((totals, { food, servings }) => ({
    calories: totals.calories + food.calories * servings,
    protein: totals.protein + food.protein * servings,
    carbs: totals.carbs + food.carbs * servings,
    fat: totals.fat + food.fat * servings,
  }), { calories: 0, protein: 0, carbs: 0, fat: 0 });
}

/** Encodes one complete meal's ingredients in the existing description column. */
export function encodeMealComposition(ingredients: MealIngredient[]): string {
  const valid = parseIngredients(ingredients);
  if (!valid) throw new Error('Add valid ingredients before logging the meal.');
  const result = MEAL_COMPOSITION_PREFIX + JSON.stringify({ version: 1, ingredients: valid } satisfies MealComposition);
  if (result.length > MAX_PAYLOAD_LENGTH) throw new Error('This meal contains too much detail to save.');
  return result;
}

/** Ordinary prose descriptions and malformed/future payloads are not compositions. */
export function decodeMealComposition(description: string | null | undefined): MealComposition | null {
  if (!description?.startsWith(MEAL_COMPOSITION_PREFIX) || description.length > MAX_PAYLOAD_LENGTH) return null;
  try {
    const parsed: unknown = JSON.parse(description.slice(MEAL_COMPOSITION_PREFIX.length));
    if (!record(parsed) || parsed.version !== 1) return null;
    const ingredients = parseIngredients(parsed.ingredients);
    return ingredients ? { version: 1, ingredients } : null;
  } catch {
    return null;
  }
}

/** Expands a logged/saved meal quantity into its actual ingredient quantities. */
export function scaleMealIngredients(ingredients: MealIngredient[], servings: number): MealIngredient[] {
  if (!positive(servings)) throw new Error('Meal quantity must be greater than zero.');
  const scaled = parseIngredients(ingredients.map((item) => ({ ...item, servings: item.servings * servings })));
  if (!scaled) throw new Error('Meal ingredients contain an invalid food or quantity.');
  return scaled;
}

function draftKey(userId: string, draftId: string): string {
  return DRAFT_PREFIX + encodeURIComponent(userId) + ':' + encodeURIComponent(draftId);
}

export function parseMealDraft(value: unknown): MealDraft | null {
  if (!record(value) || !boundedString(value.name) || !['saved', 'search', 'barcode', 'manual', 'photo'].includes(value.method as string)
    || !boundedString(value.date, 10) || !/^\d{4}-\d{2}-\d{2}$/.test(value.date) || !Number.isFinite(Date.parse(value.date)) || new Date(value.date).toISOString().slice(0, 10) !== value.date
    || !boundedString(value.entryId) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.entryId)
    || typeof value.saveAsReusableMeal !== 'boolean' || typeof value.locked !== 'boolean'
    || !(value.foodId === undefined || boundedString(value.foodId))
    || !boundedString(value.time, 5) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.time)
    || !(value.groupId === null || boundedString(value.groupId))) return null;
  const ingredients = parseIngredients(value.ingredients, true);
  return ingredients ? {
    name: value.name, ingredients, time: value.time, groupId: value.groupId,
    method: value.method as MealDraft['method'], date: value.date, entryId: value.entryId,
    saveAsReusableMeal: value.saveAsReusableMeal, locked: value.locked,
    ...(typeof value.foodId === 'string' ? { foodId: value.foodId } : {}),
  } : null;
}

export function loadMealDraft(userId: string, draftId = 'new'): MealDraft | null {
  if (!userId) return null;
  try {
    const raw = localStorage.getItem(draftKey(userId, draftId));
    if (!raw || raw.length > MAX_PAYLOAD_LENGTH) return null;
    return parseMealDraft(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Returns false if the browser cannot persist the draft (e.g. storage is full). */
export function saveMealDraft(userId: string, draft: MealDraft, draftId = 'new'): boolean {
  if (!userId) return false;
  const valid = parseMealDraft(draft);
  if (!valid) return false;
  try {
    const raw = JSON.stringify(valid);
    if (raw.length > MAX_PAYLOAD_LENGTH) return false;
    localStorage.setItem(draftKey(userId, draftId), raw);
    return true;
  } catch {
    return false;
  }
}

export function clearMealDraft(userId: string, draftId = 'new'): void {
  if (!userId) return;
  try {
    localStorage.removeItem(draftKey(userId, draftId));
  } catch {
    // Storage can be unavailable in private browsing; closing still works.
  }
}
