/**
 * The stage light under the app: slow pools of light that drift and lean with
 * the phone's tilt, so the glass above has something to bend. While a session
 * is live the viewport carries `data-live` and a spectral aura rises from the
 * bottom edge (see chrome.css).
 */
export function LightField() {
  return (
    <div className="light-field" aria-hidden>
      <div className="light-field-tilt">
        <span className="light-pool light-pool-a" />
        <span className="light-pool light-pool-b" />
        <span className="light-pool light-pool-c" />
      </div>
      <span className="light-pool light-pool-live" />
    </div>
  );
}

/**
 * Gradients shared by chrome glyphs (`stroke: url(#chrome-glyph)`). Stops read
 * theme tokens, so one definition serves both themes. Lucide icons draw in a
 * 24-unit box, hence user-space coordinates.
 */
export function ChromeDefs() {
  return (
    <svg width="0" height="0" aria-hidden focusable="false" style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}>
      <defs>
        <linearGradient id="chrome-glyph" gradientUnits="userSpaceOnUse" x1="0" y1="2" x2="0" y2="22">
          <stop offset="0" style={{ stopColor: 'var(--glyph-a)' }} />
          <stop offset="0.46" style={{ stopColor: 'var(--glyph-b)' }} />
          <stop offset="0.54" style={{ stopColor: 'var(--glyph-c)' }} />
          <stop offset="1" style={{ stopColor: 'var(--glyph-d)' }} />
        </linearGradient>
      </defs>
    </svg>
  );
}
