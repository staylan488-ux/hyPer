/**
 * Exercise categories and search for the exercise picker.
 *
 * Categories keep the everyday gym list short: niche calisthenics skills
 * (levers, planches, shrimp squats, ring and one-arm dips…) sit in their own
 * section. A row's `category` column wins when it is set; rows without one
 * (older databases, exercises users added) are classified by name with the
 * same rules the backfill migration uses.
 */
import type { Exercise, ExerciseCategory } from '@/types';
import { MUSCLE_GROUP_LABELS } from '@/types';

/** Equipment that always means a regular gym movement, whatever the name. */
const GYM_EQUIPMENT = ['barbell', 'dumbbell', 'cable', 'machine', 'smith', 'kettlebell'];

/**
 * Name patterns for calisthenics skills and their progressions. Plain staples
 * (Push-Up, Pull-Up, Chin-Up, Dips, Plank, Hanging Leg Raise) stay in the gym list.
 */
const CALISTHENICS_PATTERNS: RegExp[] = [
  /\blevers?\b/,
  /\bplanche/,
  /\bshrimp\b/,
  /\bpistol\b/,
  /\bskater squat/,
  /\bmuscle[- ]?ups?\b/,
  /\bhuman flag\b/,
  /\bdragon flag\b/,
  /\b[lv][- ]sits?\b/,
  /\bhandstand/,
  /\bskin the cat\b/,
  /\barcher\b/,
  /\btypewriter\b/,
  /\brings?\b/,
  /\b(korean|russian) dips?\b/,
  /\bpike push/,
  /\b(clap|clapping|plyo|plyometric|explosive|hindu|diamond) push/,
  /\baustralian pull/,
  /\bhollow (body|hold|rock)/,
  /\bwindshield wiper/,
  /\b(one|single)[- ]arm\b.*\b(push[- ]?ups?|pull[- ]?ups?|chin[- ]?ups?|dips?)\b/,
];

/** The category a library row belongs to. */
export function exerciseCategory(
  exercise: Pick<Exercise, 'name' | 'equipment'> & { category?: ExerciseCategory | null }
): ExerciseCategory {
  if (exercise.category === 'gym' || exercise.category === 'calisthenics') return exercise.category;

  const equipment = (exercise.equipment ?? '').toLowerCase();
  if (GYM_EQUIPMENT.some((kind) => equipment.includes(kind))) return 'gym';

  const name = exercise.name.toLowerCase();
  return CALISTHENICS_PATTERNS.some((pattern) => pattern.test(name)) ? 'calisthenics' : 'gym';
}

/**
 * Extra words a name answers to, so common gym shorthand and alternative names
 * find it ("rdl", "db", "hyperextension" ↔ "back extension").
 */
const NAME_ALIASES: Array<[RegExp, string]> = [
  [/\bdumbbells?\b/, 'db'],
  [/\bbarbell\b/, 'bb'],
  [/\bromanian deadlift\b/, 'rdl'],
  [/\b(overhead|shoulder|military)\b.*\bpress\b/, 'ohp shoulder overhead'],
  [/\bback extension\b/, 'hyperextension hyper'],
  [/\bhyperextension\b/, 'back extension 45'],
  [/\bpec deck\b/, 'chest fly'],
  [/\bfly\b/, 'flye'],
  [/\bpushdown\b/, 'pressdown'],
  [/\bskull ?crushers?\b/, 'lying tricep extension'],
  [/\bcalf raise\b/, 'calves'],
  [/\bpull[- ]?ups?\b/, 'pullup'],
  [/\bchin[- ]?ups?\b/, 'chinup'],
  [/\bpush[- ]?ups?\b/, 'pushup press up'],
];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function words(text: string): string[] {
  const normalized = normalize(text);
  return normalized ? normalized.split(' ') : [];
}

/** Query word forms to try: the word itself plus a simple singular. */
function queryForms(word: string): string[] {
  const forms = [word];
  if (word.length > 4 && word.endsWith('es')) forms.push(word.slice(0, -2));
  if (word.length > 2 && word.endsWith('s')) forms.push(word.slice(0, -1));
  return forms;
}

interface SearchFields {
  nameWords: string[];
  nameCompact: string;
  otherWords: string[];
}

function searchFields(exercise: Exercise): SearchFields {
  const name = normalize(exercise.name);
  const aliases = NAME_ALIASES.filter(([pattern]) => pattern.test(name)).map(([, extra]) => extra);
  const muscles = [exercise.muscle_group, exercise.muscle_group_secondary]
    .filter((group): group is NonNullable<typeof group> => Boolean(group))
    .map((group) => `${group} ${MUSCLE_GROUP_LABELS[group] ?? ''}`);

  return {
    nameWords: name ? name.split(' ') : [],
    nameCompact: name.replace(/ /g, ''),
    otherWords: words([...aliases, ...muscles, exercise.equipment ?? ''].join(' ')),
  };
}

/** How well one query word fits: 3 starts a name word, 2 is inside the name, 1 matches other details, 0 none. */
function wordScore(word: string, fields: SearchFields): number {
  let best = 0;
  for (const form of queryForms(word)) {
    if (fields.nameWords.some((nameWord) => nameWord.startsWith(form))) return 3;
    if (fields.nameCompact.includes(form)) best = Math.max(best, 2);
    else if (fields.otherWords.some((other) => other.startsWith(form))) best = Math.max(best, 1);
  }
  return best;
}

/**
 * Relevance of an exercise for a free-text query, or 0 when it does not match.
 * Every word of the query has to match somewhere, in any order, so
 * "incline press" finds "Incline Dumbbell Bench Press".
 */
export function exerciseSearchScore(exercise: Exercise, query: string): number {
  const queryWords = words(query);
  if (queryWords.length === 0) return 1;

  const fields = searchFields(exercise);
  let total = 0;
  for (const word of queryWords) {
    const score = wordScore(word, fields);
    if (score === 0) return 0;
    total += score;
  }

  const normalizedQuery = queryWords.join(' ');
  const name = fields.nameWords.join(' ');
  if (name === normalizedQuery) total += 20;
  else if (name.startsWith(normalizedQuery)) total += 10;
  else if (name.includes(normalizedQuery)) total += 5;
  return total;
}

/** Exercises matching the query, best match first (ties keep name order). */
export function searchExercises<T extends Exercise>(exercises: T[], query: string): T[] {
  if (words(query).length === 0) return exercises;
  return exercises
    .map((exercise, index) => ({ exercise, index, score: exerciseSearchScore(exercise, query) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.exercise);
}
