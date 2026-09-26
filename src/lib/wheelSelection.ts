/**
 * A wheel has two sources of movement. A tap chooses its value immediately;
 * scroll events from centering that tap must not choose intermediate values.
 * A new user gesture explicitly gives selection back to scrolling.
 */
export function createWheelSelection(initialIndex: number, onSelect: (index: number) => void) {
  let selected = initialIndex;
  let userScrolling = false;
  const commit = (index: number) => {
    if (index === selected) return;
    selected = index;
    onSelect(index);
  };
  return {
    beginGesture() { userScrolling = true; },
    choose(index: number) {
      userScrolling = false;
      commit(index);
    },
    scroll(index: number) {
      if (userScrolling) commit(index);
    },
  };
}

const DRUM_STEP_DEG = 21;

/**
 * How a wheel row sits on the picker drum, given its distance from the centre
 * row in rows (negative = above) and the row height. Rows tilt around the
 * drum's axis, dim as they turn and gather toward the centre the way rows on
 * a real cylinder do (`shift`, px, relative to their flat scroll position).
 */
export function drumFace(offsetRows: number, rowHeight = 44): { angle: number; opacity: number; shift: number } {
  if (!Number.isFinite(offsetRows)) return { angle: 0, opacity: 1, shift: 0 };
  const clamped = Math.max(-3.5, Math.min(3.5, offsetRows));
  const theta = (clamped * DRUM_STEP_DEG * Math.PI) / 180;
  // Radius whose arc per step equals one row, so the centre rows stay aligned.
  const radius = rowHeight / ((DRUM_STEP_DEG * Math.PI) / 180);
  const shift = radius * Math.sin(theta) - offsetRows * rowHeight;
  return {
    angle: Math.round(-clamped * DRUM_STEP_DEG * 100) / 100 || 0,
    opacity: Math.round(Math.max(0.12, 1 - Math.abs(clamped) * 0.28) * 1000) / 1000,
    shift: Math.round(shift * 100) / 100 || 0,
  };
}
