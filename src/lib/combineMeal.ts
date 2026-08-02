/**
 * Collapsing an AI breakdown into a single logged meal.
 *
 * The photo analyser deliberately returns one item per visible food: that is
 * what makes the estimate accurate, because a plate is easier to judge
 * component by component than as a whole. It is not, however, how anyone wants
 * to READ their day — twelve rows for one dinner buries the rest of the log.
 *
 * So the breakdown stays the unit of estimation, and this collapses it into the
 * unit of record. Nothing is re-estimated here; the components are summed
 * exactly as reviewed, and the model's own summary is carried through as the
 * description so the detail is not lost, only folded up.
 *
 * Pure — no I/O, no clock reads.
 */

export interface CombinableItem {
  name: string;
  amountGrams: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface CombinedMeal {
  name: string;
  totalGrams: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  /** The model's description of the meal, or a component list if it gave none. */
  description: string;
}

/** Names listed in the meal title before it falls back to a count. */
const NAMED_IN_TITLE = 3;

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * "Chicken breast, white rice and olive oil", or "... and 4 more" past three.
 * Long enough to recognise the meal in a list, short enough to fit on one line.
 */
export function combinedMealName(items: CombinableItem[]): string {
  const names = items.map((item) => item.name.trim()).filter(Boolean);
  if (names.length === 0) return 'Meal';
  if (names.length === 1) return names[0];

  const shown = names.slice(0, NAMED_IN_TITLE);
  const remaining = names.length - shown.length;
  if (remaining > 0) return `${shown.join(', ')} and ${remaining} more`;
  return `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
}

/** Component list, used as the description when the model supplied no summary. */
function componentList(items: CombinableItem[]): string {
  return items
    .map((item) => `${item.name.trim()} ${Math.round(item.amountGrams)}g`)
    .filter((line) => line.trim())
    .join(', ');
}

/**
 * Sums a reviewed breakdown into one loggable meal. Returns null for an empty
 * breakdown so callers fall back to the per-item path rather than logging a
 * meal of nothing.
 */
export function combineIntoOneMeal(
  items: CombinableItem[],
  summary?: string | null,
): CombinedMeal | null {
  if (items.length === 0) return null;

  const totals = items.reduce(
    (sum, item) => ({
      grams: sum.grams + (Number.isFinite(item.amountGrams) ? item.amountGrams : 0),
      calories: sum.calories + (Number.isFinite(item.calories) ? item.calories : 0),
      protein: sum.protein + (Number.isFinite(item.protein) ? item.protein : 0),
      carbs: sum.carbs + (Number.isFinite(item.carbs) ? item.carbs : 0),
      fat: sum.fat + (Number.isFinite(item.fat) ? item.fat : 0),
    }),
    { grams: 0, calories: 0, protein: 0, carbs: 0, fat: 0 },
  );

  const described = summary?.trim();

  return {
    name: combinedMealName(items),
    // a meal has to weigh something or the serving maths downstream divides by
    // zero; one gram is the smallest honest floor
    totalGrams: Math.max(1, Math.round(totals.grams)),
    calories: Math.round(totals.calories),
    protein: round1(totals.protein),
    carbs: round1(totals.carbs),
    fat: round1(totals.fat),
    description: described || componentList(items),
  };
}
