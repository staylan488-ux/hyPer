# FatSecret Premier Free application package

Verified against FatSecret's published forms and documentation on 2026-07-19.

## Before applying

1. Register for a Basic FatSecret Platform account and create an application.
2. Record the client details securely. Never paste the secret into this repository, a screenshot, or the iPhone app.
3. Publish a small public Hyper site containing a product overview, privacy policy, terms, and support contact.
4. Prepare three to five screenshots showing barcode scanning, editable nutrition review, saved meals, meal buckets, and provenance.
5. Confirm that the applicant is eligible: a startup below US$1 million in annual revenue and below US$1 million in funding, a nonprofit, or a student/student research group.

## Application form

Open <https://platform.fatsecret.com/upgrade-account?type=1> and enter:

- Upgrade interested in: **Premier Free**
- Business/Organization/Startup: **Hyper**
- Countries: **United States**
- Raised less than US$1 million: answer truthfully
- Makes less than US$1 million annual revenue: answer truthfully
- API key / Client Details: the Basic application client identifier, never the secret

Use this inquiry text, adjusting only facts that are not yet true:

> Hyper is a pre-launch, mobile-first nutrition and fitness application being developed as a native iOS app. It combines barcode and food search, manual nutrition entry, editable AI-assisted food descriptions and photo estimates, reusable saved foods and meals, chronological daily meal/snack organization, workout logging, native run tracking, and user-authorized WHOOP and Apple Health integrations.
>
> We are requesting Premier Free access to the United States dataset for exact UPC/EAN barcode lookup, branded and restaurant food search, serving information, autocomplete, and food categories. Initial use will be a small TestFlight beta with low traffic. Hyper will not resell, bulk-copy, redistribute, or train models on FatSecret data. We will keep FatSecret credentials server-side and display the required FatSecret attribution inside the product, on the public website, and in the App Store listing.
>
> Before implementation, please confirm the following in writing:
> 1. May Hyper retain the food name, selected serving, calories, protein, carbohydrate, and fat as an immutable historical diary snapshot after a user logs an item?
> 2. May a user retain and edit a reusable saved food or saved meal that was originally selected from FatSecret?
> 3. If not, should Hyper store only food_id and serving_id and re-fetch the current display data, or use FatSecret's profile/food-diary/saved-meal endpoints?
> 4. Does this Premier Free approval include unlimited API calls for the US dataset, as shown on the current Editions page?
> 5. Is a static egress IP mandatory for our client-credentials proxy, and may we register a single proxy IP for development/staging plus another for production?
> 6. Please confirm the exact attribution placement expected in search results, barcode review, saved-food views, our public page, and the App Store listing.

## Required product architecture

- The iPhone and web clients call Hyper's authenticated backend, never FatSecret directly.
- FatSecret requires OAuth token requests through an allow-listed proxy. Hosted Supabase Edge Functions do not provide stable outbound IPs, so production needs a very small static-egress proxy or a written FatSecret exception.
- The proxy owns the FatSecret client ID/secret and returns only the requested response to the authenticated Hyper backend.
- Barcode requests use `food.find_id_for_barcode.v2`, a zero-padded GTIN-13, `region=US`, `format=json`, and `flag_default_serving=true`.
- Store `food_id` and `serving_id` indefinitely. Store other returned data only as permitted by FatSecret's written answer.
- Add the unmodified official attribution in every FatSecret-powered result surface, on a public page, and in the App Store description.

## Barcode benchmark before making FatSecret primary

Use 50 to 100 products that the owner actually buys. Include national brands, store brands, supplements, protein powders/bars, imported foods, curved labels, small codes, and at least five products known to fail the current scanner.

For each item, record:

| Field | Result |
|---|---|
| Product and brand | |
| Barcode digits | |
| Package condition/light | |
| Hyper decoded barcode? | yes / no |
| FatSecret returned exact product? | yes / no |
| Cronometer returned exact product? | yes / no |
| Serving matches label? | yes / no |
| Calories/protein/carbs/fat match label? | yes / no |
| Correction needed | |

Release targets under good light:

- Optical decode: at least 98%
- FatSecret exact lookup: at least 90%, with 95% preferred
- Correct serving and four primary macros: at least 95% of matches
- No incorrect product may be silently accepted; every result remains editable before logging

## Go/no-go decision

Activate FatSecret as Hyper's primary packaged-food provider only after:

- Premier Free is approved.
- Storage and attribution questions are answered in writing.
- The static-egress proxy is operating in isolated staging.
- The personal barcode benchmark passes.
- Retry, timeout, missing-product, incorrect-serving, and provider-outage cases pass.
- Historical logs and saved foods behave within the approved storage terms.

Until then, keep USDA generic search, the current staging barcode fallbacks, cited AI assistance, photo review, saved foods/meals, and manual entry.
