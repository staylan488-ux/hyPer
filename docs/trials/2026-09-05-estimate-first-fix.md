# Estimate-first food analysis correction — 2026-09-05

Correction on `codex/food-estimate-first`, based on the tested tree merged as PR #107. Backend deployment and a new TestFlight build remain pending; PR/merge status is recorded in GitHub. The earlier deployed version still has the reported behavior until the backend is updated.

## Report and cause

The user reported a compound question about Chick-fil-A sauce amount plus a label photo, followed by a demand for an exact package nutrition label. Answering that demand produced the same question again and no food output. Screenshots corroborate the first two questions; the repeated follow-up is the user's report.

The pipeline permitted questions from the planner, source selector and finalizer. It also hardcoded package-label requests when research was empty or a branded item's exact label could not be substantiated. Every follow-up started the same policy again. The UI required an answer or another photo and had no one-question state. These were implementation requirements causing friction, not a critical need for user input.

## Corrected behavior

- Research and estimate by default, including branded foods and ordinary sauces with missing amounts. Prefer exact sources; use a plausible serving and show the assumption where exact information is unavailable. Never request a package label, photo of a label or exact macros as a condition of producing an estimate.
- Only the planner can request clarification, solely when the main food cannot be identified at all. It emits a boolean; application code renders one fixed question, “What was the main food in this meal?” Freeform compound model questions cannot reach the user.
- A single answer or Use an estimate consumes the clarification. The final output schema requires `clarification: null`. New clients send `clarificationUsed`; the gateway also recognizes the older client's `Answer:` context, so the backend correction suppresses repeats on already installed clients.
- Empty or failed research proceeds to the existing finalizer with available evidence and food knowledge. It does not retry paid calls. Exact-label claims still require supporting evidence; mismatches become estimates and lose the false label citation. A wrong variant cannot retain its identity merely because label validation already downgraded it. Missing researched foods and malformed final responses fail explicitly rather than silently omitting part of the meal or creating another question.
- The UI offers one optional answer or Use an estimate, removes label-request controls from clarification, and hides the consumed question during finalization or failure. Change meal restores the original description. Defensive transport validation rejects a second clarification from an older server.
- The content namespace changes to `gemini-tavily-v2`, so a stored v1 label question cannot replay as a corrected analysis. Daily quota objects are unchanged; old attempts remain counted. Answering/skipping is an explicit new analysis attempt, with identical-input retry still replayed.

Auth, DB schema, nutrition-save behavior, exact Gemini model, provider choice and paid-call limits are unchanged. Estimates remain labeled estimates; fewer questions do not establish exact package accuracy.

## Verification

- `npm run test`: PASS — 69 files, 779 tests, with nonsecret local Supabase placeholders.
- `npm run lint`: PASS.
- `npm run build`: PASS; existing chunk-size, Browserslist and Node warnings.
- Strict standalone backend TypeScript: PASS.
- Focused model/gateway regressions: 70 tests pass, including both reported question patterns, legacy answers, missing/failed research, identity integrity, incomplete meal rejection and old-cache invalidation. Client/review tests verify consumed-question transport and preservation of the original meal.
- Safari with temporary fixtures and the production component: Paper 390px answer→review, skip→review, Change meal reset; Ink 320px stale second question→single error with original question hidden and same-input retry. These were component widths, not physical native viewports. Fixtures, local server and tab were cleaned up.

Automated provider responses and browser review data are fixtures, not measured live-model performance. No paid provider test, hosted deployment, diary write, native installation or TestFlight upload was performed for this correction.
