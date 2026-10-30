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

- Before changing files, inspect the current branch and working-tree status once.
  Read recent commits or handoffs when needed to understand the requested work.
  Validate the intended checkout; do not switch branches, rebase, stash or discard
  unrelated work as a startup or build step.
- Keep changes scoped and preserve existing behavior. Do not change auth flows
  or database schema unless requested. Never expose secrets or commit .env files.
- Carry authorized work through relevant verification. Resolve routine reversible
  decisions; ask only when missing information or unresolved consequential scope
  blocks progress. Local edits do not imply a release, production write or merge.
- Use independent agents when a bounded task benefits from parallel work.
- For a major redesign without an approved direction, propose 2–3 directions
  before implementation. Define typography, color, spacing and motion decisions;
  reuse an existing approval for work within that direction.

## Contextual guidance

Read only the guide relevant to the task. Shared skill sources live in
.agents/skills; Claude's skill entries link to the same files.

| Task | Guide |
|---|---|
| App screens, design or checks (native/) | [Blanc native app](.agents/skills/blanc-native/SKILL.md) |
| Device builds, native modules, requested release, app icon | [iOS workflow](.agents/skills/ship-ios/SKILL.md) |
| Requested Supabase deployment or migration | [Backend workflow](.agents/skills/supabase-deploy/SKILL.md) |
| Resuming unfinished work | [Current handoff](docs/handoffs/current.md) |
| Maintaining instructions or cross-tool setup | [Instruction maintenance](docs/agent-workflows.md) |

## Verification

- Application code (src or native/) or dependency changes: run npm run test,
  npm run lint and npm run build. Add focused behavioral coverage when the
  change warrants it.
- Changes to native/, or to shared code the app imports: also run
  `cd native && npx tsc --noEmit` and the relevant simulator or device checks in
  blanc-native and ship-ios. A type-check alone does not validate native behavior.
- Instruction/skill changes: run npm run check:instructions and validate the
  affected workflows. Other docs/artifacts need relevant content, link or render
  checks; read-only work does not need application tests.
- Fix failures caused by the change and rerun affected checks. After checks pass,
  repeat or broaden them only for new changes or unresolved concerns. Report
  material limitations, including device or production behavior not exercised.

Protect these product flows when relevant: food logging with time; workout
start/log/complete and set persistence; editing past workouts and nutrition;
volume recommendations/status; active program view/edit/delete; session restore
and sign-in persistence.

Keep stable rules here, task-specific procedures in the skills, and dated state
in handoffs. Historical documents record past decisions; they do not grant new
authorization. Update a rule when its source of truth changes instead of appending
another conflicting instruction.
