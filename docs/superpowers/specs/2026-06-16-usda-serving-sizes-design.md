# USDA Smart Serving Sizes — Design Spec

Date: 2026-06-16 · Branch: `fix/usda-serving-sizes` (new bugfix branch off `main`)
Scope: nutrition food-logging only. No DB schema, auth, or aggregation changes. Manual and Photo logging untouched.

## 1. Problem

When logging a food from the USDA database, every "serving" is hardcoded to **100 g**. A user
who types `3` servings of eggs expects 3 eggs but logs **300 g** of egg. This is wrong for every
USDA food, because the app treats one serving as a flat 100 g rather than the food's real portion.

## 2. Root cause

`mapUsdaFood` in [`src/components/nutrition/usdaSearch.ts`](../../../src/components/nutrition/usdaSearch.ts)
sets `serving_size: 100, serving_unit: 'g'` for all foods. USDA nutrient values are per 100 g, so the
app's model ("one serving = `serving_size` of `serving_unit`, macros are per serving") makes one
serving equal 100 g. The measurement/conversion layer in
[`foodLoggerUtils.ts`](../../../src/components/nutrition/foodLoggerUtils.ts) is correct; it is fed a
serving basis that ignores the food's real portion.

## 3. Decisions (confirmed with user)

- **Smart auto-serving.** Auto-detect each food's natural portion and make *that* "1 serving" — so
  typing `3` logs 3 eggs. Grams/oz/etc. remain available. A portion *picker* (small/medium/large) is
  out of scope.
- **Detail fetch on tap.** On food selection, make one USDA food-detail call to get authoritative
  portion data. Reliable for whole foods (eggs, chicken, rice), not just branded items. No extra calls
  while searching/typing.

## 4. Why the detail endpoint

The official OpenAPI spec's `SearchResultFood` schema (returned by `/v1/foods/search`) does **not**
guarantee portion fields. Authoritative portion data lives on the detail endpoint
`GET /v1/food/{fdcId}`:

- **Branded** (`BrandedFoodItem`): `servingSize` (number), `servingSizeUnit` (e.g. `g`, `ml`, `GRM`,
  `MLT`), `householdServingFullText` (e.g. `"1 EGG"`).
- **Foundation / SR Legacy** (`FoundationFoodItem` / `SRLegacyFoodItem`): `foodPortions[]`, each with
  `gramWeight`, `amount`, `modifier` (e.g. `"large"`), `measureUnit.name`, `portionDescription`,
  `sequenceNumber`.

Search still provides the food list and per-100 g macros (unchanged). The detail call only supplies
the portion.

## 5. Data flow

```
search (unchanged)            select (NEW)                         save (adjusted)
──────────────────            ───────────────────────────         ───────────────────────
mapUsdaFood -> Food           fetchUsdaFoodDetail(fdcId)           upsert keyed by
(per 100 g,                     -> selectPortionFromDetail()         fdc_id + serving basis;
 serving 100 g)                 -> applyPortion(food, portion)       insert NEW row if basis
                              = Food rescaled to per-portion         differs; never mutate
                                (serving_size = grams, label)        existing rows
```

## 6. New/changed units of work

All parsing/math lives in small pure functions (testable, no network):

