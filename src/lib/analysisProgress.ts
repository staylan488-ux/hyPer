import type { AnalysisProgress } from '../../supabase/functions/analyze-food-trial/progress';

/**
 * What a meal analysis is doing, as lines a person reads: the steps already
 * done (in the past tense) and the one under way, with a detail under it (the
 * products searched for, or the heading of Gemini's latest thought). The
 * steps come from the server as they happen; nothing here is invented.
 */
export type TrailStepId = 'send' | 'look' | 'search' | 'compare' | 'read' | 'estimate';

export interface TrailLine {
  id: TrailStepId;
  /** While it runs: "Searching the web". */
  now: string;
  /** Once done: "Searched the web". */
  done: string;
  /** Under the running line: what it is working on. */
  detail: string | null;
}

export interface AnalysisTrail {
  /** Oldest first; the last line is the one under way. */
  lines: TrailLine[];
}

export interface TrailMeal {
  photos: number;
  /** The words of the description, which keep their capitals in Gemini's headings. */
  hint: string;
}

const plural = (count: number, word: string) => `${word}${count === 1 ? '' : 's'}`;

function lookLine(meal: TrailMeal): TrailLine {
  const words = meal.hint.trim().length > 0;
  const photos = meal.photos > 0 ? `your ${plural(meal.photos, 'photo')}` : null;
  if (photos && words) return { id: 'look', now: `Looking at ${photos} and description`, done: `Looked at ${photos} and description`, detail: null };
  if (photos) return { id: 'look', now: `Looking at ${photos}`, done: `Looked at ${photos}`, detail: null };
  return { id: 'look', now: 'Reading your description', done: 'Read your description', detail: null };
}

/**
 * The first line, shown as Analyze is tapped. Photos take a moment to send;
 * a description alone goes at once, so its first line is the reading.
 */
export function startTrail(meal: TrailMeal): AnalysisTrail {
  if (meal.photos === 0) return { lines: [lookLine(meal)] };
  const photos = `your ${plural(meal.photos, 'photo')}`;
  return { lines: [{ id: 'send', now: `Sending ${photos}`, done: `Sent ${photos}`, detail: null }] };
}

const joinNames = (names: string[]) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0] ?? '');

function stepLine(event: Exclude<AnalysisProgress, { step: 'thought' }>, meal: TrailMeal): TrailLine {
  switch (event.step) {
    case 'look':
      return lookLine(meal);
    case 'search':
      return { id: 'search', now: 'Searching the web', done: 'Searched the web', detail: event.products.join(' · ') };
    case 'compare':
      return event.pages === 1
        ? { id: 'compare', now: 'Checking the page found', done: 'Checked the page found', detail: null }
        : { id: 'compare', now: `Comparing ${event.pages} pages`, done: `Compared ${event.pages} pages`, detail: null };
    case 'read': {
      const sites = joinNames(event.sites);
      return { id: 'read', now: `Reading ${sites}`, done: `Read ${sites}`, detail: null };
    }
    case 'estimate':
      return { id: 'estimate', now: 'Working out portions and macros', done: 'Worked out portions and macros', detail: null };
  }
}

/** The trail after one step from the server. A step already shown only updates. */
export function advanceTrail(trail: AnalysisTrail, event: AnalysisProgress, meal: TrailMeal): AnalysisTrail {
  const lines = trail.lines;
  const current = lines.at(-1);
  if (event.step === 'thought') {
    // A heading belongs to the step under way; the web steps keep their own detail.
    if (!current || current.id === 'search' || current.id === 'read' || current.id === 'send') return trail;
    // Names keep their capitals: from the description, and the products searched for.
    const names = lines.filter(line => line.id === 'search').map(line => line.detail ?? '');
    const detail = sentenceCase(event.text, [meal.hint, ...names].join(' '));
    return detail === current.detail ? trail : { lines: [...lines.slice(0, -1), { ...current, detail }] };
  }
  const next = stepLine(event, meal);
  if (current?.id === next.id) return { lines: [...lines.slice(0, -1), { ...next, detail: next.detail ?? current.detail }] };
  // Each step appears once; a repeat (which the server does not send) is ignored.
  if (lines.some(line => line.id === next.id)) return trail;
  return { lines: [...lines, next] };
}

/** Words to leave as written: anything capitalized in the description or a product name. */
function keptWords(context: string): Set<string> {
  return new Set(context.match(/[\p{Lu}][\p{L}\p{N}'’&-]*/gu) ?? []);
}

/**
 * Gemini titles its thought summaries ("Calculating The Macronutrient
 * Totals"); the app writes sentence case. Lowercases title-cased words after
 * the first, but keeps acronyms and names the person used ("Trader Joe's").
 */
export function sentenceCase(text: string, context = ''): string {
  const keep = keptWords(context);
  const words = text.trim().split(/\s+/);
  return words
    .map((word, index) => {
      if (index === 0) return word.charAt(0).toUpperCase() + word.slice(1);
      const bare = word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}'’]+$/gu, '');
      if (keep.has(bare) || bare === 'I' || /^I['’]/.test(bare)) return word;
      // Only a capital followed by lower-case letters is a title-cased word; "USDA", "TJ's" and "iPhone" stay.
      return /^\p{Lu}[\p{Ll}'’-]*$/u.test(bare) ? word.replace(bare, bare.toLowerCase()) : word;
    })
    .join(' ');
}

/** The running line, as VoiceOver says it. */
export function trailAnnouncement(trail: AnalysisTrail): string | null {
  const current = trail.lines.at(-1);
  if (!current) return null;
  // The web steps' detail names what they are working on; a thought heading changes too often to say.
  return current.id === 'search' && current.detail ? `${current.now}: ${current.detail}` : current.now;
}
