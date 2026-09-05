# Search choice for the meal logger — 2026-09-05

**Decision implemented and backend deployed:** Gemini 3.8 Flash with Tavily and compact review. The authorized deployment passes negative-authentication/native CORS checks; a positive signed-in hosted meal remains pending. The fourth separately authorized bounded combined run **returned an accepted application meal** in 13.564 seconds: six chicken tikka samosas, 270 kcal/P13.5/C21/F15, no clarification. Exact named nutrient evidence matched a four-piece serving table on a secondary site. This verifies one real accepted result, not the user's actual package or broad provider accuracy. The subsequent main #106 integration passes 759 tests/69 files, lint, build, strict backend TypeScript and signed iOS compilation. The operational guide records every attempt and limitation.

The [implementation/evaluation guide](gemini-food-trial.md) is the current operational handoff. It also preserves the separate earlier three-request Google-only display experiment, including measured latency/tokens and unresolved accuracy/billing limitations. Those results do not establish Tavily performance.

## Accepted workflow and implementation

Photo or text → concise meal and macros → adjust if needed → save. Research happens in the backend. A missing fact that materially changes the result produces one short clarification instead of a list of articles. Sources are optional details; short material uncertainty remains visible before saving. There is no blanket confirmation checkbox. Amounts may be inferred even when a nutrition label supplies the serving basis.

Gemini 3.8 Flash remains the exact interpretation model. The Supabase function plans public product research, uses Tavily basic Search and advanced Extract for selected sources, then asks Gemini to produce normalized meal facts. It uses up to three Gemini requests (two for generic meals), two searches and two selected URLs within a 90-second overall deadline. Search snippets help select sources; actual extracted or supplied label evidence supports nutrition. The model prefers the exact manufacturer/restaurant product, variant, market, preparation and original serving units. Code performs amount/basis multiplication. Inadequate branded evidence or consequential conflicts require a targeted clarification; generic/photo portions can remain explicitly estimated.

The current requests do not enable Google Search grounding or Tavily's generated-answer feature. Photos remain with Gemini; Tavily receives planned public product queries rather than the raw meal narrative, user identity, health information or diary. Query planning is model interpretation and is not a formal guarantee that every generated query is correct. Durable storage retains only normalized facts, source title/URL provenance and usage, not fetched pages, snippets, support quotes or model reasoning.

Normal sign-in and ownership apply without a special allowlist, enrollment system, auth-flow change or database-schema change. The daily quota and duplicate-call protections are ordinary request controls. Existing worker code remains available for separate uses; this meal path removes the Mac/Tailscale dependency.

## Why Tavily was selected

Tavily's platform terms distinguish Output from Services; the restriction on modifying Services does not automatically apply to Output. Its official agent integration guide expressly describes processing results, storing them in databases/CRMs and passing them to another AI workflow. No mandatory results widget or general customer output-retention limit was identified in the reviewed materials. That supports a compact Gemini-generated review and factual record with optional provenance where source obligations allow it. [Platform terms, §§1.6–1.7, 3.2, 6, 10](https://www.tavily.com/terms), [documented processing/storage workflow](https://help.tavily.com/articles/8603494007-connecting-tavily-to-n8n)

This is a documented workflow/terms rationale, not a claim that Tavily finds more accurate food labels. The bounded combined tests below did not produce a usable meal estimate; successful label matching and reference-based accuracy are not established. No specific Tavily contractual blocker requiring custom permission was identified for this narrow facts-and-review design. That is not blanket ownership of retrieved pages: source-specific licenses and notices still apply, and storing factual quantities differs from republishing source text, label images or a source database.

## Earlier alternatives and their unresolved questions

### Google grounding

The earlier Google design's terms required associated Search suggestions, restricted modifications and storage, and provided narrow exceptions. Chat history is for viewing history; individual copying excludes automated database collection. The reviewed terms did not expressly resolve automatic nutrient-diary storage and durable response replay, and no two-user exemption was found. Requesting a short response or passing grounded output to another model did not establish permission to remove those obligations. [Google Grounding terms](https://ai.google.dev/gemini-api/terms#grounding-with-google-search)

If Google grounding is reintroduced later, clarify the applicable permission for extraction, edits, persistent records/replays and attribution. This historical concern does not block the current non-grounded Gemini–Tavily path. It was not a verified blanket prohibition on personal nutrition logging, and a live API success could not settle the contractual interpretation. The old experiment also showed that a model's label claim can exceed the strength of its returned source evidence; the original package/formulation was not independently confirmed.