- **`selectPortionFromDetail(detail): UsdaPortion | null`** — pure.
  `UsdaPortion = { grams: number; unit: 'g' | 'ml'; label: string }`.
  - Branded: if `servingSize > 0` and `servingSizeUnit` maps to mass (`g`/`GRM`) or volume
    (`ml`/`MLT`), return `{ grams: servingSize, unit, label }` where `label =` cleaned
    `householdServingFullText` (trimmed + lower-cased, e.g. `"1 EGG"` → `"1 egg"`) else
    `"{servingSize} {unit}"`.
  - Foundation/SR: from `foodPortions[]` with `gramWeight > 0`, pick the primary portion =
    lowest `sequenceNumber` (USDA's representative order); ties/missing → first. `grams = gramWeight`,
    `unit: 'g'`, `label =` `"{amount} {modifier}"` (e.g. `"1 large"`) else `portionDescription`.
  - Otherwise (no usable portion, exotic unit like `IU`) → `null`.
- **`applyPortion(foodPer100g, portion): Food`** — pure. If `portion` is `null`, return the food
  unchanged (today's 100 g default). Else rescale macros `value * grams / 100`, and set
  `serving_size = grams`, `serving_unit = portion.unit`, `serving_label = portion.label`.
- **`fetchUsdaFoodDetail(fdcId, apiKey, fetcher = fetch): Promise<UsdaFoodDetail | null>`** — network;
  `GET https://api.nal.usda.gov/fdc/v1/food/{fdcId}?api_key=…`. Returns `null` on any error/missing key.

`mapUsdaFood` is unchanged (still returns the per-100 g base Food), so existing search tests still pass.

## 7. Type change (no DB change)

Add an optional, **non-persisted** field to the `Food` interface in
[`src/types/index.ts`](../../../src/types/index.ts):

```ts
serving_label?: string; // display-only, e.g. "1 large egg"; never written to DB
```

Optional → existing constructions are unaffected; nothing writes it to Supabase.

## 8. History-safe caching

`upsertFoodIfNeeded` currently reuses a USDA food by `fdc_id` via `.maybeSingle()`. Mutating that
shared row's serving/macros would retroactively change the meaning of every historical
`nutrition_logs` entry pointing at it. Instead:

- Look up by `fdc_id` **and** matching `serving_size` **and** `serving_unit`, `.limit(1).maybeSingle()`.
- If a same-basis row exists, reuse it. Otherwise **insert a new row** with the per-portion macros and
  serving basis.
- Never `UPDATE` existing rows. Old per-100 g rows remain for old logs (intact history); new logs point
  at the corrected per-portion row. A food logged both before and after the change may have two rows —
  invisible to users, and `fdc_id` has no unique constraint (`supabase/schema.sql`).

## 9. UI changes (`FoodLogger.tsx`)

- **On tap of a search result:** set a per-row loading state, `await fetchUsdaFoodDetail`, build the
  enhanced Food via `applyPortion`, then `setSelectedFood`. On failure, fall back to the per-100 g Food
  so logging still works. Default stays amount `1`, unit `serving`.
- **Review card "per …" line** (currently `per {serving_size} {serving_unit}`): show
  `per {serving_label} ({serving_size} {serving_unit})` when `serving_label` is present, e.g.
  `per 1 large egg (50 g)`; otherwise unchanged.
- **Search result row** keeps showing per-100 g (`"{kcal} kcal / 100 g"`) — detail isn't fetched until
  tap. Acceptable: the review screen is where the portion is confirmed and logging happens.
- Macro grid and totals need no change — `selectedFood` macros are now per-portion, and totals are
  already `macros × servings`.

## 10. Aggregation/consumers — verified unchanged

All totals are computed as `food.macros × log.servings` (e.g.
[`Nutrition.tsx:199`](../../../src/pages/Nutrition.tsx)), and entries render as `"{servings} serving(s)"`.
Per-portion rows therefore render correctly with no changes to Nutrition/Dashboard/adherence code, and
"3 servings" now reads as 3 eggs in the log list too. Old logs keep their original rows and meaning.

## 11. Before → after (raw egg, ≈143 kcal/100 g)

- Before: result "143 kcal / 100 g" → Amount `3` × serving → **300 g, 430 kcal**.
- After: review "per 1 large egg (50 g)" → Amount `3` × serving → **3 eggs, ≈215 kcal**; switch unit to
  `g` → 150 g.

## 12. Edge cases

- Detail fetch fails / no API key → fall back to per-100 g (today's behavior); logging still works.
- `gramWeight` / `servingSize` missing or `0` → treated as no portion → 100 g fallback.
- Volume foods → `serving_unit: 'ml'`; `getCompatibleMeasurementUnits` already returns `['serving','ml']`.
- Exotic serving units (e.g. `IU`) → `null` → 100 g fallback.
- Macros stored as `DECIMAL(10,1)` — per-portion values round to 1 dp on store; fine.

## 13. Testing (Definition of Done)

New unit tests (Vitest): `selectPortionFromDetail` (branded, foundation/primary-portion pick, ml,
missing/exotic → null), `applyPortion` (rescale math incl. 143/100 g × 50 g ≈ 72 kcal; `null` →
unchanged), `fetchUsdaFoodDetail` (mock fetcher success + error → null). Existing
`usdaSearch.resilience.test.ts` and `foodLoggerUtils.test.ts` must still pass. Then run, and pass,
`npm run test`, `npm run lint`, `npm run build`.

## 14. Out of scope

Portion picker UI (small/medium/large), persisting `serving_label` to the DB, bulk migration of
existing cached foods, and any change to Manual/Photo logging.
