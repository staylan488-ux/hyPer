# Claude Model Quick Reference

## Default
- `opusplan`
- Why: better planning quality with efficient implementation.

## When to switch
- Use `/model opus` when:
  - making UX direction calls
  - solving complex architecture or tricky bugs
- Use `/model sonnet` when:
  - doing straightforward edits
  - cleaning lint/types/tests quickly

## Fast mode
- Use `/fast` for live iterative moments where latency matters.
- Turn it off for long autonomous tasks to control extra-usage costs.

## Session-level command reminders
- Check mode/model: `/status`
- Change model: `/model`
- Toggle fast mode: `/fast`
- New task reset: `/clear`
