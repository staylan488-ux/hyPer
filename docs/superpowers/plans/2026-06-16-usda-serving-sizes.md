# USDA Smart Serving Sizes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "1 serving" of a USDA food equal the food's real portion (e.g. 1 large egg ≈ 50 g) instead of a flat 100 g, so typing `3` logs 3 eggs, not 300 g.

**Architecture:** On food selection, fetch the USDA food-detail endpoint to get authoritative portion data, pick the natural portion, rescale the per-100 g macros to per-portion, and store/display that as the serving. Caching inserts a new `foods` row when the serving basis differs and never mutates existing rows, so historical logs keep their meaning. No DB schema or auth changes.

**Tech Stack:** React 19 + TypeScript, Vitest, Supabase JS client, Vite (`import.meta.env`), TailwindCSS 4.

**Spec:** [`docs/superpowers/specs/2026-06-16-usda-serving-sizes-design.md`](../specs/2026-06-16-usda-serving-sizes-design.md)

---

## File Structure

- **`src/types/index.ts`** (modify) — add optional, non-persisted `serving_label?` to `Food`.
- **`src/components/nutrition/usdaSearch.ts`** (modify) — add detail types + three new exported functions: `selectPortionFromDetail` (pure), `applyPortion` (pure), `fetchUsdaFoodDetail` (network). `mapUsdaFood`/`searchUsdaFoods` unchanged.
- **`tests/usdaSearch.portions.test.ts`** (create) — unit tests for the three new functions.
- **`src/components/nutrition/FoodLogger.tsx`** (modify) — fetch+apply portion on result tap (with a per-row spinner), show the portion label on the review card, and make the USDA upsert key on the serving basis.

