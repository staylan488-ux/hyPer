// The words VoiceOver speaks for Blanc's shorthand ("3 × 8–12 · last 135 lb").
// Plain functions, no React Native, so the shared tests can run them.

type Unit = {
  /** The unit as written, a regular expression source. */
  written: string;
  one: string;
  many: string;
  /** How the app writes it after a number: "20m" is minutes, "400 m" metres. */
  space?: 'attached' | 'spaced';
};

// Longer units before the ones they start with ("m/s" before "m").
const UNITS: Unit[] = [
  { written: 'm/s', one: 'meter per second', many: 'meters per second' },
  { written: 'kcal', one: 'calorie', many: 'calories' },
  { written: 'lbs?', one: 'pound', many: 'pounds' },
  { written: 'kg', one: 'kilogram', many: 'kilograms' },
  { written: 'g', one: 'gram', many: 'grams' },
  { written: 'oz', one: 'ounce', many: 'ounces' },
  { written: 'ml', one: 'milliliter', many: 'milliliters' },
  { written: 'mi', one: 'mile', many: 'miles' },
  { written: 'km', one: 'kilometer', many: 'kilometers' },
  { written: 'min', one: 'minute', many: 'minutes' },
  { written: 'sec', one: 'second', many: 'seconds' },
  { written: 'h', one: 'hour', many: 'hours' },
  { written: 'cm', one: 'centimeter', many: 'centimeters' },
  { written: 'ft', one: 'foot', many: 'feet' },
  { written: 'yrs?', one: 'year', many: 'years' },
  { written: 's', one: 'second', many: 'seconds', space: 'spaced' },
  { written: 'm', one: 'minute', many: 'minutes', space: 'attached' },
  { written: 'm', one: 'meter', many: 'meters', space: 'spaced' },
];

const GAP = { attached: '', spaced: ' ', either: ' ?' } as const;

// Built once: BlancText speaks every plain line it draws.
const UNIT_PATTERNS = UNITS.map(({ written, one, many, space }) => ({
  pattern: new RegExp(`(^|[^\\w.,])(\\d[\\d,]*(?:\\.\\d+)?)${GAP[space ?? 'either']}${written}\\b`, 'g'),
  one,
  many,
}));

/**
 * What VoiceOver should say for a line written in Blanc's shorthand: the
 * middle dot is a pause, a dash between numbers is "to", "x / y" is "x of
 * y", "~2" is "about 2", rates and units after a number are words, and the
 * beat-last-time arrow is left out. "Set 2 of 3 · 8–10 reps" → "Set 2 of 3, 8 to 10 reps"; "135 lb × 8"
 * → "135 pounds × 8" (VoiceOver says "times").
 */
export function speak(text: string): string {
  let spoken = text
    // A no-break space (it keeps "avg 172.4 lb" on one line) reads as a space.
    .replace(/\u00a0/g, ' ')
    .replace(/\s*·\s*/g, ', ')
    .replace(/(\d)\s*[–—]\s*(\d)/g, '$1 to $2')
    .replace(/(\d) \/ (\d)/g, '$1 of $2')
    // Rates: "+0.42 lb/wk", "7:59 /mi".
    .replace(/ ?\/(wk|week)\b/g, ' a week')
    .replace(/ ?\/day\b/g, ' a day')
    .replace(/ ?\/mi\b/g, ' per mile')
    .replace(/ ?\/km\b/g, ' per kilometer')
    // "add ~2 sets"
    .replace(/~(\d)/g, 'about $1')
    // A month's "avg 172.4 lb"
    .replace(/\bavg\b/g, 'average')
    .replace(/↑\s*/g, '');
  for (const { pattern, one, many } of UNIT_PATTERNS) {
    spoken = spoken.replace(pattern, (_match, before: string, value: string) => `${before}${value} ${value === '1' ? one : many}`);
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
  m: 'meters',
  cm: 'centimeters',
  ft: 'feet',
  yr: 'years',
  yrs: 'years',
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
