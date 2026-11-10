# hyPer

hyPer is an iPhone app for workout and nutrition tracking, written hyPer
exactly. The app is React Native + Expo in native/, released as hyPer 2.0
(bundle ID app.hyper.mobile). It reuses the stores, Supabase data access and
training and nutrition rules in src; Supabase is the backend. See package.json
and native/package.json for current dependency versions and commands.

The React web app and its Capacitor iOS shell are retired and removed. src
holds only code the app shares (lib, stores, hooks, types and preview sample
data); screens and other UI belong in native/.

## Working rules

- Other agents may be working in this repository at the same time. Stay on the
  checkout you were given; do not switch branches, rebase, stash or discard
  work that is not yours.
- Do not change auth flows or the database schema unless asked. Never commit
  .env files.
- Local edits do not imply a release, a production write or a merge.
- For a major redesign without an approved direction, propose 2–3 directions
  before building. Work inside an approved direction needs no new approval.

## Guides

Read only the guide relevant to the task. Skill sources live in .agents/skills;
Claude's skill entries link to the same files.

| Task | Guide |
|---|---|
| App screens, design or checks (native/) | [Blanc native app](.agents/skills/blanc-native/SKILL.md) |
| Device builds, native modules, requested release, app icon | [iOS workflow](.agents/skills/ship-ios/SKILL.md) |
| Requested Supabase deployment or migration | [Backend workflow](.agents/skills/supabase-deploy/SKILL.md) |
| Resuming unfinished work | [Current handoff](docs/handoffs/current.md) |
| Maintaining instructions or cross-tool setup | [Instruction maintenance](docs/agent-workflows.md) |

## Verification

- Application code (src or native/) or dependency changes: npm run test,
  npm run lint and npm run build.
- Changes to native/, or to shared code the app imports: also
  `cd native && npx tsc --noEmit` and the relevant simulator or device checks
  in blanc-native and ship-ios. A type-check alone does not validate native
  behavior.
- Instruction or skill changes: npm run check:instructions.
- Report what was not exercised on a device or in production.

Protect these product flows when relevant: food logging with time; workout
start/log/complete and set persistence; editing past workouts and nutrition;
volume recommendations/status; active program view/edit/delete; session restore
and sign-in persistence.
