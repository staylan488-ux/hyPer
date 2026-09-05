# Maintaining agent instructions

AGENTS.md is the shared project policy. CLAUDE.md imports it with @AGENTS.md;
Codex discovers it directly. Only this small policy belongs in the startup
context. Procedures are loaded for the task that needs them.

## One source for each skill

Canonical sources live in .agents/skills. Each .claude/skills entry is a relative
symlink to the matching canonical directory, so both tools read the same content.
Do not maintain a second copy. The former folio-design skill is now studio-design
because Studio is the approved design; old design documents remain historical.

The directory layout follows [Codex skill discovery](https://learn.chatgpt.com/docs/build-skills)
and Claude's supported [skill-directory symlinks](https://code.claude.com/docs/en/skills).
Claude's root adapter uses its documented [memory import syntax](https://code.claude.com/docs/en/memory).

For a skill change, edit the canonical source. Keep its description precise and
short; put workflow-specific detail in references only when it earns that extra
file. Link source files using relative Markdown paths. Prefer current scripts,
configuration and code over copied versions, account claims or machine endpoints.
When a behavior changes, update the relevant guidance in the same change.

When a new project skill is justified, add its canonical directory and matching
relative Claude symlink, then allow that alias in .gitignore. Other local Claude
skills remain ignored. Do not add a skill merely for a one-off observation.
Private machine notes belong in ignored CLAUDE.local.md; shared rules must work
without that file, a production .env or files in someone's home directory.

## Verification

Run npm run check:instructions after changing guidance or its links. npm run lint
also runs that check. It discovers project skills and checks their metadata,
relative references, Claude imports/aliases and Git ignore visibility. Warnings
about size prompt a review of relevance; file length alone does not prove a
problem. The validator does not prove the instructions produce good decisions.

For a substantial workflow change, exercise representative requests with an
independent agent or isolated fixture. Check the resulting action choices, not
whether the prose matches a preferred phrase. Deployment tests should prepare
local artifacts and inspect commands unless an actual deployment is requested.
Useful cases include a UI edit with an already-approved direction, backend
inspection without a deployment request, and a release whose target is already
authorized.

For changes to discovery or imports, verify a clean checkout/snapshot without
private files. Check Codex's skill list and resolve Claude's documented imports
and aliases. New tasks pick up the new policy; an already-running task can retain
earlier instructions in its conversation. Do not claim a live host reload unless
it was observed.

## Historical state and managed skills

Use [the current handoff](handoffs/current.md) only when resuming unfinished work.
Archive superseded records with a date and a historical label. Do not continually
append task history to AGENTS.md or copy past deployment/merge authorization into
new policy. The [handoff template](../TOOL_SWITCHING_CHECKLIST.md) lists the useful
fields without prescribing branch mutation.

Global personal preferences govern tool choice, relevant verification and
already-established authorization. Managed skills remain vendor-owned. Current
host instructions and tool schemas win over obsolete examples; use an available
equivalent when appropriate rather than treating an unused fallback as required.
Keep substantive artifact caveats and factual meaning even when a style recipe
suggests otherwise. Preserve actual security and permission boundaries.

Local overrides can mitigate behavioral conflicts, but cannot shorten a vendor
entry file or repair its source. Track remaining upstream issues in the audit
[resolution record](audits/2026-09-04-instruction-cleanup.md) and reassess when the app updates those skills. Avoid personal
shadow copies, automatic cache patchers and uninstalling useful tools to hide a
documentation problem.
