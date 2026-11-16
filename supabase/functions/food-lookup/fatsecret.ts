// What food-lookup asks FatSecret for and what it passes on. Kept free of
// Deno and network imports so tests can run it (index.ts makes the calls).
//
// FatSecret's terms and their written answer to hyPer (docs/fatsecret.md):
// the server may keep a food's IDs for good, and nothing else of a food for
// more than 24 hours. So nothing here is cached or stored except a barcode's
// food ID; names and numbers pass straight through to the phone, which may
// keep them.

/** Brand results one search returns (FatSecret's own default; its limit is 50). */
export const FATSECRET_SEARCH_RESULTS = 20;
/** Foods one lookup by ID may ask for. */
export const FATSECRET_FOODS_PER_REQUEST = 20;
/** Foods one counted lookup pays for: a request for more counts as several against the account's limit. */
export const FATSECRET_FOODS_PER_CLAIM = 5;
/** FatSecret calls one lookup by ID makes at a time. */
export const FATSECRET_FOODS_AT_ONCE = 5;

/** FatSecret's "no such ID" and "no food for this barcode": answers, not failures. */
const NO_SUCH_ID = 106;
const NO_SUCH_BARCODE = 211;

type Params = Record<string, string>;

/**
 * A typed search for packaged and restaurant food. Plain food comes from the
 * app's own list, so FatSecret is asked for brands only; `flag_default_serving`
 * marks the serving a result is shown and logged in.
 */
export function fatSecretSearchParams(query: string): Params {
  return {
    method: 'foods.search.v6',
    search_expression: query,
    food_type: 'brand',
    max_results: String(FATSECRET_SEARCH_RESULTS),
    flag_default_serving: 'true',
  };
}

/** One food with every serving, its default one marked. */
export function fatSecretFoodParams(foodId: string): Params {
  return { method: 'food.get.v6', food_id: foodId, flag_default_serving: 'true' };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** FatSecret gives a list of one as the bare item in some answers. */
function list(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return value === undefined || value === null ? [] : [value];
}

function pick(source: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' || typeof value === 'number') result[key] = value;
  }
  return result;
}

const FOOD_FIELDS = ['food_id', 'food_name', 'brand_name', 'food_type'] as const;
const SERVING_FIELDS = [
  'serving_id', 'serving_description', 'metric_serving_amount', 'metric_serving_unit',
  'measurement_description', 'is_default', 'calories', 'carbohydrate', 'protein', 'fat',
] as const;

/** A FatSecret food cut down to what the app reads (src/lib/fatSecret.ts), or null when it is no food. */
export function trimFatSecretFood(food: unknown): Record<string, unknown> | null {
  if (!record(food) || (typeof food.food_id !== 'string' && typeof food.food_id !== 'number')) return null;
  const servings = record(food.servings) ? list(food.servings.serving) : [];
  return {
    ...pick(food, FOOD_FIELDS),
    servings: { serving: servings.filter(record).map((serving) => pick(serving, SERVING_FIELDS)) },
  };
}

/** The error FatSecret reports inside a 200 answer, or null. */
export function fatSecretError(payload: unknown): { code: number; message: string } | null {
  if (!record(payload) || !record(payload.error)) return null;
  return { code: Number(payload.error.code) || 0, message: String(payload.error.message ?? '') };
}

/** The foods of a `foods.search` answer; an answer with no results has no list at all. */
export function fatSecretSearchFoods(payload: unknown): Record<string, unknown>[] {
  const search = record(payload) && record(payload.foods_search) ? payload.foods_search : null;
  const results = search && record(search.results) ? list(search.results.food) : [];
  return results.flatMap((food) => {
    const trimmed = trimFatSecretFood(food);
    return trimmed ? [trimmed] : [];
  });
}

export type FatSecretFoodAnswer =
  | { kind: 'found'; food: Record<string, unknown> }
  /** FatSecret no longer has this food. */
  | { kind: 'missing' }
  /** Anything else: the food may well exist. */
  | { kind: 'error'; code: number };

/** What a `food.get` answer says about one food. */
export function fatSecretFoodAnswer(payload: unknown): FatSecretFoodAnswer {
  const error = fatSecretError(payload);
  if (error) return error.code === NO_SUCH_ID ? { kind: 'missing' } : { kind: 'error', code: error.code };
  const food = trimFatSecretFood(record(payload) ? payload.food : null);
  return food ? { kind: 'found', food } : { kind: 'error', code: 0 };
}

export type FatSecretBarcodeId =
  | { kind: 'found'; foodId: string }
  | { kind: 'missing' }
  | { kind: 'error'; code: number };

/** The food ID a `food.find_id_for_barcode` answer names: an ID, which the server may cache. */
export function fatSecretBarcodeId(payload: unknown): FatSecretBarcodeId {
  const error = fatSecretError(payload);
  if (error) return error.code === NO_SUCH_BARCODE ? { kind: 'missing' } : { kind: 'error', code: error.code };
  const id = record(payload) && record(payload.food_id) ? payload.food_id.value : null;
  const foodId = typeof id === 'string' || typeof id === 'number' ? String(id).trim() : '';
  return /^[1-9]\d{0,19}$/.test(foodId) ? { kind: 'found', foodId } : { kind: 'missing' };
}

/** The distinct food IDs of a lookup by ID ("123,456"), or null when the request is not one. */
export function parseFoodIds(value: unknown): string[] | null {
  if (typeof value !== 'string' || value.length > 500) return null;
  const ids = [...new Set(value.split(',').map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0 || ids.length > FATSECRET_FOODS_PER_REQUEST) return null;
  return ids.every((id) => /^\d{1,20}$/.test(id)) ? ids : null;
}

/**
 * Looks up several foods, a few at a time. A food FatSecret no longer has is
 * `missing`; one whose lookup failed is in neither list, so the phone asks
 * again later.
 */
export async function fatSecretFoods(
  ids: readonly string[],
  getFood: (foodId: string) => Promise<unknown>,
): Promise<{ foods: Record<string, unknown>[]; missing: string[] }> {
  const foods: Record<string, unknown>[] = [];
  const missing: string[] = [];
  const queue = [...ids];
  const worker = async () => {
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      const answer = await getFood(id).then(fatSecretFoodAnswer, (): FatSecretFoodAnswer => ({ kind: 'error', code: 0 }));
      if (answer.kind === 'found') foods.push(answer.food);
      else if (answer.kind === 'missing') missing.push(id);
    }
  };
  await Promise.all(Array.from({ length: Math.min(FATSECRET_FOODS_AT_ONCE, queue.length) }, worker));
  return { foods, missing };
}

/** The lookups a request for this many foods counts as, beyond the one every request is charged. */
export function extraLookupClaims(foodCount: number): number {
  return Math.max(0, Math.ceil(foodCount / FATSECRET_FOODS_PER_CLAIM) - 1);
}
