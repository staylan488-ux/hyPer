# FatSecret in hyPer

FatSecret granted hyPer Premier Free access on 2026-11-16 (United States
dataset, unlimited calls, barcode lookup, autocomplete, food categories) and
answered hyPer's questions in writing the same day. This page is what the
code is built to. The key and secret live only in the backend's settings:
never in this repository, a pull request, a chat or the app.

## What hyPer uses FatSecret for

- **Brand search.** Typing in Log food > Search lists plain food from the
  app's own cleaned USDA list first, then packaged and restaurant food from
  FatSecret under "Brands". FatSecret is asked for brands only: its plain
  foods are USDA's, which the app already carries.
- **Barcodes.** The scanner asks FatSecret first, then USDA's branded records,
  then Open Food Facts.
- Not used yet: autocomplete and food categories.

## Their rules, and how the code keeps them

**Storage.** Their answer: "Raw nutritional data cannot be stored on your
servers for more than 24 hours. However, Food IDs and aggregated totals (such
as daily calorie and macro counts) can be stored on your servers indefinitely.
Additionally, you are fully permitted to store all historic raw data and
nutritional values locally on the user's device inside the app indefinitely."

- A FatSecret food's row in `foods` is a stub: `external_source = 'fatsecret'`,
  `external_id = '<food id>:<serving id>'`, the name "Brand food" and zeros.
  The food's name, serving and numbers are kept on the phone under those IDs
  (`src/lib/deviceFoods.ts`).
- Every read of logged food fills stubs in from the phone
  (`fetchNutritionLogsWithFoods`). A phone that does not hold a food (a new
  phone, a reinstall, the test app beside the released one) asks FatSecret
  for it again by ID and keeps the answer (`src/lib/deviceFoodRefill.ts`).
  A food that cannot be read stays "Brand food" with no numbers, and the
  weekly calorie estimate waits for a complete read instead of counting it
  as nothing.
- A built meal stores its FatSecret ingredients as IDs only
  (`encodeMealComposition`); the meal's own totals, an aggregate, stay on the
  server.
- `food-lookup` stores nothing FatSecret says about a food. It caches only
  which food ID a barcode belongs to.
- `food-lookup` answers FatSecret lookups only for builds that send
  `keeps: 'device'`. An older build, which saved FatSecret's name and numbers
  on the server, is told FatSecret is off and uses the other providers.

Two edges are judgment calls rather than settled: a saved meal's name is
prefilled from its foods' names and the user keeps or edits it, and a meal
made of a single brand food has totals equal to that food's numbers. Both are
the user's own saved meal; ask FatSecret if certainty is wanted.

**Advice.** Their answer: working targets out on the device and saying it is
not medical advice "is completely acceptable".

**Credit.** Their answer: a plain text line "Powered by fatsecret Platform
API" under search results, plus the sign-in or About screen, the website and
the App Store description, "is sufficient". In the app: under Brands in
Search, on the scan screen, on the sign-in screen and in You > About. The
website and the App Store description are still to do.

**Access.** FatSecret issues tokens only to the addresses listed for the key
in its developer console. Supabase functions call out from changing
addresses, so the key has to allow them (Premier keys take address ranges) or
the token request has to go through a host with a fixed address.

## Switching it on

Nothing here is on until all of these are done, each with the owner's go:

1. A build with this code is the one in use. An older build shows a logged
   brand food as "Brand food" with no calories.
2. The backend's settings hold `FATSECRET_CLIENT_ID`, `FATSECRET_CLIENT_SECRET`
   and `FATSECRET_ENABLED=1`, and `food-lookup` is deployed.
   `FATSECRET_SCOPE` is optional; without it FatSecret grants every scope the
   key has (search needs `premier`, the scanner `barcode`).
3. One real search, one barcode and one lookup by ID are checked against the
   live API: the method versions used (`foods.search.v6`, `food.get.v6`,
   `food.find_id_for_barcode`) were taken from FatSecret's documentation and
   had not been run with a key when this was written.
4. Rows from before this rule are cleared: any `foods` row with
   `external_source = 'fatsecret'` that still has a real name and numbers,
   and any `food_lookup_cache` row whose key starts with `fatsecret:`.
   The app copies such a food's details to the phone when it reads it, so
   clear the rows only after the account's phone has opened Fuel on the new
   build.

Setting `FATSECRET_ENABLED` to anything but `1` switches FatSecret off without
a deploy: brand results disappear from Search, the scanner falls through to
the other providers, and brand foods already logged keep showing from the
phone.

The application text sent to FatSecret is in
[fatsecret-premier-free-application.md](fatsecret-premier-free-application.md).
