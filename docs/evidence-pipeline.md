# Evidence pipeline

The program templates hyPer suggests are compiled from a snapshot of training
research, so the rules behind them can be audited and refreshed.

## Where it lives

- Snapshot: [src/lib/evidence/snapshot.ts](../src/lib/evidence/snapshot.ts),
  generated, with the research rules, exercise profiles and template
  blueprints. Its header records the source repository, commit and import
  time.
- Compiler: [src/lib/evidence/compiler.ts](../src/lib/evidence/compiler.ts)
  turns the blueprints into templates.
- [src/lib/splitTemplates.ts](../src/lib/splitTemplates.ts) exposes the
  compiled templates. The app's program editor (`native/src/app/program-edit`)
  asks its questions through `programQuestions`, and `programDesigner`
  recommends a template from the answers and builds the program.

## How templates present their evidence

- Templates carry a neutral public label (`Evidence-informed`) and a blended
  note (research digest plus coaching synthesis), never a single author.
- Source URLs stay in the snapshot for audits; the app does not show them.
- Personalized or specialization variants must be clearly labeled and never
  replace the default template.

## Refreshing the snapshot

The importer reads the reference notes in the
`staylan488-ux/hypertrophy-coach` repository (`references/` on `main`) and
rewrites the snapshot. It sends `GITHUB_TOKEN` when one is set.

```sh
npm run evidence:import                          # rewrite the snapshot
node scripts/import-evidence.mjs --dry-run       # print it without writing
```

`--owner`, `--repo`, `--ref`, `--path` and `--out` override the defaults.
Keep confidence labels conservative (`solid`, `emerging`, `speculative`),
review the snapshot diff, then run `npm run test`, `npm run lint` and
`npm run build`. A changed snapshot reaches people only in a new app build.