**Testing convention (follow the repo's existing pattern):** pure logic is unit-tested with Vitest; React components are *not* unit-tested (no React Testing Library is configured). UI/integration tasks are verified with `npm run lint` + `npm run build` and a manual smoke test.

---

## Task 1: Add `serving_label` to the `Food` type

**Files:**
- Modify: `src/types/index.ts:112-124`

- [ ] **Step 1: Add the optional field**

In `src/types/index.ts`, change the `Food` interface to add `serving_label`:

```ts
export interface Food {
  id: string;
  user_id: string | null;
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  serving_size: number;
  serving_unit: string;
  source: 'custom' | 'usda';
  fdc_id: string | null;
  serving_label?: string; // display-only, e.g. "1 large"; never written to the DB
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: build succeeds (the field is optional, so no existing construction breaks).

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "feat: add optional serving_label to Food type"
```

---

## Task 2: Pure portion helpers — `selectPortionFromDetail` + `applyPortion`

**Files:**
- Modify: `src/components/nutrition/usdaSearch.ts`
- Test: `tests/usdaSearch.portions.test.ts` (create)

- [ ] **Step 1: Write the failing tests**

Create `tests/usdaSearch.portions.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { applyPortion, selectPortionFromDetail } from '@/components/nutrition/usdaSearch';
import type { Food } from '@/types';

const baseFood: Food = {
  id: '123',
  user_id: null,
  name: 'Egg, whole, raw, fresh',
  calories: 143,
  protein: 12.6,
  carbs: 0.7,
  fat: 9.5,
  serving_size: 100,
  serving_unit: 'g',
  source: 'usda',
  fdc_id: '123',
};

describe('selectPortionFromDetail', () => {
  it('uses branded serving size and household serving text', () => {
    const portion = selectPortionFromDetail({
      dataType: 'Branded',
      servingSize: 40,
      servingSizeUnit: 'g',
      householdServingFullText: '1 PIECE',
      foodPortions: [],
    });

    expect(portion).toEqual({ size: 40, unit: 'g', label: '1 piece' });
  });

  it('falls back to "{size} {unit}" when there is no household text', () => {
    const portion = selectPortionFromDetail({
      dataType: 'Branded',
      servingSize: 30,
      servingSizeUnit: 'GRM',
    });

    expect(portion).toEqual({ size: 30, unit: 'g', label: '30 g' });
  });

  it('maps branded millilitre serving units to volume', () => {
    const portion = selectPortionFromDetail({
      dataType: 'Branded',
      servingSize: 240,
      servingSizeUnit: 'MLT',
      householdServingFullText: '1 cup',
    });

    expect(portion).toEqual({ size: 240, unit: 'ml', label: '1 cup' });
  });

  it('picks the primary food portion by sequence number', () => {
    const portion = selectPortionFromDetail({
      dataType: 'SR Legacy',
      foodPortions: [
        { gramWeight: 243, amount: 1, modifier: 'cup', sequenceNumber: 3 },
        { gramWeight: 50, amount: 1, modifier: 'large', sequenceNumber: 1 },
        { gramWeight: 44, amount: 1, modifier: 'medium', sequenceNumber: 2 },
      ],
    });

    expect(portion).toEqual({ size: 50, unit: 'g', label: '1 large' });
  });

  it('uses portionDescription when there is no modifier', () => {
    const portion = selectPortionFromDetail({
      dataType: 'SR Legacy',
      foodPortions: [{ gramWeight: 28, portionDescription: '1 slice', sequenceNumber: 1 }],
    });

    expect(portion).toEqual({ size: 28, unit: 'g', label: '1 slice' });
  });

  it('returns null when no usable portion exists', () => {
    expect(selectPortionFromDetail({ dataType: 'Foundation', foodPortions: [{ gramWeight: 0 }] })).toBeNull();
    expect(selectPortionFromDetail({ dataType: 'Branded', servingSize: 5, servingSizeUnit: 'IU' })).toBeNull();
    expect(selectPortionFromDetail({ dataType: 'Foundation' })).toBeNull();
    expect(selectPortionFromDetail(null)).toBeNull();
  });
});

describe('applyPortion', () => {
  it('rescales per-100g macros to the chosen portion', () => {
    const result = applyPortion(baseFood, { size: 50, unit: 'g', label: '1 large' });

    expect(result.serving_size).toBe(50);
    expect(result.serving_unit).toBe('g');
    expect(result.serving_label).toBe('1 large');
    expect(result.calories).toBeCloseTo(71.5, 5);
    expect(result.protein).toBeCloseTo(6.3, 5);
  });

  it('rounds serving_size to 2 decimals and macros to 1 decimal', () => {
    const result = applyPortion(baseFood, { size: 49.638, unit: 'g', label: '1 large' });

    expect(result.serving_size).toBe(49.64);
    expect(Number.isInteger(result.calories * 10)).toBe(true);
  });

  it('returns the food unchanged when there is no portion', () => {
    expect(applyPortion(baseFood, null)).toEqual(baseFood);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- usdaSearch.portions`
Expected: FAIL — `selectPortionFromDetail`/`applyPortion` are not exported from `usdaSearch.ts`.

- [ ] **Step 3: Implement the helpers**

In `src/components/nutrition/usdaSearch.ts`, add the following **above** `mapUsdaFood` (after the existing `UsdaSearchResponse` interface). Leave `mapUsdaFood` and `searchUsdaFoods` exactly as they are.

```ts
interface UsdaFoodPortion {
  gramWeight?: number;
  amount?: number;
  modifier?: string;
  portionDescription?: string;
  sequenceNumber?: number;
  measureUnit?: { name?: string; abbreviation?: string };
}

export interface UsdaFoodDetail {
  fdcId?: number;
  dataType?: string;
  description?: string;
  servingSize?: number;
  servingSizeUnit?: string;
  householdServingFullText?: string;
  foodPortions?: UsdaFoodPortion[];
}

export interface UsdaPortion {
  size: number;
  unit: 'g' | 'ml';
  label: string;
}

function normalizeServingSizeUnit(unitRaw: string | null | undefined): 'g' | 'ml' | null {
  if (!unitRaw) return null;
  const normalized = unitRaw.trim().toLowerCase();
  if (['g', 'grm', 'gram', 'grams'].includes(normalized)) return 'g';
  if (['ml', 'mlt', 'milliliter', 'milliliters', 'millilitre', 'millilitres'].includes(normalized)) return 'ml';
  return null;
}

function cleanLabel(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

function buildPortionLabel(portion: UsdaFoodPortion): string {
  const modifier = portion.modifier?.trim();
  const description = portion.portionDescription?.trim();
  const measure = portion.measureUnit?.name?.trim();
  const amount = typeof portion.amount === 'number' && portion.amount > 0 ? portion.amount : null;

  if (amount && modifier) return cleanLabel(`${amount} ${modifier}`);
  if (description) return cleanLabel(description);
  if (amount && measure && measure.toLowerCase() !== 'undetermined') return cleanLabel(`${amount} ${measure}`);
  if (modifier) return cleanLabel(modifier);
  return `${portion.gramWeight} g`;
}

export function selectPortionFromDetail(detail: UsdaFoodDetail | null | undefined): UsdaPortion | null {
  if (!detail) return null;

  // Branded foods carry a labelled serving size.
  const brandedUnit = normalizeServingSizeUnit(detail.servingSizeUnit);
  if (typeof detail.servingSize === 'number' && detail.servingSize > 0 && brandedUnit) {
    const household = detail.householdServingFullText?.trim();
    const label = household ? cleanLabel(household) : `${detail.servingSize} ${brandedUnit}`;
    return { size: detail.servingSize, unit: brandedUnit, label };
  }

  // Foundation / SR Legacy foods carry household portions; pick the representative one.
  const portions = (detail.foodPortions || []).filter(
    (portion) => typeof portion.gramWeight === 'number' && portion.gramWeight > 0
  );
  if (portions.length > 0) {
    const primary = [...portions].sort(
      (a, b) => (a.sequenceNumber ?? Number.MAX_SAFE_INTEGER) - (b.sequenceNumber ?? Number.MAX_SAFE_INTEGER)
    )[0];
    return { size: primary.gramWeight as number, unit: 'g', label: buildPortionLabel(primary) };
  }

  return null;
}

function roundMacro(value: number): number {
  return Math.round(value * 10) / 10; // foods.calories/protein/carbs/fat are DECIMAL(10,1)
}

export function applyPortion(food: Food, portion: UsdaPortion | null): Food {
  if (!portion) return food;

  const factor = portion.size / 100; // USDA macros are per 100 g
  return {
    ...food,
    calories: roundMacro(food.calories * factor),
    protein: roundMacro(food.protein * factor),
    carbs: roundMacro(food.carbs * factor),
    fat: roundMacro(food.fat * factor),
    serving_size: Math.round(portion.size * 100) / 100, // serving_size is DECIMAL(10,2)
    serving_unit: portion.unit,
    serving_label: portion.label,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- usdaSearch.portions`
Expected: PASS (all `selectPortionFromDetail` + `applyPortion` cases green).

- [ ] **Step 5: Commit**

```bash
git add src/components/nutrition/usdaSearch.ts tests/usdaSearch.portions.test.ts
git commit -m "feat: derive USDA portion + rescale macros from food detail"
```

---

## Task 3: Network helper — `fetchUsdaFoodDetail`

**Files:**
- Modify: `src/components/nutrition/usdaSearch.ts`
- Test: `tests/usdaSearch.portions.test.ts`

- [ ] **Step 1: Add the failing tests**

Append to `tests/usdaSearch.portions.test.ts`. First add `fetchUsdaFoodDetail` and `vi` to the existing imports at the top of the file:

```ts
import { describe, expect, it, vi } from 'vitest';

import { applyPortion, fetchUsdaFoodDetail, selectPortionFromDetail } from '@/components/nutrition/usdaSearch';
```

Then append this block at the end of the file:

```ts
describe('fetchUsdaFoodDetail', () => {
  it('fetches and returns the food detail JSON', async () => {
    const detail = {
      fdcId: 123,
      dataType: 'SR Legacy',
      foodPortions: [{ gramWeight: 50, amount: 1, modifier: 'large', sequenceNumber: 1 }],
    };
    const fetcher = vi.fn(async () => ({ json: async () => detail })) as unknown as typeof fetch;

    const result = await fetchUsdaFoodDetail('123', 'api-key', fetcher);

    expect(result).toEqual(detail);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining('/fdc/v1/food/123'));
  });

  it('returns null without an API key and does not call the network', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;

    expect(await fetchUsdaFoodDetail('123', undefined, fetcher)).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('returns null and logs when the request throws', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetcher = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;

    expect(await fetchUsdaFoodDetail('123', 'api-key', fetcher)).toBeNull();
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- usdaSearch.portions`
Expected: FAIL — `fetchUsdaFoodDetail` is not exported.

- [ ] **Step 3: Implement `fetchUsdaFoodDetail`**

In `src/components/nutrition/usdaSearch.ts`, add this function at the **end** of the file (after `searchUsdaFoods`):

```ts
export async function fetchUsdaFoodDetail(
  fdcId: string,
  apiKey: string | undefined,
  fetcher: typeof fetch = fetch
): Promise<UsdaFoodDetail | null> {
  if (!fdcId || !apiKey) return null;

  try {
    const response = await fetcher(
      `https://api.nal.usda.gov/fdc/v1/food/${encodeURIComponent(fdcId)}?api_key=${apiKey}`
    );
    return (await response.json()) as UsdaFoodDetail;
  } catch (error) {
    console.error('USDA food detail error:', error);
    return null;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- usdaSearch.portions`
Expected: PASS (all three `fetchUsdaFoodDetail` cases green).

- [ ] **Step 5: Commit**

```bash
git add src/components/nutrition/usdaSearch.ts tests/usdaSearch.portions.test.ts
git commit -m "feat: fetch USDA food detail endpoint for portion data"
```

---

## Task 4: Fetch + apply the portion when a search result is tapped

**Files:**
- Modify: `src/components/nutrition/FoodLogger.tsx` (imports ~21; state ~106; tap handler ~1147-1175)

This is a React component change. No unit test (the repo has no component tests); verify via `npm run lint` + `npm run build` + manual smoke test.

- [ ] **Step 1: Extend the usdaSearch import**

In `src/components/nutrition/FoodLogger.tsx`, replace:

```tsx
import { searchUsdaFoods } from './usdaSearch';
```

with:

```tsx
import { applyPortion, fetchUsdaFoodDetail, searchUsdaFoods, selectPortionFromDetail } from './usdaSearch';
```

- [ ] **Step 2: Add per-row loading state**

Directly after this existing line (~line 106):

```tsx
  const [loading, setLoading] = useState(false);
```

add:

```tsx
  const [loadingFoodId, setLoadingFoodId] = useState<string | null>(null);
```

- [ ] **Step 3: Replace the result-tap handler**

In the search results `motion.button`, replace the existing `onClick` (the synchronous handler that calls `setSelectedFood(food)`):

```tsx
                onClick={() => {
                  if (saving) return;

                  setSelectedFoodMeta(null);
                  setSelectedFood(food);
                  setMeasurementUnit('serving');

                  const defaultServings = 1;
                  setServings(String(defaultServings));
                  setMeasurementAmount(formatMeasurementAmount(defaultServings));
                }}
```

with:

```tsx
                onClick={async () => {
                  if (saving || loadingFoodId) return;

                  setSelectedFoodMeta(null);

                  let resolvedFood = food;
                  if (food.source === 'usda' && food.fdc_id) {
                    setLoadingFoodId(food.fdc_id);
                    try {
                      const apiKey = import.meta.env.VITE_USDA_API_KEY;
                      const detail = await fetchUsdaFoodDetail(food.fdc_id, apiKey);
                      resolvedFood = applyPortion(food, selectPortionFromDetail(detail));
                    } finally {
                      setLoadingFoodId(null);
                    }
                  }

                  setSelectedFood(resolvedFood);
                  setMeasurementUnit('serving');

                  const defaultServings = 1;
                  setServings(String(defaultServings));
                  setMeasurementAmount(formatMeasurementAmount(defaultServings));
                }}
```

- [ ] **Step 4: Disable rows while one is loading, and show a spinner on the tapped row**

In the same `motion.button`, replace:

```tsx
                disabled={saving}
```

with:

```tsx
                disabled={saving || loadingFoodId !== null}
```

Then replace the trailing icon span:

```tsx
                <span className="flex items-center justify-center w-8 h-8 rounded-[var(--radius-xs)] bg-[var(--color-surface-3)] shrink-0">
                  <Plus className="w-3.5 h-3.5 text-[var(--color-text-dim)]" strokeWidth={2.25} />
                </span>
```

with:

```tsx
                <span className="flex items-center justify-center w-8 h-8 rounded-[var(--radius-xs)] bg-[var(--color-surface-3)] shrink-0">
                  {loadingFoodId === food.fdc_id ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--color-text-dim)]" />
                  ) : (
                    <Plus className="w-3.5 h-3.5 text-[var(--color-text-dim)]" strokeWidth={2.25} />
                  )}
                </span>
