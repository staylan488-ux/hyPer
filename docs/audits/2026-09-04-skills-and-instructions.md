> Historical audit captured before cleanup. The [resolution record](2026-09-04-instruction-cleanup.md) describes the implemented changes. Links to changed instruction sources now point to preserved local baseline copies; sizes and findings below describe the pre-cleanup state.

**Skills and instruction audit — 4 September 2026**

Your personal global instructions are already small and useful. The biggest improvements are in hyPer's project instructions: remove obsolete design rules, stop routine branch manipulation, separate historical handoffs from current policy, and make verification proportional to the task. Several managed skills also contain conflicting or outdated workflow requirements, but those should be addressed through maintained updates rather than local cache edits.

This is an audit and proposed cleanup, not an applied configuration change. No existing instruction, skill, plugin, application source, or global setting was changed.

The audit follows Eric Provencher's [Rethinking skills and prompts for GPT-6 Astra](https://x.com/pvncher/status/2095991462416490862). I read the complete article in the browser after the direct web fetch returned 403. Its relevant advice is to use precise skill triggers, reveal detailed instructions only when needed, remove unnecessary universal procedures, keep documentation current, and define authorization and completion boundaries that allow useful work to continue.

Official documentation confirms that skill descriptions are advertised before full skill bodies are selected, and that large skill lists can cause description shortening. Finding many files on disk therefore does not establish that they are all consuming task context. [Skill loading documentation](https://learn.chatgpt.com/docs/build-skills)

**Coverage and what actually applies**

| Scope | Coverage | Finding |
|---|---|---|
| hyPer | Root AGENTS.md, CLAUDE.md, TOOL_SWITCHING_CHECKLIST.md, all three project SKILL.md files | Fully reviewed, with scoped checks against current source and shipping scripts |
| Personal globals | ~/.codex/AGENTS.md and ~/.claude/CLAUDE.md | Both fully reviewed; 7 lines each |
| Advertised Codex skills | All 16 skills available in this task | Fully reviewed; about 4,700 characters of source descriptions combined |
| Other system/cached skills | Hidden review-agent; four GitHub skills in two identical caches; two Telegram versions; 20 artifact-template skills | Bodies reviewed, including comparison of duplicate and template variants |
| Overall skill body coverage | 52 physical SKILL.md files, 48 distinct file contents | Includes the three project skills and all files under the inspected system and installed plugin-cache roots |
| Downloaded catalogs/imports | 624 temporary-catalog instruction files, 39 vendor-import skills, 31 Claude marketplace skills | Inventoried and distinguished from active configuration; not individually reviewed as running policies |

The full filesystem inventory contains 750 instruction/skill files and records paths, sizes and hashes: [inventory JSON](/private/tmp/hyper-instruction-audit-inventory.json). This count includes downloaded catalogs and is not an installed or active skill count. Five local instruction documents were reviewed: the four AGENTS/CLAUDE files and the project handoff checklist. The checklist and external article are not included in the 750-file filename inventory. A [reviewed-file index](/Users/sinan/orca/hyPer/docs/audits/2026-09-04-skills-and-instructions-inventory.csv) lists all 57 reviewed local files and their applicability.

No nested AGENTS.md or AGENTS.override.md was found in this project. No global override was found. The user-level ~/.agents/skills directory is empty; there are no additional personal skills alongside the managed system skills in ~/.codex/skills. No relevant files were found in the inspected ~/.config, ~/.cursor or ~/.gemini locations. /etc/codex was absent. Unrelated projects and archived Codex worktrees were outside this audit's scope.

Codex config enables the GitHub plugin, but its four cached skills are absent from this task's advertised skill catalog; its connector tools are available. Telegram is installed in Claude but globally disabled; the enabled Swift LSP plugin contributes no SKILL.md files. The 20 cached OpenAI templates are also absent from this task's advertised catalog. Cache presence alone should not trigger removal or a claim of duplicate prompt loading.

Codex normally discovers global guidance in ~/.codex and project guidance along the repository path. Its documented repository skill location is .agents/skills. The three hyPer skills currently live in .claude/skills and are reached indirectly through CLAUDE.md; they are not advertised as Codex skills in this task. [Instruction discovery](https://learn.chatgpt.com/docs/agent-configuration/agents-md), [skill locations](https://learn.chatgpt.com/docs/build-skills)

**Prioritized findings for files you maintain**

1. **High — The UI skill can undo the approved Studio design.**

   [folio-design:43](/Users/sinan/.codex/memories/instruction-backups/2026-09-04-originals/project/.claude/skills/folio-design/SKILL.md.txt:43) mandates zero-radius corners. Lines 20–31 specify Geist Mono for compact data, and lines 56–59 describe the old page entrances and moving atmosphere. [CLAUDE.md:36](/Users/sinan/.codex/memories/instruction-backups/2026-09-04-originals/project/CLAUDE.md.txt:36) reinforces that obsolete locked design. Current Studio code uses 11px controls, 20px sheets, 22px navigation and Geist for compact data in [src/index.css:41](/Users/sinan/orca/hyPer/src/index.css:41). [App.tsx:51](/Users/sinan/orca/hyPer/src/App.tsx:51) deliberately avoids route transforms, and [PaperAtmosphere.tsx:3](/Users/sinan/orca/hyPer/src/components/shared/PaperAtmosphere.tsx:3) uses static grain.

   **Proposed change:** Update the skill to the approved Studio contract. Preserve Paper/Ink, the red accent, intentional type roles, the text-base warning, reduced motion and mobile constraints. Link detailed decisions to the [Studio design contract](/Users/sinan/orca/hyPer/docs/plans/2026-09-04-studio-app-wide.md:6), without forcing agents to read the entire historical implementation plan for every UI edit.

2. **High — Routine startup/build guidance can move unrelated work or validate the wrong branch.**

   [CLAUDE.md:35](/Users/sinan/.codex/memories/instruction-backups/2026-09-04-originals/project/CLAUDE.md.txt:35) requires switching to main and pulling before a build. [TOOL_SWITCHING_CHECKLIST.md:10](/Users/sinan/.codex/memories/instruction-backups/2026-09-04-originals/project/TOOL_SWITCHING_CHECKLIST.md.txt:10) adds automatic rebasing and committing or stashing unrelated changes. The current checkout contains unfinished icon work, making this a concrete conflict with preserving the user's working state.

   **Proposed change:** Inspect branch/status at task start and validate the intended branch. Fetch and compare when relevant; isolate work when necessary. Remove automatic branch switching, rebasing and stashing from the handoff checklist. Release synchronization belongs in the release workflow, whose [ship script already uses an isolated clone](/Users/sinan/orca/hyPer/scripts/ship.sh:22).

3. **High — The backend skill incorrectly labels every migration idempotent.**

   [supabase-deploy:48](/Users/sinan/.codex/memories/instruction-backups/2026-09-04-originals/project/.claude/skills/supabase-deploy/SKILL.md.txt:48) makes that blanket claim. [The activity-segments migration:37](/Users/sinan/orca/hyPer/supabase/migrations/20260710090000_add_activity_segments.sql:37) creates policies unconditionally; replaying those statements can encounter existing policies. A special historical cutover script does not establish replay safety for other migrations.

   **Proposed change:** Require inspection of the exact migration and target state. Describe deployment and migration as separate workflows. Replace the hardcoded production command at line 37 with a target resolved from the user's request and existing authorization. A request to inspect or edit backend code does not by itself request a production deployment.

4. **Medium — AGENTS.md is mostly historical state, including obsolete instructions and past authorizations.**

   [AGENTS.md](/Users/sinan/.codex/memories/instruction-backups/2026-09-04-originals/project/AGENTS.md.txt) is 16,830 bytes. Everything from the first current-handoff heading onward occupies 14,798 bytes—about 88% of the file. The old Studio handoff still says ready for draft PR review at line 92, although current HEAD contains merged PR #105. July's handoff says merged at line 211 and still requests a merge at line 243. Superseded atmosphere rules remain at lines 248–249.

   **Proposed change:** Keep stable project rules and a short pointer to current work in AGENTS.md. Move previous handoffs into dated records marked historical; distinguish recorded prior authorization from permission for a new task. Preserve useful history, but load it only for a relevant handoff. The file is below the documented default instruction size limit; the issue is relevance and contradiction, not demonstrated truncation.

5. **Medium — Shared rules depend on ignored, machine-local files.**

   [AGENTS.md:10](/Users/sinan/.codex/memories/instruction-backups/2026-09-04-originals/project/AGENTS.md.txt:10) mandates CLAUDE.md at every startup, while [.gitignore:31](/Users/sinan/.codex/memories/instruction-backups/2026-09-04-originals/project/.gitignore.txt:31) excludes CLAUDE.md and all three .claude/skills. A past clean worktree already lacked CLAUDE.md, as recorded at [AGENTS.md:158](/Users/sinan/.codex/memories/instruction-backups/2026-09-04-originals/project/AGENTS.md.txt:158).

   **Proposed change:** Keep shared rules and the three project-specific skills in tracked canonical files, preferably .agents/skills for Codex discovery, with thin adapters or links for other tools. Keep personal account and machine details local. This should be a deliberate migration of the existing skills, not installation of more skills or duplication of two separately maintained copies. Preserve the existing unrelated .gitignore edit while doing it.

6. **Medium — Universal process gates create work unrelated to the request.**

   [AGENTS.md:15](/Users/sinan/.codex/memories/instruction-backups/2026-09-04-originals/project/AGENTS.md.txt:15) requires delegation and parallelization as a fixed sequence. Its verification requirements are duplicated in [CLAUDE.md:28](/Users/sinan/.codex/memories/instruction-backups/2026-09-04-originals/project/CLAUDE.md.txt:28) and the checklist. CLAUDE explicitly applies test/lint/build to any task, including this audit. The mandatory startup chain totals 406 lines and about 23 KB across AGENTS, CLAUDE and the checklist.

   **Proposed change:** Delegate only when independent work benefits. Require the full application checks for application code changes; use relevant native verification for native changes, content/link/render checks for documents and artifacts, and no application tests for a read-only audit. Keep the two-to-three visual-directions requirement for a major redesign whose direction has not already been approved.

7. **Medium — The iOS skill mixes distinct workflows and stale release details.**

   [ship-ios:25](/Users/sinan/.codex/memories/instruction-backups/2026-09-04-originals/project/.claude/skills/ship-ios/SKILL.md.txt:25) describes manual Xcode build-number changes, while [Fastfile:15](/Users/sinan/orca/hyPer/ios/App/fastlane/Fastfile:15) manages numbers in the isolated build clone. The generic icon generator at [ship-ios:58](/Users/sinan/.codex/memories/instruction-backups/2026-09-04-originals/project/.claude/skills/ship-ios/SKILL.md.txt:58) omits the current dedicated exporter documented in [assets/README.md:14](/Users/sinan/.codex/memories/instruction-backups/2026-09-04-originals/project/assets/README.md.txt:14).

   **Proposed change:** Make ship-ios a small router for simulator/device verification, authorized TestFlight shipping, native implementation gotchas and icon export. Point to the maintained scripts. Move account-sharing history and hypothetical company-formation discussion out of the main workflow. The account/legal claims were not independently audited.

8. **Medium — Backend and iOS skill triggers are broader than the workflows they contain.**

   Both descriptions trigger whenever work touches broad folders or integrations. That can load release procedures for an audit or a small edit. Their frontmatter is present and reasonably short; correctness and scope matter more here than shaving words.

   **Proposed descriptions:**

   - UI: “Apply hyPer's approved Studio design when changing its screens, components, typography, themes or motion.”
   - iOS: “Build or validate hyPer on iOS, prepare a requested TestFlight release, or regenerate its app icon.”
   - Backend: “Prepare or perform requested hyPer Supabase function deployments or migrations; resolve the target environment before writing.”

   If backend editing needs separate local conventions, route those from a small backend guide rather than broadening the deployment trigger again. No new skill is required by this audit.

9. **Low — Environment rules overstate a specific file and machine endpoint.**

   [ship-ios:19](/Users/sinan/.codex/memories/instruction-backups/2026-09-04-originals/project/.claude/skills/ship-ios/SKILL.md.txt:19), CLAUDE and [supabase-deploy:15](/Users/sinan/.codex/memories/instruction-backups/2026-09-04-originals/project/.claude/skills/supabase-deploy/SKILL.md.txt:15) repeat that .env must exist. The actual requirement is the relevant Supabase environment values for normal runtime, not necessarily a literal .env file. The worker can also be configured through saved Settings: [supabase.ts:7](/Users/sinan/orca/hyPer/src/lib/supabase.ts:7), [photoAnalysis.ts:41](/Users/sinan/orca/hyPer/src/lib/photoAnalysis.ts:41).

   **Proposed change:** Describe production, preview/test and optional worker configuration accurately. Keep private machine endpoints in local setup references. Preserve the existing prohibition on printing secrets.

**Global instructions and managed skills**

[Global Codex AGENTS.md](/Users/sinan/.codex/memories/instruction-backups/2026-09-04-originals/global/.codex/AGENTS.md.txt) is 510 bytes and already expresses your preferences clearly: maintained tools, task-appropriate interaction, reasonable reversible decisions and completion. Keep it. [Global Claude instructions](/Users/sinan/.codex/memories/instruction-backups/2026-09-04-originals/global/.claude/CLAUDE.md.txt) are 603 bytes and similarly useful. Their exception for GUI tasks could say to use available Computer Use before handing the task back, but this is a minor wording improvement, not a reason to expand either file.

The following are upstream or integration issues. Do not treat managed cache files as durable personal configuration, and do not disable useful skills merely because they are long.

| Managed file | Concrete issue | Recommended treatment |
|---|---|---|
| [openai-docs:12](/Users/sinan/.codex/skills/.system/openai-docs/SKILL.md:12) | Requires an official search before local inspection, while this task's higher-priority web instructions require local inspection first for OpenAI product questions | Reconcile upstream ordering; obey the current higher-priority host instructions |
| [skill-installer:34](/Users/sinan/.codex/skills/.system/skill-installer/SKILL.md:34) | Requires sandbox escalation merely because scripts use networking | Use default permissions when sufficient; escalate only for an actual restriction |
| [imagegen:76](/Users/sinan/.codex/skills/.system/imagegen/SKILL.md:76) | Local-image guidance does not reflect the current built-in referenced_image_paths argument | Align with the advertised tool schema; retain inspecting the image before editing |
| [visualize:22](/Users/sinan/.codex/plugins/cache/openai-bundled/visualize/1.0.29/skills/visualize/SKILL.md:22) | Prohibits progress updates and skill announcements, conflicting with this host's explicit communication rules | Keep concise visual delivery guidance, remove conflicting universal silence rules |
| [sites-building:222](/Users/sinan/.codex/plugins/cache/openai-bundled/sites/0.1.57/skills/sites-building/SKILL.md:222) | Prohibits browser QA unless explicitly requested, conflicting with your preference to choose visual verification when useful | Permit proportionate visual verification within authorized work |
| [plugin-management:32](/Users/sinan/.codex/plugins/cache/openai-curated-remote/plugin-management/0.1.0/skills/plugin-management/SKILL.md:32) | Requires search_plugins and suggest_plugins, neither available in this task's tools | Make discovery capability-aware; respect your explicit-request-only preference and current installation-tool restrictions |
| [gh-fix-ci:15](/Users/sinan/.codex/plugins/cache/openai-curated/github/bd2122cb/skills/gh-fix-ci/SKILL.md:15) | Requires explicit plan approval even when the user has already requested the scoped fix | Preserve diagnosis-only scope, but continue already-authorized fixes through verification |
| [gh-address-comments:10](/Users/sinan/.codex/plugins/cache/openai-curated/github/bd2122cb/skills/gh-address-comments/SKILL.md:10) | Requires elevated networking for all gh calls; line 40 treats rate limits like authentication failures | Escalate only when needed; distinguish auth recovery from rate-limit backoff |
| [yeet:20](/Users/sinan/.codex/plugins/cache/openai-curated/github/bd2122cb/skills/yeet/SKILL.md:20) | Requires gh although earlier text calls it a fallback; mixed-tree questions ignore already-established file ownership | Check fallback prerequisites only when needed; ask about scope only when unresolved |

GitHub findings are conditional on those cached skill instructions being loaded. Telegram's disabled configure skill similarly contains broad setup triggers and a repetitive access-policy dialogue. Its access-control restrictions protect real security boundaries and should remain. The old Telegram version lacks the newer state-directory resolution; leave the disabled cache alone rather than maintaining it yourself.

There are also two substantive artifact-writing issues worth reporting upstream. [Documents:491](/Users/sinan/.codex/plugins/cache/openai-primary-runtime/documents/26.904.11930/skills/documents/SKILL.md:491) keeps missing-information notes only in chat; limitations that affect interpretation should remain in the delivered document. [Presentations:134](/Users/sinan/.codex/plugins/cache/openai-primary-runtime/presentations/26.904.11930/skills/presentations/SKILL.md:134) demonstrates rewriting a passive sentence by adding an actor that the source did not establish. Prefer active wording when supported, without inventing responsibility.

The managed entry files below total 282,375 bytes across 3,625 lines. These are conditional read costs, not material loaded on every request. All actual Markdown-linked relative references checked by the audit resolved; examples in skill-creator were not mistaken for required files. Artifact helper scripts are present. No missing-helper finding is warranted.

| Managed skill | Entry lines / bytes | Disposition |
|---|---:|---|
| imagegen | 315 / 19,201 | Keep; refresh edit mechanics; move CLI-only detail to its references |
| openai-docs | 38 / 5,446 | Keep; resolve source-order conflict |
| plugin-creator | 249 / 11,467 | Keep; move marketplace schemas/examples to references |
| review-agent, unadvertised | 57 / 2,661 | Keep; focused scope |
| skill-creator | 229 / 15,311 | Keep; useful scope and progressive-disclosure guidance |
| skill-installer | 58 / 3,367 | Keep; remove unconditional network escalation |
| sites-building | 233 / 30,871 | Keep; reconcile QA and visual-direction rules with user instructions |
| sites-hosting | 51 / 6,670 | Keep; honor sufficiently specific prior deployment authorization |
| visualize | 514 / 30,923 | Keep; reconcile silence rule; move chart/map modes to references |
| deep-research | 183 / 12,344 | Keep; good explicit trigger; check planning-tool availability before calling |
| plugin-management | 58 / 2,983 | Keep; use capability-aware discovery |
| documents | 540 / 41,888 | Keep; consolidate repeated QA gates and move equation/helper detail to references |
| pdf | 150 / 7,119 | Keep; make AcroForm instructions conditional |
| presentations | 232 / 29,268 | Keep; reduce universal writing bans and long example inventories |
| spreadsheets | 218 / 16,217 | Keep; route read-only questions before mandatory styling/API reads |
| excel-live-control | 294 / 27,603 | Keep; useful separation from file tasks; simplify repeated setup guidance |
| template-creator | 206 / 19,036 | Keep; good cache-ownership boundary; make Google export details conditional |

The 20 cached template skills are 22 lines each and share three workflow variants: documents, presentations and spreadsheets. Their explicit named-template triggers, preservation rules and links to the artifact capabilities are sensible. Their descriptions could be shorter, but they are not currently advertised and are not an urgent cleanup target.

**Suggested durable cleanup**

Keep the two global preference files small. Reduce project AGENTS.md to stable constraints, task-appropriate validation, a compact current-state pointer and contextual routes to the three maintained project skills. Make CLAUDE.md an optional adapter to the shared rules. Retire the duplicated handoff checklist procedure after moving any useful recovery notes into a reference. Archive historical handoffs with clear dates and status. Update the three existing skills in one canonical tracked location, then verify discovery in a fresh task and a clean worktree.

Preserve the substantive protections: no unrequested auth/schema changes, no secrets exposed or committed, no unrelated files staged or discarded, the six must-work product flows, existing design approval, and verification appropriate to the requested change. Retain genuine permission boundaries for external or destructive actions; remove repeated approval requests only when authorization already exists.

A compact authorization sentence could be: “Carry already-authorized work through implementation and relevant verification. Ask only when missing information or an unresolved consequential action blocks completion; do not ask again for permission already given.” This largely restates your existing global preference and need not be copied into every skill.

**Verification and limits**

- Repository checks were run once because the current project contract requires them even for this audit: npm run test passed, 62 files / 668 tests; npm run lint passed; npm run build passed with existing chunk-size and stale Browserslist-data warnings.
- These checks establish the current checkout's baseline, not that proposed instruction changes improve model behavior. No proposed instruction change was applied.
- Evidence was checked against current files, not only handoff summaries. The branch stayed feat/refined-app-icon at 1fe8e4b; existing icon work and unrelated modifications were preserved.
- No deployment, merge, push, plugin installation, credential inspection, auth change or database schema change was performed.
- This audit reviews skill instructions and selected supporting references, not every bundled script, external service, or dormant marketplace skill. Catalog files are explicitly inventory-only.
