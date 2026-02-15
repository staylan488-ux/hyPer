# Evidence Pipeline

## Purpose
This app now supports evidence-driven template generation while preserving stable UX and existing data flows.

## Current implementation
- Evidence snapshot source: `src/lib/evidence/snapshot.ts`
- Compiler: `src/lib/evidence/compiler.ts`
- Runtime template feed: `src/lib/splitTemplates.ts`

`splitTemplates` now includes:
1. evidence-backed templates generated from snapshot blueprints
2. legacy templates as fallback

## Trust presentation strategy
To avoid a "single-author" trust issue in the end-user UI:
- templates show a neutral public label (`Evidence-informed`)
- templates show a blended public note (research digest + coaching synthesis)
- full source URLs remain internal in the evidence layer for audits and future multi-source expansion
- personalized/specialization variants must be clearly labeled and must never replace the default baseline template

## Refresh workflow (manual for now)
1. Run importer: `npm run evidence:import`
2. (Optional) Dry run to inspect output only: `node scripts/import-evidence.mjs --dry-run`
3. Keep confidence labels conservative (`solid`, `emerging`, `speculative`).
4. Run verification:
   - `npm run test`
   - `npm run lint`
   - `npm run build`

## Next extension
- Add CI automation to run `npm run evidence:import` on demand and open a reviewable PR with snapshot diffs.