```

(`Loader2` is already imported at the top of the file.)

- [ ] **Step 5: Verify lint + build**

Run: `npm run lint`
Expected: no new errors.
Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/components/nutrition/FoodLogger.tsx
git commit -m "feat: fetch real USDA portion when a search result is tapped"
```

---

## Task 5: Show the portion label on the review card

**Files:**
- Modify: `src/components/nutrition/FoodLogger.tsx` (review card "per …" line ~999-1001)

- [ ] **Step 1: Replace the "per" line**

In the review/confirm stage, replace:

```tsx
          <p className="text-[10px] text-[var(--color-muted)] mt-2">
            per {formatMeasurementAmount(selectedFood.serving_size || 1)} {selectedFood.serving_unit || 'serving'}
          </p>
```

with:

```tsx
          <p className="text-[10px] text-[var(--color-muted)] mt-2">
            {selectedFood.serving_label
              ? `per ${selectedFood.serving_label} (${formatMeasurementAmount(selectedFood.serving_size || 1)} ${selectedFood.serving_unit || 'g'})`
              : `per ${formatMeasurementAmount(selectedFood.serving_size || 1)} ${selectedFood.serving_unit || 'serving'}`}
          </p>
```

- [ ] **Step 2: Verify lint + build**

Run: `npm run lint`
Expected: no new errors.
Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/nutrition/FoodLogger.tsx
git commit -m "feat: label USDA serving with its real portion on review card"
```

---

## Task 6: History-safe caching — key the USDA upsert on the serving basis

**Files:**
- Modify: `src/components/nutrition/FoodLogger.tsx` (`upsertFoodIfNeeded`, USDA branch ~605-644)

**Why:** The current lookup reuses a cached food by `fdc_id` alone. A food cached before this change has a 100 g basis; reusing it would re-introduce the bug, and *mutating* it would retroactively rewrite every historical `nutrition_logs` entry that points at it. Instead, match on `fdc_id` **and** the serving basis, and insert a new row when the basis differs.

- [ ] **Step 1: Replace the USDA lookup + insert branch**

Replace this block:

```tsx
    if (food.source === 'usda' && food.fdc_id) {
      const { data: existingFood, error: lookupError } = await supabase
        .from('foods')
        .select('id')
        .eq('fdc_id', food.fdc_id)
        .maybeSingle();

      if (lookupError) {
        console.error('Error looking up food:', lookupError);
      }

      if (existingFood) {
        foodId = existingFood.id;
      } else {
        const { data: newFood, error: insertError } = await supabase
          .from('foods')
          .insert({
            name: food.name,
            calories: food.calories,
            protein: food.protein,
            carbs: food.carbs,
            fat: food.fat,
            serving_size: food.serving_size || 100,
            serving_unit: food.serving_unit || 'g',
            source: 'usda',
            fdc_id: food.fdc_id,
          })
          .select('id')
          .single();

        if (insertError) {
          console.error('Error creating food:', insertError);
          return null;
        }

        if (newFood) {
          foodId = newFood.id;
        }
      }
    }
