// The words VoiceOver speaks for Blanc's shorthand ("3 × 8–12 · last 135 lb").
// Plain functions, no React Native, so the shared tests can run them.

const UNITS: [RegExp, string, string][] = [
  [/kcal\b/, 'calorie', 'calories'],
  [/lbs?\b/, 'pound', 'pounds'],
  [/kg\b/, 'kilogram', 'kilograms'],
  [/g\b/, 'gram', 'grams'],
  [/oz\b/, 'ounce', 'ounces'],
  [/ml\b/, 'milliliter', 'milliliters'],
  [/mi\b/, 'mile', 'miles'],
  [/km\b/, 'kilometer', 'kilometers'],
  [/min\b/, 'minute', 'minutes'],
  [/sec\b/, 'second', 'seconds'],
];

/**
 * What VoiceOver should say for a line written in Blanc's shorthand: the
 * middle dot is a pause, a dash between numbers is "to", "x / y" is "x of
 * y", units after a number are words, and the beat-last-time arrow is left
 * out. "Set 2 of 3 · 8–10 reps" → "Set 2 of 3, 8 to 10 reps"; "135 lb × 8"
 * → "135 pounds × 8" (VoiceOver says "times").
 */
export function speak(text: string): string {
  let spoken = text
    .replace(/\s*·\s*/g, ', ')
    .replace(/(\d)\s*[–—]\s*(\d)/g, '$1 to $2')
    .replace(/(\d) \/ (\d)/g, '$1 of $2')
    .replace(/↑\s*/g, '');
  for (const [unit, one, many] of UNITS) {
    spoken = spoken.replace(
      new RegExp(`(^|[^\\w.,])(\\d[\\d,]*(?:\\.\\d+)?) ?${unit.source}`, 'g'),
      (_match, before: string, value: string) => `${before}${value} ${value === '1' ? one : many}`,
    );
  }
  // A bare "kcal" (a column's unit) reads as calories too.
  return spoken.replace(/\bkcal\b/g, 'calories');
}

/** The spoken form of `text` when it differs from the text itself; otherwise undefined, so VoiceOver reads the text. */
export function spokenLabel(text: string): string | undefined {
  const spoken = speak(text);
  return spoken === text ? undefined : spoken;
}

/** A clock reading ("1:05") as VoiceOver should say it: "1 minute 5 seconds". */
export function spokenClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const part = (value: number, one: string) => `${value} ${one}${value === 1 ? '' : 's'}`;
  const parts = [h > 0 ? part(h, 'hour') : null, m > 0 ? part(m, 'minute') : null, s > 0 || seconds === 0 ? part(s, 'second') : null];
  return parts.filter(Boolean).join(' ');
}

const UNIT_WORDS: Record<string, string> = {
  kcal: 'calories',
  g: 'grams',
  lb: 'pounds',
  lbs: 'pounds',
  kg: 'kilograms',
  oz: 'ounces',
  ml: 'milliliters',
  min: 'minutes',
  s: 'seconds',
  sec: 'seconds',
  '%': 'percent',
  mi: 'miles',
  km: 'kilometers',
};

/** A unit shown beside a field ("kcal", "g", "%") as VoiceOver should say it. */
export function spokenUnit(unit: string): string {
  return UNIT_WORDS[unit.trim()] ?? unit.trim();
}

/**
 * A field's VoiceOver label with its unit, when the unit adds something:
 * "Protein, grams", "Body fat, percent", but "Calories" for kcal.
 */
export function fieldLabel(label: string, unit?: string): string {
  if (!unit) return label;
  const words = spokenUnit(unit);
  return label.toLowerCase().includes(words.toLowerCase()) ? label : `${label}, ${words}`;
}
