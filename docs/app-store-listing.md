# App Store listing kit

Everything App Store Connect asks for before the public release, ready to copy
or upload. Written 2026-11-11 from main (011a6f7) and the release plan's
working decisions: free with no purchases, United States only, 18 and over,
Gemini for food analysis, WHOOP and the Mac worker hidden from new accounts,
crash reporting on.

Two answers only the owner can give are still placeholders everywhere:
`[SUPPORT EMAIL]` and `[SELLER NAME]`. The site's publish job refuses to run
while either is in `site/`.

## Web addresses

| Page | Address |
|---|---|
| Home (marketing URL) | https://staylan488-ux.github.io/hyPer/ |
| Privacy policy | https://staylan488-ux.github.io/hyPer/privacy/ |
| Terms of use | https://staylan488-ux.github.io/hyPer/terms/ |
| Support | https://staylan488-ux.github.io/hyPer/support/ |
| Food data credits | https://staylan488-ux.github.io/hyPer/support/#credits |

The pages are plain HTML in `site/`, published to GitHub Pages by
`.github/workflows/site.yml` on every push to main that touches `site/`.

To publish the first time:

1. Replace the two placeholders in `site/` and in
   `native/fastlane/metadata/copyright.txt`.
2. Merge to main.
3. Set the repository's Pages source to GitHub Actions, once. From a machine
   signed in to GitHub as the owner:
   `gh api -X POST repos/staylan488-ux/hyPer/pages -f build_type=workflow`
4. Run the "Public site" workflow (or push a change under `site/`), then open
   each address above.

If the site ever moves to its own domain, update the addresses here, in the
listing files and in the app's links together.

## Listing text

Upload-ready in [native/fastlane/metadata](../native/fastlane/metadata), in the
layout fastlane's `deliver` reads, so the existing App Store Connect key can
upload it. The text is repeated here for reading.

| Field | Limit | Value |
|---|---|---|
| Name | 30 | hyPer: Workout & Food Tracker (29) |
| Subtitle | 30 | Lift, log meals, build muscle (29) |
| Keywords | 100 bytes | gym,calorie,counter,macro,protein,nutrition,bulk,hypertrophy,program,volume,weight,barcode,diet (95) |
| Promotional text | 170 | Every set and every meal in one app. Weekly volume for each muscle, calorie and protein targets that follow your weight, and AI meal estimates you check before saving. (167) |
| Description | 4,000 | [description.txt](../native/fastlane/metadata/en-US/description.txt) (about 2,000) |
| Primary category | | Health & Fitness |
| Secondary category | | None |
| Copyright | | 2026 [SELLER NAME] |
| Support URL | | https://staylan488-ux.github.io/hyPer/support/ |
| Marketing URL | | https://staylan488-ux.github.io/hyPer/ |
| Privacy policy URL | | https://staylan488-ux.github.io/hyPer/privacy/ |

Keywords skip words already in the name and subtitle, which Apple indexes on
their own. Whether "hyPer: Workout & Food Tracker" is free as a store name is
only known when it is saved in App Store Connect; "hyPer: Lift & Fuel" is the
fallback.

## Review information

Reviewer notes: [notes.txt](../native/fastlane/metadata/review_information/notes.txt).

The demo account's email and password, and the owner's contact name, phone
and email, are entered in App Store Connect or kept in the private ship
config. They never go in this public repo. The demo account must:

- never expire, and skip email confirmation (created already confirmed);
- hold a program, about two weeks of workouts and food, and weigh-ins;
- have enough AI requests a day for a reviewer to try the feature;
- not see WHOOP or the Mac worker.

If the run tracker does not ship, delete the "Background location and audio"
section of the notes, the runs bullet in the description, and the "Location
and motion" section of the privacy policy.

## App privacy answers

"Do you or your third-party partners collect data from this app?" **Yes.**

For every type below: **not used for tracking**.