```

with:

```tsx
    if (food.source === 'usda' && food.fdc_id) {
      const servingSize = food.serving_size || 100;
      const servingUnit = food.serving_unit || 'g';

      // Match on the serving basis too: a food cached before portions existed has a
      // 100 g basis and is tied to historical logs. Reuse only a same-basis row;
      // otherwise insert a new one. Never mutate existing rows.
      const { data: existingFood, error: lookupError } = await supabase
        .from('foods')
        .select('id')
        .eq('fdc_id', food.fdc_id)
        .eq('serving_size', servingSize)
        .eq('serving_unit', servingUnit)
        .limit(1)
        .maybeSingle();

      if (lookupError) {
        console.error('Error looking up food:', lookupError);
      }

      if (existingFood) {
        foodId = existingFood.id;
      } else {
        const { data: newFood, error: insertError } = await supabase
          .from('foods')
          .insert({
            name: food.name,
            calories: food.calories,
            protein: food.protein,
            carbs: food.carbs,
            fat: food.fat,
            serving_size: servingSize,
            serving_unit: servingUnit,
            source: 'usda',
            fdc_id: food.fdc_id,
          })
          .select('id')
          .single();

        if (insertError) {
          console.error('Error creating food:', insertError);
          return null;
        }

        if (newFood) {
          foodId = newFood.id;
        }
      }
    }
