# Molten glass reference

The browser prototypes the owner approved on 2026-11-09, which the Metal code
in `../ios` ports. Open the HTML files in a browser; nothing here ships in the
app.

- `glass6.html` with `fluid-core.js`: the approved look and its 10 s script.
  The simulation's numbers and the display shader come from here.
- `glass7.html`: the keep-alive that stops the glass thinning to nothing
  after about ten seconds (`?keep=reg:0.4:0.3`, or `?keep=off` to compare).

The app draws this at the "faint" level (`GlassLook` in
`../ios/GlassWorld.swift`), far quieter than the prototypes.
