# Maintaining agent instructions

AGENTS.md is the shared project policy. CLAUDE.md imports it with @AGENTS.md;
Codex discovers it directly. Keep it to facts about this project that an agent
cannot read from the code: what the app is, what must not be touched without
asking, which checks to run. Leave out advice on how to work in general; each
new model handles that better than a rule written for an older one.

Before adding a rule or a skill, ask whether a current model would get it wrong
without it. When a rule's reason is gone, delete the rule.

A skill holds the owner's decisions, traps that cost time before and check
procedures. It does not describe how features work: the code and tests do
that, and prose copies of them go stale. Do not update a skill just because
code changed, and do not create a skill unless the owner asks for one.

## Skills

Sources live in .agents/skills. Each .claude/skills entry is a relative symlink
to the matching directory, so both tools read the same content. Edit the
source; do not keep a second copy. A new project skill needs its directory, the
matching symlink, and its alias allowed in .gitignore.

Private machine notes belong in the ignored CLAUDE.local.md. Shared rules must
work without that file, a production .env or files in someone's home directory.

## Checks

Run npm run check:instructions after changing guidance or its links (npm run
lint runs it too). It checks skill metadata, relative links, Claude's import
and symlinks, and Git ignore visibility. It does not show that the instructions
lead to good decisions.

## Handoffs

Use [the current handoff](handoffs/current.md) only when resuming unfinished
work; the [handoff template](handoffs/README.md) lists the useful fields.
Remove superseded sections instead of archiving them; Git history keeps them.
Do not add task history to AGENTS.md.
