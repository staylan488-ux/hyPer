// The nutrition_logs -> foods join shared by Today, Fuel, Progress and the
// adaptive expenditure estimator.
//
// supabase/schema.sql declares nutrition_logs.food_id REFERENCES foods(id), so
// PostgREST could embed foods in one request. That snapshot was never checked
// against production and no migration creates the constraint, so the join
// stays two requests until the relationship is confirmed there. Food ids go in
// chunks so a month of many distinct (imported) foods cannot overflow the URL.
//
// Callers keep their own error policy: a failure in either request comes back
// as `error`, the same way a single embedded request would fail.

import type { PostgrestError } from '@supabase/supabase-js';
import { supabase } from './supabase';

export const FOOD_ID_CHUNK_SIZE = 200;

export interface NutritionLogDateRange {
  from: string;
  /** Inclusive. Omitted means no upper bound. */
  to?: string;
}

export type NutritionLogWithFood<Log, Food> = Log & { food: Food | null };

export interface NutritionLogsWithFoodsResult<Log, Food> {
  data: NutritionLogWithFood<Log, Food>[] | null;
  error: PostgrestError | null;
}

function chunk<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

/** Food rows by id, in chunks so many distinct ids cannot overflow the URL. */
function requestFoods(ids: string[], foodColumns: string) {
  return chunk(ids, FOOD_ID_CHUNK_SIZE).map((part) => supabase.from('foods').select(foodColumns).in('id', part));
}

/**
 * A user's logs in a date range, each with its food (or `food: null` when the
 * food row is missing). `logColumns` must include food_id and `foodColumns`
 * must include id.
 *
 * `expectedFoodIds` (say, the foods of the answer being reloaded) are read
 * alongside the logs instead of after them. Foods the logs do not use are
 * ignored, and any food the logs use that the early read did not return is
 * read once the logs arrive, so the result is the same as without the hint.
 */
export async function fetchNutritionLogsWithFoods<
  Log extends { food_id: string },
  Food extends { id: string },
>(
  userId: string,
  range: NutritionLogDateRange,
  logColumns: string,
  foodColumns: string,
  expectedFoodIds?: Iterable<string>,
): Promise<NutritionLogsWithFoodsResult<Log, Food>> {
  let logsQuery = supabase
    .from('nutrition_logs')
    .select(logColumns)
    .eq('user_id', userId)
    .gte('date', range.from);
  if (range.to !== undefined) logsQuery = logsQuery.lte('date', range.to);

  // A failed early chunk only means its ids are read again below.
  const expected = expectedFoodIds ? [...new Set(expectedFoodIds)].filter(Boolean) : [];
  const early = Promise.all(
    requestFoods(expected, foodColumns).map((request) => request.then((result) => result, () => null)),
  );

  const { data: logs, error: logsError } = await logsQuery;
  if (logsError) return { data: null, error: logsError };

  const rows = (logs ?? []) as unknown as Log[];
  if (rows.length === 0) return { data: [], error: null };

  const foods = new Map<string, Food>();
  const keep = (data: unknown) => {
    for (const food of (data ?? []) as Food[]) foods.set(food.id, food);
  };
  for (const result of await early) if (result && !result.error) keep(result.data);

  const foodIds = [...new Set(rows.map((row) => row.food_id).filter(Boolean))].filter((id) => !foods.has(id));
  const foodResults = await Promise.all(requestFoods(foodIds, foodColumns));
  const failed = foodResults.find((result) => result.error);
  if (failed?.error) return { data: null, error: failed.error };
  for (const result of foodResults) keep(result.data);

  return {
    data: rows.map((row) => ({ ...row, food: foods.get(row.food_id) ?? null })),
    error: null,
  };
}
