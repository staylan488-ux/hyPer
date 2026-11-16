# Research notes snapshot

[src/lib/evidence/snapshot.ts](../src/lib/evidence/snapshot.ts) is a generated
copy of the training rules in the owner's notes repository
(`staylan488-ux/hypertrophy-coach`, `references/`), each with its confidence
and source links. Its header records the commit and the import time.

It is a record to read and cite. No app code runs on it:

- The built-in programs are written by hand in
  [src/lib/programBlueprints.ts](../src/lib/programBlueprints.ts) and sized by
  [src/lib/programDesigner.ts](../src/lib/programDesigner.ts). What they rest
  on is in [program-design.md](program-design.md).
- [training-volume.md](training-volume.md) cites three of the snapshot's rules
  by id.

The notes are one author's reading (Chris Beardsley's articles). Check a rule
against pooled research before building on it. Two that do not hold up as
stated: a fixed 4 to 5 day gap between sessions for a muscle, and a hard cap
on sets per session.

Until 2026-11-13 the importer also generated seven program templates and a
set of exercise profiles, and a compiler turned them into the builder's
templates. The templates were typed into the importer, not read from the
notes, and the profiles mis-filed movements (a pushdown under biceps). Both
are removed.

## Refreshing the snapshot

```sh
npm run evidence:import                                   # from GitHub; sends GITHUB_TOKEN when set
node scripts/import-evidence.mjs --from ../hypertrophy-coach   # from a local checkout
node scripts/import-evidence.mjs --dry-run                # print it without writing
```

`--owner`, `--repo`, `--ref`, `--path` and `--out` override the defaults. Do
not edit the snapshot by hand. Review its diff, then run `npm run test`,
`npm run lint` and `npm run build`.
