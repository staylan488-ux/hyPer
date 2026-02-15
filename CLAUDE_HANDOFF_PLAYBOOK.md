# Claude Code Handoff Playbook (Vibecoder Edition)

## 1) Your default operating mode
- Use Claude Code in VS Code extension for easiest review.
- Keep default model as `opusplan` (best mix: strong planning + efficient implementation).
- Keep default permission mode as `plan` so Claude researches first and asks before edits.

## 2) Your daily workflow (copy this every task)
Use this exact sequence:
1. Explore
2. Plan
3. Approve plan
4. Implement
5. Verify (`npm run test && npm run lint && npm run build`)
6. Report in plain English

Prompt:

```text
Discovery Pass first. Do not implement until plan is approved.

Task:
<describe what you want>

Constraints:
- Keep changes scoped.
- Preserve existing behavior.
- Mobile-first UI quality.
- Do not touch auth flow or DB schema unless explicitly needed.

Done only when these pass:
- npm run test
- npm run lint
- npm run build

Return:
1) what changed,
2) risks,
3) next recommended step.
```

## 3) Frontend design workflow (your strongest usage)
For any meaningful UI change, start with direction options before coding.

Prompt:

```text
Frontend design task. Before coding, propose 3 visual directions with:
- visual mood
- typography approach
- spacing/layout approach
- mobile behavior

After I pick one, implement it and verify mobile + desktop.
Then summarize tradeoffs and any remaining polish ideas.
```

## 4) Best model strategy for you
- Default: `opusplan` for most tasks.
- Use `/model opus` for complex UX decisions or architecture choices.
- Use `/model sonnet` for straightforward mechanical edits.
- Use `/fast` only when you need speed right now and accept higher extra-usage cost.

## 5) Session hygiene (keeps quality high)
- Start unrelated work with `/clear`.
- Name sessions with `/rename` (example: `nutrition-timeline-polish`).
- Resume later with `/resume`.
- If Claude goes off-track twice, `/clear` and re-prompt with tighter scope.

## 6) Must-work acceptance checklist
Before accepting any task, ensure it did not break:
1. Nutrition/Food logging with time
2. Workout start/log/complete and set save
3. Edit past workout/nutrition entries
4. Volume recommendation/status behavior
5. Program view/edit/delete
6. Session restore/sign-in persistence

## 7) Safety defaults
- Never share `.env` values in chat.
- Keep destructive actions explicit.
- Ask Claude to explain risky changes in plain English before applying.

## 8) What good output looks like (for you)
Ask Claude to always respond with:
1. Plain-English summary
2. What files changed
3. Verification result (test/lint/build)
4. Any remaining risk

Use this closer prompt when needed:

```text
Before finalizing, explain results in plain English for a non-programmer.
Then include technical details below that.
```