### Exa

Exa Search and Contents support domain filtering and page retrieval and could technically serve manufacturer-first matching. However, the reviewed terms linked from its pricing footer contained broad restrictions in §4.2(a) on copying, modifying and deriving information, and §4.2(j) on automated extraction. Documentation described API retrieval, but did not clearly reconcile those clauses with durable editable nutrient records. No Google-style suggestion widget mandate was found; that alone did not resolve the output-use question. Exa was not integrated. [Search](https://exa.ai/docs/reference/search), [Contents](https://exa.ai/docs/reference/get-contents), [reviewed Exa terms](https://exa.ai/assets/Exa_Labs_Terms_of_Service.pdf)

These are scoped interpretations of the reviewed published material, not legal advice or guarantees about every source/customer agreement. No provider agreement was accepted on the user's behalf through this implementation.

## Cost illustration and actual accounting

The implementation records actual returned Gemini usage across model calls and Tavily reported credits. Known subtotals survive partial failures, while missing usage remains unknown. Request-based credit estimates are shown separately; old Google Search charges are not relabeled as Tavily.

For illustration only, using Tavily's published $0.008 pay-as-you-go credit rate before free credits, Gemini tokens, hosting and tax:

| Retrieval pattern | Amortized credit/cost illustration | At 180 such meals/month |
| --- | --- | --- |
| One basic search + one successful advanced extraction | 1.4 credits / $0.0112 | $2.02 |
| Two basic searches + two successful advanced extractions | 2.8 credits / $0.0224 | $4.03 |

Advanced extraction is billed in groups of five successful URLs; these per-page figures are amortized illustrations, not guaranteed per-request charges or a hard dollar cap. Actual account plan/free credits, grouping, successful extraction count, unreported failures and additional Gemini calls determine the bill. The earlier recommendation's one-search/one-*basic*-extraction example was $0.0096; the implemented extractor uses *advanced* depth. Bounded live timings and partial usage are recorded below; complete token prices and invoiced costs remain unknown. [Tavily credits/pricing](https://docs.tavily.com/documentation/api-credits), [Search API](https://docs.tavily.com/documentation/api-reference/endpoint/search), [Extract API](https://docs.tavily.com/documentation/api-reference/endpoint/extract)

## Direct adapter evidence — 2026-09-05

One basic Tavily search plus one advanced extraction completed in 6.146 seconds, with 1 reported credit versus the code's amortized 1.4-credit/$0.0112 pay-as-you-go estimate. This was not an invoice; pay-as-you-go was off and the account showed 1,000 free credits/zero prior use before the check. No Gemini call occurred.

The chicken tikka samosa search produced four secondary chicken-product results and a manufacturer **vegetable** samosa page. The simple test harness preferred the manufacturer and extracted that wrong-variant page (7,784 characters). Connectivity, extraction and usage reporting succeeded; correct matching and food accuracy did not thereby succeed. The later combined rerun excluded this vegetable source, but its validated app result still contained no usable meal. No broad Tavily quality claim follows from either observation.

## Combined live evidence — 2026-09-05

The exact pipeline was tested with “I ate six Trader Joe's chicken tikka samosas.” The first attempt took 8.138 seconds: planning and selection returned HTTP 200, followed by HTTP 400 for the final structured meal request. Its detailed upstream error was not captured. Removing numeric/array bounds from the wire schema, while keeping runtime bounds, preceded a successful provider rerun; schema complexity is a hypothesis rather than a proven root cause.

The single authorized rerun took **12.298 seconds** with all three Gemini requests returning 200. It reported **9,259 prompt / 384 output / 972 thinking / 10,615 total tokens**; missing cached counts prevent a complete token-price estimate. Tavily performed one search and one advanced extraction of two URLs: **2 reported credits** versus **1.8 estimated credits / $0.0144**, with the free allowance applicable. These are usage observations/illustrative estimates, not invoice reconciliation.

Gemini planned Chicken Tikka Samosas with variant `Regular`, selected Open Food Facts and Eat This Much chicken pages, and excluded the official vegetable result at index 4. Post-validation returned a generic package-label question and `items=[]`. **The combined run delivered no usable macros.** The raw final candidate was not captured, so the exact rejection reason is unknown. Local changes address invented default `Regular` matching and plural `Fats`/table-format parsing, but these have not been proved to explain that earlier run. A separately authorized post-fix run is described below.

An independent secondary [Eat This Much page](https://www.eatthismuch.com/calories/mini-samosas-chicken-tikka-2328292) lists 4 pieces/80 g at 180 kcal, P9/C14/F10; six pieces scales to 270 kcal, P13.5/C21/F15. That is independent arithmetic from a secondary record, not a package-verified result or the combined model output. Earlier Google plain Search took 13.891 seconds, used four queries/eight sources and surfaced conflicting 240-versus-270-kcal records. Same product and different prompts/workflows do not form a quality benchmark.

Both originally allowed combined attempts were used. A subsequent separate authorization permitted the one additional check below. All temporary harness servers were stopped, the wrapper was removed, credentials remained masked/unexposed and clipboard content was replaced. No function deployment or ledger/diary write occurred through these tests.

## Separately authorized final check

The third combined run took 12.787 seconds, all three Gemini requests HTTP 200. It used an empty variant, selected chicken pages and excluded the vegetable result. Fooducate extraction was a dead product page; Open Food Facts was the secondary evidence. Gemini returned no clarification and proposed six pieces against a four-piece/180-kcal basis (P9/C14/F10), yielding 270 kcal/P13.5/C21/F15. These model-proposed values are not authoritative package verification or a saved app meal.

The app returned no foods because nutrient support excerpts were bare values, without nutrient names. All excerpts occurred in the retrieved text, but occurrence alone does not bind the value to the nutrient/serving column. Diagnostics distinguish this concrete failure from the prior ambiguous rejection. The local instruction now explicitly requires exact named nutrient/value/unit fields on the same serving basis; validation remains intact, and no further paid run was made. At that point the correction remained untested; the subsequently authorized accepted run used the simpler named Eat This Much table. Complex multi-column coverage remains limited.

Usage: 7,515 prompt/393 output/911 thinking/8,819 total tokens; cached counters missing, so complete Gemini cost unknown. An all-input-uncached illustration at the recorded introductory rates is $0.01052625, not an invoice. Tavily reported 1 credit (extraction 0) versus 1.8 estimated/$0.0144 before free allowance; zero reported extraction can reflect grouped accounting. Full timing/source/cost limitations and safe cleanup are in the operational guide. No demonstrated accuracy advantage or validated macro delivery follows.

## Subsequently accepted application result

One newly authorized verification completed in **13.564 seconds**, all three Gemini requests HTTP 200 and returned model version `gemini-3.8-flash`. The original model and actual application result agreed: one chicken tikka item, six pieces, four-piece/80-g basis at 180 kcal/P9/C14/F10; code yields **270 kcal/P13.5/C21/F15**, with no clarification. Exact named nutrient excerpts from the Eat This Much serving table passed unchanged validation. Open Food Facts was the other retrieved page and showed matching serving-column values. These are secondary records, not an independently verified manufacturer/package label. No vegetable result occurred in this batch; its rejection was observed in earlier tests.

Usage: 9,317 prompt/403 output/3,298 thinking/13,018 total tokens; cached counters missing. Complete token cost remains unknown; all-input-uncached illustration at recorded rates is $0.0208665, not an invoice. Tavily reported 2 credits versus1.8 estimated/$0.0144 before free allowance. Eight credits have been reported across all probes/combined tests. One accepted text example does not establish broad accuracy, source independence, latency superiority, photo accuracy or hosted/device behavior. No additional production code change was made after this accepted run. The actual normalized response rendered in the existing compact review at Paper 390px with correct totals, six-piece amount, four-piece basis and two optional sources; Save was disabled and untouched. Temporary rendering transport replayed only that real response, with no more provider calls. Temporary files, tab and servers were cleaned up.

## What remains

Final verification of the matching/format guard changes passed: 68 files/750 tests, lint, build with existing warnings, and strict backend TypeScript; 44 focused model/Tavily cases also passed. Paper 390px and Ink 320px fixture review checks passed; changing six to nine fictional pieces scaled 360→540 kcal (P18/C72/F21), and September 4 at 7:30 PM received exactly one saved row while today remained unchanged. These are fixture checks, not real-food accuracy evidence.

The original direct-test allowances are consumed. Subsequent explicit authorization covers deployment, bounded hosted smoke, native compilation and scoped PR/merge. Deployment and negative-auth/CORS checks passed; the positive hosted path requires a legitimate signed-in app session, which was unavailable. No authentication bypass was introduced. The user will upload TestFlight and test through the normal app. Actual package/photo accuracy, real Storage transactions and broader reliability remain unverified. The operational guide records deployment evidence, merged verification and the TestFlight handoff.