```

- [ ] **Step 2: Verify lint + build**

Run: `npm run lint`
Expected: no new errors.
Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/nutrition/FoodLogger.tsx
git commit -m "fix: key USDA food cache on serving basis to protect log history"
```

---

## Task 7: Full Definition-of-Done verification + manual smoke test

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm run test`
Expected: PASS, including `usdaSearch.portions`, `usdaSearch.resilience`, and `foodLoggerUtils`.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: clean (no new warnings/errors).

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 4: Manual smoke test** (requires `VITE_USDA_API_KEY` in the dev env)

Run: `npm run dev`, then in the Nutrition logger → Search:
- Search `egg`, tap a whole-egg result → spinner shows briefly → review card reads roughly `per 1 large (≈50 g)`, with per-egg macros (≈70–75 kcal), **not** 143 kcal/100 g.
- Amount `3` × `serving` → "This entry" ≈ 3× one egg (≈215 kcal). Switch unit to `g` → shows ≈150 g.
- Log it → in the day list it reads `3 servings` and the calories match 3 eggs.
- Search a clearly branded item (e.g. a protein bar) → review card shows its label serving (e.g. `per 1 bar (60 g)`).
- Search something obscure with no USDA portion → falls back to `per 100 g` and still logs correctly.
- Edit an entry logged **before** this change → its macros/servings are unchanged (history intact).

- [ ] **Step 5: Final commit (if any cleanup was needed)**

```bash
git add -A
git commit -m "chore: USDA smart serving sizes verification"
```

(Skip if Steps 1–4 required no changes.)

---

## Self-Review notes

- **Spec coverage:** §4 detail endpoint → Task 3; §6 `selectPortionFromDetail`/`applyPortion`/`fetchUsdaFoodDetail` → Tasks 2–3; §7 `serving_label` type → Task 1; §8 history-safe caching → Task 6; §9 UI (tap fetch, spinner, review label) → Tasks 4–5; §10 aggregation unchanged → confirmed, no task needed; §12 edge cases → covered by `selectPortionFromDetail`/`applyPortion` null paths (Task 2 tests) and the fetch-failure fallback (Task 4 handler); §13 testing → Tasks 2, 3, 7.
- **Type consistency:** `UsdaPortion` uses `{ size, unit, label }` everywhere (Tasks 2–4). `applyPortion(food, portion)` and `selectPortionFromDetail(detail)` signatures match between the implementation and tests. `serving_label` (Task 1) is the field set by `applyPortion` (Task 2) and read by the review card (Task 5).
- **No placeholders:** every code step contains complete code; commands have expected output.
