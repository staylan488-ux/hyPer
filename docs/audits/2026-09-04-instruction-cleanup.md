# Instruction cleanup — 4 September 2026

Implemented the durable local fixes from the [audit](2026-09-04-skills-and-instructions.md).
Shared project rules and skills now have one canonical source, current operational
guidance, and automated integrity checks. Managed skill sources remain vendor-owned;
the global preferences resolve the identified workflow conflicts where user policy
can do so. Remaining vendor source issues are recorded explicitly below.

## Project changes

| Finding | Implemented resolution |
|---|---|
| Old FOLIO rules contradict Studio | Replaced folio-design with studio-design, verified against current CSS, route shell, sheets and workout behavior |
| Startup/build changes the branch or stashes unrelated work | Removed those operations from policy and handoff guidance; validation stays on the intended checkout |
| All migrations claimed to be idempotent; sample command targets production | Separate function/migration references require a verified authorized target and inspection of migration state |
| AGENTS mixes policy with old task history | Reduced AGENTS from 261 to 57 lines; moved the original text into a clearly historical archive and kept a conditional current-state pointer |
| Required shared instructions are gitignored | Added a small shareable CLAUDE adapter, canonical .agents/skills, relative Claude skill aliases and precise Git ignore exceptions |
| Every task requires full testing/delegation | Verification now follows the change; read-only work skips application tests; delegation is conditional on useful independent work |
| Manual shipping notes conflict with current automation | iOS skill routes to native validation or release; documents the isolated ship clone, build-number behavior and exact-revision limitation |
| Broad skill triggers and unconditional reference loading | Three short descriptions and task-specific routes; 89 total entry lines instead of 186 |
| Literal .env and private worker host treated as universally required | Describes runtime variable requirements, dev preview and optional saved worker Settings accurately |
| Missing device/icon prerequisites invite a broad fallback | Conditional icon instructions handle an older checkout without its unmerged exporter; preserve splash assets |

The maximum project startup chain fell from about 22.9 KB to 3.4 KB for Claude's
adapter plus AGENTS; Codex reads AGENTS directly. The handoff and detailed references
are conditional. These size reductions are useful because the removed material was
obsolete or task-specific, not because every instruction file needs a rigid limit.

The original .gitignore entries were retained with exceptions for the shared
adapter and three aliases. Other private Claude skills and CLAUDE.local.md remain
ignored. The canonical files are now eligible for version control; this task leaves
the project changes uncommitted in the existing checkout, separate from any release.

## Global changes and managed skills

Updated ~/.codex/AGENTS.md with durable personal preferences covering existing
authorization, relevant workflow selection, current tool schemas, available fallback
capabilities, proportional verification and material artifact qualifications.
~/.claude/CLAUDE.md imports that shared preference file and retains the concise
Claude-specific communication guidance. GUI work is handed back only for a real
credential, decision or capability requirement.

| Managed finding | Local treatment | Source status |
|---|---|---|
| openai-docs source-order conflicts | Current host instructions govern tool/source order | Vendor text unchanged |
| visualize silence/announcement rules | Host communication rules govern; skill defaults do not override them | Vendor text unchanged |
| imagegen older file-edit examples | Available built-in tool schema governs edit inputs | Vendor text unchanged |
| installer/GitHub unconditional network escalation | Use available default access; escalate only for an actual restriction | Vendor text unchanged |
| unavailable plugin-discovery or planning calls | Check available capabilities; an unused fallback is not a prerequisite | Vendor text unchanged |
| CI, mixed-worktree or hosting reapproval loops | Honor established scope and specific prior authorization; preserve actual host security gates | Vendor text unchanged |
| Sites suppresses useful QA/design exploration | Project/user direction and relevant verification govern | Vendor text unchanged |
| document caveats removed; rewrite examples invent actors | Preserve factual meaning and substantive limitations in the artifact | Vendor text unchanged |
| Long managed root files, repeated QA and conditional detail | Select only relevant workflows/references; avoid duplicate personal copies | Root-file size still requires an upstream revision |
| Disabled Telegram and dormant template/cache variants | Retained without activating, reinstalling or weakening their safeguards | No active problem established |

The local policy mitigates workflow conflicts; it does not rewrite vendor-owned
documents or eliminate their conditional context cost. The original audit identifies
the precise files and lines for future upstream fixes. No issue was posted or message
sent on the user's behalf. No plugins were added, removed or enabled, and no app
security settings were weakened.

## Verification

- The maintained Skill Creator validator passed for all three canonical skills.
  Its missing PyYAML dependency was installed only in a temporary validation folder;
  no application or global Python dependency was added.
- npm run check:instructions passes with three skills, eleven active Markdown
  files and no warnings. The same command is part of npm run lint.
- The checker validates metadata, local references, Claude imports, relative
  aliases and Git ignore visibility. It accepts documented inline imports and
  ignored private skills while rejecting shared copies and broken aliases.
- Eleven isolated development fixtures exercised valid and invalid layouts.
  Persistent regression coverage is included in tests/agentInstructions.test.ts.
- An isolated HEAD snapshot with only instruction/tooling overlays passes without
  a production .env, local Claude files or the unmerged icon exporter.
- A fresh local Codex app-server returned exactly ship-ios, studio-design and
  supabase-deploy as enabled repository skills in both the working checkout and
  the clean snapshot, with zero discovery errors. No model task was launched for
  this discovery check. Claude imports/aliases were resolved using its documented
  layout; no live Claude model session was used.
- An independent read-only behavioral evaluation covered an approved UI edit,
  backend audit, staging migration, exact-commit release, absent icon exporter and
  a standalone report with missing evidence. Its release-tip ambiguity was fixed
  and independently rechecked. These were action-selection evaluations, not live
  deployments or UI implementation tests.
- Final application checks passed: 63 test files / 679 tests, including eleven
  persistent instruction-validator regressions; lint passed with the integrated
  instruction check. Build passed with the existing chunk-size and stale
  Browserslist-data warnings. The later regression-test/document additions do not
  change application build inputs.
- Hashes confirm the existing icon assets/exporter and Supabase temporary metadata
  were preserved. The original instruction sources and global preferences were
  backed up locally before replacement; historical audit citations point to those
  preserved baseline copies.

## Maintenance boundaries

Run npm run check:instructions after guidance changes. For substantial behavioral
changes, verify representative action choices; a structural check cannot detect
every semantic contradiction. Keep task history out of the always-on policy and
update guidance alongside changes to its underlying code or scripts.

Fresh tasks can load the new setup. Existing conversations can retain earlier
instruction text; this work does not claim to erase their context. Sharing these
project changes with other checkouts still requires committing them through the
normal repository workflow. No commit, merge, deployment or TestFlight upload was
performed as part of this cleanup.

Local backups are under ~/.codex/memories/instruction-backups; temporary fixture,
discovery and validation evidence is under /private/tmp/hyper-instruction-cleanup.