| Category › type | Collected | Purpose | Linked to the user |
|---|---|---|---|
| Contact Info › Name | Yes | App Functionality | Yes |
| Contact Info › Email Address | Yes | App Functionality | Yes |
| Health & Fitness › Health | Yes (weight, body details, food and nutrition logs, targets) | App Functionality | Yes |
| Health & Fitness › Fitness | Yes (workouts, sets, runs' distance and splits) | App Functionality | Yes |
| User Content › Photos or Videos | Yes (meal photos sent for AI analysis) | App Functionality | Yes |
| User Content › Other User Content | Yes (notes, meal descriptions, goals typed for target suggestions) | App Functionality | Yes |
| Identifiers › User ID | Yes (account ID) | App Functionality | Yes |
| Diagnostics › Crash Data | Yes | App Functionality | No |

Everything else: **not collected**. That includes Location (the run route is
processed on the phone and only totals are uploaded, so under Apple's
definition location is not collected), Contacts, Financial Info, Purchases,
Browsing History, Search History, Usage Data, Sensitive Info and Device ID.

Notes on the calls:

- Meal photos are not stored by hyPer, but Google keeps them for a limited
  time for abuse checks, which is longer than "processed in real time", so
  they are declared. Marking them linked is the cautious choice.
- Crash data is "not linked" only if the crash reporter never receives the
  account ID or email. If its setup keeps a per-install identifier, also
  declare Identifiers › Device ID, App Functionality, not linked. If
  performance tracing is turned on, add Diagnostics › Performance Data.
- If WHOOP ever ships to new accounts, nothing new is needed (it is fitness
  data), but the policy's WHOOP sentence must be rewritten.

## Age rating answers

Answer the questionnaire so it describes the app, then raise the result to
18+ with the override at the end (decision 5: Gemini's terms require users to
be 18 or older).

| Question | Answer |
|---|---|
| Parental controls | No |
| Age assurance | No |
| Unrestricted web access | No (the only web view is the sign-in sheet) |
| User-generated content | No (custom exercises are private once the backend work lands) |
| Messaging and chat | No |
| Advertising | No |
| Profanity or crude humor | None |
| Horror or fear themes | None |
| Alcohol, tobacco or drug use or references | None |
| Medical or treatment information | None |
| Health or wellness topics | Yes (calorie and nutrition tracking) |
| Sexual content or nudity | None |
| Violence (all kinds) | None |
| Simulated gambling, gambling, contests, loot boxes | None / No |
| Made for Kids | No |
| Age rating override | 18+ |

If Apple's form uses other labels, the intent is: no to everything except
health or wellness topics, then raise the rating to 18+.

## Other App Store Connect answers

| Question | Answer |
|---|---|
| Price | Free |
| In-app purchases | None |
| Availability | United States only |
| Content rights: third-party content | Yes, with the rights to use it (Open Food Facts under ODbL, USDA public data, FatSecret under its API terms) |
| Advertising identifier (IDFA) | No |
| Encryption | Already answered by the build (`usesNonExemptEncryption: false`) |
| Regulated medical device, if asked | No |
| EU trader status | Owner's declaration (the plan recommends non-trader for a free hobby app) |
| License agreement | Apple's standard EULA; the terms page covers the app's own rules |
| Version release | Manual |

## Credits

Required by the data sources, and placed on the support page, in the
description, and (in the app work) under You › About and next to results from
each source.

- Open Food Facts: "Product data from Open Food Facts, made available under
  the Open Database License (ODbL)", linking to world.openfoodfacts.org and
  the licence. The scan screen already does this.
- USDA: "Nutrient data from the U.S. Department of Agriculture, Agricultural
  Research Service, FoodData Central." Public domain; credit is requested,
  not required.
- FatSecret: the "Powered by fatsecret" attribution linking to
  fatsecret.com, in the app, on the public site and in the listing. Use
  FatSecret's official badge in the app. If FatSecret is not live in
  production at release, the line can stay ("where available") or come out.
- AI: results are marked as estimates; the policy names Google Gemini and
  Tavily.

## True before publishing

The policy and listing describe the app as it will be at release, not main
today. Each of these must be true, or the matching sentence changed, before
the pages go public:

| Statement | Made true by |
|---|---|
| The app asks permission before the first AI request | App changes (piece 3) |
| Deleting an account cuts the Sign in with Apple link | Backend (piece 1) and cutover (piece 4) |
| Crash reports carry no name, email, account ID or logged data | App changes (piece 3) |
| Google's paid Gemini service is used | Live check (piece 0) or cutover (piece 4) |
| Backups expire within 7 days | Supabase Pro (piece 4); change the sentence on another plan |
| Account emails come from a real email sender | Cutover (piece 4) |
| WHOOP and the Mac worker are not offered to new accounts | App changes (piece 3) |
| Minimum age is 18 | App changes (piece 3) |
| Custom exercises are private (no user-generated content) | Backend (piece 1) |
| AI has a daily limit per account and a shared daily budget | Backend (piece 1) |
| The Apple Health permission text names no brand | App changes (piece 3) |
| Run tracker ships (else remove its sections) | Alex's real run on the release build |

These pages are plain-language documents written from what the code does.
They have not been reviewed by a lawyer.
