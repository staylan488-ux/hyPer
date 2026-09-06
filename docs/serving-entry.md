# AI serving entry

After choosing a barcode, USDA, or saved food, select **Describe amount** in the
shared serving editor. Enter an amount such as “I ate 6 pieces,” review the
calculation and nutrition, then choose **Use this amount** and **Log entry**.
For a food with five pieces per serving, six pieces becomes 1.2 servings.

Gemini interprets the consumed quantity and selects from units derived from the
food record. Application code divides by the quantity per serving and multiplies
the existing nutrition values. The model cannot supply replacement nutrition or
a serving multiplier. Explicit household labels and fixed metric conversions
are supported; unknown piece weights, densities, package sizes and vague amounts
require clarification. Manual amount entry remains available.

The helper uses the existing `analyze-food-trial` endpoint with action
`interpret-serving`, regardless of the photo-analysis preference. It shares
authentication, daily quota and same-day request replay with meal analysis, but
does not run nutrition research. Closing or changing the helper invalidates
pending results. No food is saved by analysis or by applying a result.

Serving values are rounded to the existing database precision of two decimals
before application. The review discloses rounding and uses the rounded amount
for nutrition. Values that round to zero cannot be applied.

Household labels are not persisted by the existing food schema. A cached food
with only a metric basis cannot infer a piece count unless that equivalence is
available in its current record. Open Food Facts household labels are used only
when the selected nutrition basis is per serving, never a per-100 g fallback.

For offline UI verification, visit `/preview`, open Fuel → Log food, and choose
“Samosas (serving demo).” The fixture accepts a number plus a known unit and
explicitly identifies itself as offline; it does not call Gemini.

Live use requires the updated `analyze-food-trial` function and web/native app
bundle to be released together through a separately authorized release. This
implementation does not change database schema or native code.
