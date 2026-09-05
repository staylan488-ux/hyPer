# Current work snapshot

Recorded 2026-09-04. Read when resuming work; confirm current git state before
acting. This file records state, not fresh authorization to merge or release.

- Checkout branch at recording: feat/refined-app-icon; HEAD 1fe8e4b, approved
  Studio implementation merged through PR #105. Adaptive calendar #104 and the
  set-save recovery fix are already in this base.
- Approved icon work remains uncommitted in this checkout: the elegant paper/red
  P, centered on its visible outline, with matching opaque 1024×1024 PNGs. Its
  assets/README.md and scripts/generate-app-icon.mjs explain the dedicated export.
  The heavier rounded concept was rejected. Preserve the icon files and exporter.
- Icon verification previously passed: 668 tests, lint, build, pixel/opacity/size
  and centering checks, and Xcode asset-catalog compilation. A new native build
  and physical-device appearance validation remain pending; no release was
  performed by the instruction cleanup.
- Instruction cleanup replaces obsolete FOLIO rules with Studio guidance, shares
  skills through .agents/skills and Claude aliases, narrows verification, and
  archives previous handoffs. See [maintenance](../agent-workflows.md) for the
  current structure and check command.
- Cleanup verification passed: 679 tests, lint, build, three skill validations,
  clean-snapshot integrity and fresh Codex discovery. The [resolution record](../audits/2026-09-04-instruction-cleanup.md)
  distinguishes local fixes from remaining vendor source issues. Project changes
  remain uncommitted; global preferences are installed in their normal locations.
- Preserve unrelated supabase/.temp/linked-project.json and the original local
  ignore-rule intent. The .gitignore additions now make only shared instruction
  adapters and the three skill aliases eligible for version control.
- Next work depends on the user's request: review the instruction changes
  separately from the unfinished icon work; merge or release only within the
  active conversation's authorization.

Earlier detailed history is in the [archived snapshot](archive/2026-09-04-before-instruction-cleanup.md).
