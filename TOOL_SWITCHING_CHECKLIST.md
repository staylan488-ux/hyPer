# Cross-tool handoff

Project policy lives in [AGENTS.md](AGENTS.md). Read this file when handing work
between tools, not on every task.

Confirm the intended checkout and inspect branch/status. Read recent commits and
the relevant handoff if context is missing. Preserve unrelated work in place;
handoff does not require synchronizing, rebasing, stashing or committing it.

Record enough evidence for the next agent to continue:

```text
SESSION HANDOFF
- Recorded at:
- Checkout and branch:
- Base/current commit; PR if relevant:
- Requested scope and decisions:
- Changes made and files owned by this task:
- Verification and material limits:
- Remaining work:
- Unrelated changes to preserve:
- Next useful action:
```

For ongoing work, update [the current handoff](docs/handoffs/current.md). Move
superseded records into dated files in docs/handoffs/archive. Label them historical;
past commands and permissions are evidence, not instructions for a new task.
