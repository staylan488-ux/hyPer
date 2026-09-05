---
name: studio-design
description: Apply hyPer's approved Studio design when creating or editing its interface, typography, layout, controls, or motion.
---

# Studio design

Continue the approved Studio design. Reuse the existing shared components and
tokens; an already approved direction does not need another design exploration.

## Typography and color

- Fraunces carries page titles and key figures; Geist carries interface text
  and compact tabular data. There is no separate monospace voice.
- Current roles are 40px/1.06 Fraunces titles, 44px/1 Fraunces key figures,
  14px/1.45 body, 12px/1.4 support, and 11px/1.4 labels. Adapt for readability
  and accessibility without truncating meaningful names.
- Use Paper/Ink theme tokens and one restrained Lacquer red accent. Positive
  and completed states use ink. Use semantic color tokens for both themes.
- `text-base` collides with the `--color-base` theme color in Tailwind v4;
  use `text-[1rem]` when a 16px font size is intended.

## Structure and controls

- Content stays flat and editorial, separated by neutral rules and spacing.
  Do not add colored accent edges, floating shadow cards, or decorative glows.
- Primary actions are filled ink; secondary actions use quiet filled surfaces;
  contextual row actions stay unboxed. Meaningful touch targets are at least 44px.
- Use the dedicated radius tokens: controls 11px, sheets 20px, navigation 22px.
  Ordinary content containers retain square corners.
- Preserve the inset four-tab navigation and anchored workout set/rest surface.
  Set entry becomes rest only after the save succeeds; retain drafts and Retry.

## Motion and mobile behavior

- Routes appear immediately and restore their scroll position. Do not transform
  the route ancestor: that captures viewport-fixed workout/native overlays.
- Use restrained local state transitions and the shared reduced-motion policy.
  Paper grain is static; moving light and repeated page entrances are removed.
- Preserve safe areas, visible-viewport keyboard behavior, nested sheet focus,
  and background isolation. Inspect changed UI in Paper/Ink at phone widths.

## Implementation references

- [Tokens and typography](../../../src/index.css), [route shell](../../../src/App.tsx).
- [Shared controls and sheets](../../../src/components/shared/),
  [motion primitives](../../../src/lib/animations.ts).
- [Preview fixtures](../../../src/preview/): use `/preview` in the dev server;
  `/preview?previewSetSave=fail` exercises save failure and Retry.
