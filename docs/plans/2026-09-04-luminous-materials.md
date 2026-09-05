# Ivory / Black diffuse materials

## Approved direction

Keep Studio’s Fraunces/Geist typography and editorial composition. The user rejected the earlier smoked blue-gray background, glossy rims and beveled plastic appearance. The approved refinement uses true black, softer tonal buttons and diffuse translucency inspired by a frosted window reference.

- Foundation: Ivory #F5F5F0 or Black #000000.
- Dark primary actions: #303030 fill and #EAEAEA text, including workout Save/Retry, timer controls and run finish feedback. Secondary controls remain near #1C1C1C.
- Shared surfaces: translucent neutral fills with one broad, low-contrast wash. Floating web surfaces blur their backdrop by 22px; sheets use 28px.
- No bright rims, narrow shine bands, inset bevels, colored card edges, colored page gradients or decorative moving light.
- Cards and controls share the diffuse finish without adding their own backdrop filters. Nested and obscured surfaces suppress redundant blur, including body-portal workout docks.
- Typography, spacing, radii, touch targets and motion remain Studio. Increased contrast/reduced transparency remove the wash and blur and use opaque surfaces.
- The real native iOS glass bar remains separate from the simulated web material. See `2026-09-04-native-glass-prototype.md`.

## Scope and validation

Shared controls, sheets, navigation and workout command surfaces use the same material tokens. Today, Fuel, Program, History, Progress, Settings and Run inherit the coordinated treatment. Authentication receives the foundation class only; auth behavior, schemas, dependencies and business logic are unchanged.

Required checks pass: 63 test files / 677 tests, lint and production build (existing warnings). Browser review covers both themes at 320/390px, food saved/manual sheets and no horizontal overflow. Computed dark primary colors are #303030 / #EAEAEA and the page foundation is #000000. Increased-contrast navigation resolves to opaque #111111 with no blur or wash.

The iOS 26.5 simulator confirms both themes, food-sheet readability, native navigation selection and hiding/restoration, and a visible enabled dark Save set control. Physical iPhone feel and keyboard/accessibility review follow TestFlight installation.

The user approved release checks, PR/merge and TestFlight upload on September 4, 2026. Current release status is tracked in AGENTS.md.
