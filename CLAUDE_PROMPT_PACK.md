# Claude Code Prompt Pack

## A) Explore-only (no code changes)
```text
Discovery only. Do not implement yet.
Read relevant files and return:
1) current behavior,
2) likely root causes/risks,
3) recommended implementation plan.
```

## B) Plan then implement safely
```text
Use Plan Mode first. Do not code until plan is approved.

Goal:
<goal>

Constraints:
- Keep behavior stable
- Smallest viable change
- Mobile-first UI
- No auth/DB schema changes unless explicitly required

After approval, implement and run:
- npm run test
- npm run lint
- npm run build

Return:
plain-English summary first, then technical details.
```

## C) Design polish (Opus-first)
```text
This is a frontend taste/polish task.

First propose 3 visual directions before coding.
For each direction include:
- style concept
- type/color/spacing notes
- mobile behavior

After I choose one, implement it, verify desktop+mobile, and summarize what improved.
```

## D) Bug fix with proof
```text
Fix this bug: <bug description>

Rules:
- reproduce first
- explain root cause
- implement minimal fix
- verify with test/lint/build
- list any edge cases still not covered
```

## E) Safe release-ready closeout
```text
Before finalizing, provide:
1) what changed
2) what was intentionally not changed
3) verification output summary (test/lint/build)
4) top remaining risk
5) recommended next 1-2 tasks
```
