# Tool Switching Checklist (OpenCode <-> Claude Code)

Use this whenever you switch agents so context quality stays high and work does not drift.

## A) OpenCode -> Claude Code

1. Confirm branch and state:
   - `git branch --show-current`
   - `git status --short`
2. Sync branches before major work:
   - `git checkout main && git pull`
   - `git checkout <working-branch> && git rebase main`
3. Keep handoff clean:
   - Commit or stash unrelated files (`git stash push -u -m "temp handoff"`).
4. Give Claude a startup packet (copy/paste):

```text
Continue work on this repo from current branch.

First actions:
1) Read CLAUDE.md
2) Follow plan -> implement -> verify
3) Preserve behavior for must-work flows
4) For major UI work, propose 2-3 visual directions before coding

At end of each work block, report:
- files changed
- test/lint/build results
- what is done
- what remains
```

## B) Claude Code -> OpenCode

Ask Claude to output this exact handoff:

```text
HANDOFF BACK TO OPENCODE
- Branch:
- Last commit hash + message:
- PR URL (if any):
- What changed:
- Files touched:
- Verification:
  - npm run test:
  - npm run lint:
  - npm run build:
- Remaining tasks:
- Risks / gotchas:
- Next recommended command:
```

Then paste that handoff to OpenCode with:

```text
Continue from this handoff. First verify git status/log, then proceed with the next task.
```

## C) Always-Use Safety Checks

- Before commit/push:
  - `git branch --show-current`
  - `git status`
- Keep bugfix branches separate from refactor branches.
- Never commit `.env`.
- Run before finalizing work:
  - `npm run test`
  - `npm run lint`
  - `npm run build`

## D) Fast Recovery Commands

- Unstage file: `git restore --staged <file>`
- Discard unstaged file edits: `git restore <file>`
- Abort rebase: `git rebase --abort`
- See recent commits: `git log --oneline -10`
