// The weight scales Body weight's charts draw against. Pure geometry.

/** Steps the full chart's scale can take, in pounds or kilograms. */
const STEPS = [0.5, 1, 2, 5, 10, 20, 25, 50, 100];
/** The most lines the full chart's scale draws. */
const MOST_TICKS = 5;

const spread = (values: number[], minSpan: number): [number, number] => {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) return [0, minSpan];
  let low = Math.min(...finite);
  let high = Math.max(...finite);
  if (high - low < minSpan) {
    const mid = (low + high) / 2;
    low = mid - minSpan / 2;
    high = mid + minSpan / 2;
  }
  return [low, high];
};

const round = (value: number) => Number(value.toFixed(1));

/**
 * The full chart's scale: round weights that enclose every value, the lowest
 * drawn on the chart's bottom edge as its axis and the highest at its top.
 * The values span at least `minSpan`. The lowest value stays at least
 * `clearance` points above the bottom line (a dot sitting on the axis would
 * be cut by the frame), so the scale steps down once more when it would not.
 * `plotHeight` is the distance in points from the top line to the bottom one.
 */
export function weightScale(
  values: number[],
  { minSpan, plotHeight, clearance }: { minSpan: number; plotHeight: number; clearance: number },
): { domain: [number, number]; ticks: number[]; step: number } {
  const [low, high] = spread(values, minSpan);
  for (const step of STEPS) {
    let bottom = Math.floor(low / step + 1e-9) * step;
    let top = Math.ceil(high / step - 1e-9) * step;
    if (top - bottom < step) top = bottom + step;
    if (((low - bottom) / (top - bottom)) * plotHeight < clearance) bottom -= step;
    const count = Math.round((top - bottom) / step) + 1;
    if (count > MOST_TICKS) continue;
    const ticks = Array.from({ length: count }, (_, index) => round(bottom + index * step));
    return { domain: [round(bottom), round(top)], ticks, step };
  }
  return { domain: [low, high], ticks: [], step: 1 };
}

/**
 * The sparkline's range: the values themselves with a little room, so a
 * few weeks' change fills the line's height. A change smaller than
 * `minSpan` is drawn at that span, so a steady weight stays nearly flat.
 */
export function sparklineDomain(values: number[], minSpan: number): [number, number] {
  const [low, high] = spread(values, minSpan);
  const room = (high - low) * 0.04;
  return [low - room, high + room];
}
