// Log food's search over USDA's generic foods, on the phone.
//
// genericFoodIndex.json is USDA FoodData Central's Survey, Foundation and SR
// Legacy foods with their duplicates folded together and one everyday serving
// each (scripts/build-food-index.mjs writes it). Searching it here, instead
// of asking USDA's search for its first ten matches, means the plain food
// comes first ("banana" finds Banana, raw), answers arrive as each letter is
// typed, and nothing depends on the network or USDA's hourly request limit.
import index from '@/lib/genericFoodIndex.json';
import type { Food } from '@/types';

export interface GenericFood {
  name: string;
  /** Per 100 g. */
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  /** The everyday serving: its grams and what a person calls it ("1 banana"), or 100 and "". */
  servingGrams: number;
  servingLabel: string;
  fdcId: string;
  /** How plain and common the food is, from the build. */
  prior: number;
  /** Words of the USDA records folded into this one that the name does not carry. */
  extraWords: string[];
  /** The name and extra words in lower case, for a first cheap test. */
  haystack: string;
  /** The name's words, worked out the first time a search reaches this food. */
  shape?: NameShape;
}

interface NameShape {
  /** Name words, stemmed, in order. */
  words: string[];
  /** How many of `words` are the name's first part ("Chicken breast" of "Chicken breast, grilled"). */
  headLength: number;
  /**
   * The words of the part after it that says which kind ("Cheddar" of "Cheese,
   * Cheddar", "fried" of "Egg, whole, fried"), as a start and an end in `words`.
   */
  kindStart: number;
  kindEnd: number;
}

const STOP = new Set(['and', 'or', 'with', 'of', 'the', 'a', 'an', 'as', 'to', 'in', 'on', 'from', 'for', 'by']);
/** Plurals the stemmer leaves alone (scripts/build-food-index.mjs keeps the same list). */
const KEEP_S = new Set(['swiss', 'molasses', 'hummus', 'couscous', 'asparagus', 'citrus', 'greens', 'grits', 'bass', 'cress', 'watercress', 'lemongrass', 'boneless', 'skinless', 'seedless', 'meatless', 'crustless', 'fatless', 'plus', 'octopus', 'cactus', 'hibiscus', 'gras', 'mousse', 'less', 'dress', 'glass', 'grass', 'series', 'species', 'schnapps', 'chips', 'oats']);

/** Plurals only: "bananas" and "banana", "berries" and "berry" are one word. */
export function stemFoodWord(word: string): string {
  if (word.length <= 3 || KEEP_S.has(word)) return word;
  if (word.endsWith('ies') && word.length > 4) return `${word.slice(0, -3)}y`;
  if (word.endsWith('oes') && word.length > 4) return word.slice(0, -2);
  if (/(ch|sh|ss|x|z)es$/.test(word)) return word.slice(0, -2);
  if (word.endsWith('s') && !/(ss|us|is)$/.test(word)) return word.slice(0, -1);
  return word;
}

export function foodWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/(\d)%/g, '$1 percent')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map(stemFoodWord);
}

/** What people type, in the words USDA's names use. */
const SAME_AS: Record<string, string[]> = {
  yoghurt: ['yogurt'],
  skim: ['skim', 'nonfat'],
  nonfat: ['nonfat', 'skim'],
  mince: ['ground'],
  minced: ['ground'],
  prawn: ['shrimp'],
  aubergine: ['eggplant'],
  courgette: ['zucchini'],
  coriander: ['cilantro', 'coriander'],
  rocket: ['arugula'],
  porridge: ['oatmeal'],
  oats: ['oats', 'oatmeal'],
  oat: ['oat', 'oats', 'oatmeal'],
  soda: ['soda', 'soft'],
  fries: ['fries', 'fry'],
  steak: ['steak'],
  capsicum: ['pepper'],
  garbanzo: ['chickpea', 'garbanzo'],
  chickpea: ['chickpea', 'garbanzo'],
  scallion: ['scallion', 'onion'],
  hamburger: ['hamburger', 'burger'],
  burger: ['burger', 'hamburger', 'cheeseburger'],
  pb: ['peanut'],
  evoo: ['olive'],
  wholemeal: ['whole'],
  wholewheat: ['whole'],
  dry: ['dry', 'raw', 'uncooked'],
  uncooked: ['uncooked', 'raw', 'dry'],
  raw: ['raw', 'uncooked'],
  spaghetti: ['spaghetti', 'pasta'],
  penne: ['penne', 'pasta'],
  noodle: ['noodle', 'pasta'],
  shake: ['shake', 'milkshake'],
  sub: ['sub', 'submarine'],
  coke: ['cola'],
  pepsi: ['cola'],
  tofu: ['tofu'],
};

/** Words that say a food is the ordinary one, so they do not make a name less exact. */
const PLAIN = new Set(['raw', 'cooked', 'plain', 'fresh', 'whole', 'regular', 'unsweetened', 'skinless', 'boneless']);

let parsed: GenericFood[] | null = null;

/** Every food, read from the index once. */
export function genericFoods(): GenericFood[] {
  if (parsed) return parsed;
  const rows = (index as { rows: string }).rows.split('\n');
  const foods: GenericFood[] = [];
  for (const row of rows) {
    const [name, kcal, protein, carbs, fat, grams, label, fdcId, prior, extra] = row.split('\t');
    if (!name || !fdcId) continue;
    foods.push({
      name,
      kcal: Number(kcal),
      protein: Number(protein),
      carbs: Number(carbs),
      fat: Number(fat),
      servingGrams: Number(grams) || 100,
      servingLabel: label ?? '',
      fdcId,
      prior: Number(prior) || 0,
      extraWords: extra ? extra.split(' ') : [],
      haystack: `${name} ${extra ?? ''}`.toLowerCase(),
    });
  }
  parsed = foods;
  return foods;
}

/**
 * Splitting ten thousand names into words on the first letter typed would be
 * felt on a phone, so a name is split when a search first gets as far as it.
 */
function shapeOf(food: GenericFood): NameShape {
  if (food.shape) return food.shape;
  const words = foodWords(food.name);
  // The name's parts as word counts; a part that only says "the ordinary one" is not the kind.
  const parts = food.name.split(', ').map(foodWords);
  const headLength = parts[0].length;
  let kindStart = headLength;
  let kindEnd = headLength;
  let at = headLength;
  for (const part of parts.slice(1)) {
    if (part.length > 0 && !part.every((word) => PLAIN.has(word))) {
      kindStart = at;
      kindEnd = at + part.length;
      break;
    }
    at += part.length;
  }
  food.shape = { words, headLength, kindStart, kindEnd };
  return food.shape;
}

interface QueryWord {
  /** The typed word and the words that mean it. */
  forms: string[];
  /** Still being typed: the last word, so its beginning counts. */
  open: boolean;
}

function queryWords(query: string): QueryWord[] {
  const typed = query.toLowerCase().replace(/[’']/g, '').replace(/(\d)%/g, '$1 percent').split(/[^a-z0-9]+/).filter(Boolean);
  const kept = typed.filter((word) => !STOP.has(word));
  const words = kept.length > 0 ? kept : typed;
  return words.map((word, position) => {
    const stemmed = stemFoodWord(word);
    const forms = new Set<string>([stemmed]);
    for (const same of SAME_AS[word] ?? SAME_AS[stemmed] ?? []) forms.add(stemFoodWord(same));
    return { forms: [...forms], open: position === words.length - 1 };
  });
}

/** 2 for the word itself, 1 for its beginning, 0 for neither. */
function wordMatch(candidate: string, word: QueryWord): number {
  let best = 0;
  for (const form of word.forms) {
    if (candidate === form) return 2;
    // A word still being typed matches from two letters; a finished one needs three.
    if (form.length >= (word.open ? 2 : 3) && candidate.startsWith(form)) best = 1;
  }
  return best;
}

function score(food: GenericFood, query: QueryWord[]): number | null {
  const { words, headLength, kindStart, kindEnd } = shapeOf(food);
  const matched = new Set<number>();
  let total = 0;
  let firstAt = Infinity;
  let inHead = 0;
  let inKind = 0;
  for (const word of query) {
    let bestAt = -1;
    let best = 0;
    for (let at = 0; at < words.length; at += 1) {
      // A name word answers one query word: "egg" twice needs two eggs.
      if (matched.has(at)) continue;
      const match = wordMatch(words[at], word);
      if (match > best) {
        best = match;
        bestAt = at;
        if (match === 2) break;
      }
    }
    if (best === 0) {
      // Words of the records folded into this food still find it, as a weaker match.
      if (!food.extraWords.some((extra) => wordMatch(extra, word) > 0)) return null;
      total -= 45;
      continue;
    }
    matched.add(bestAt);
    firstAt = Math.min(firstAt, bestAt);
    if (bestAt < headLength) inHead += 1;
    else if (bestAt >= kindStart && bestAt < kindEnd) inKind += 1;
    // The word itself beats a word that only starts with it: "egg" is not "eggplant".
    if (best === 1) total -= word.open ? 25 : 30;
  }

  // The name starts with what was typed, in any order: "banana bread" finds "Bread, banana".
  const leads = matched.size === query.length && [...matched].every((at) => at < query.length);
  if (leads) total += 44;
  else if (inHead === query.length) total += 36;
  // USDA files foods under a category: "mozzarella" is "Cheese, Mozzarella", "fried egg" is "Egg, whole, fried".
  else if (inHead + inKind === query.length) total += 30;
  else total += 12 * (inHead / query.length);

  // How much of the name's first part the query accounts for: "banana" is all
  // of "Banana", half of "Banana chips". For a food filed under its category, the kind counts.
  const headShare = inHead / Math.max(1, headLength);
  const kindShare = inKind / Math.max(1, kindEnd - kindStart);
  total += 30 * Math.max(headShare, inHead > 0 ? (headShare + kindShare) / 2 : 0.8 * kindShare);

  // How much of the whole name it accounts for, not counting words that only say "the ordinary one".
  let counted = 0;
  for (let at = 0; at < words.length; at += 1) {
    if (matched.has(at) || !(PLAIN.has(words[at]) || STOP.has(words[at]))) counted += 1;
  }
  total += 14 * (matched.size / Math.max(1, counted));

  if (Number.isFinite(firstAt)) total -= Math.min(firstAt, 6) * 3;
  total += food.prior * 0.7;
  total -= Math.min(food.name.length, 80) * 0.1;
  return total;
}

/** The foods matching every word typed, best first. */
export function rankGenericFoods(query: string, limit = 25): GenericFood[] {
  const words = queryWords(query);
  if (words.length === 0) return [];
  // The cheap test first: each word's beginning must appear somewhere in the name or its extra words.
  // ("berr" for berry, as the name may say berries.)
  const roots = words.map((word) => word.forms.map((form) => (form.endsWith('y') ? form.slice(0, -1) : form)));
  const scored: { food: GenericFood; score: number }[] = [];
  for (const food of genericFoods()) {
    if (!roots.every((forms) => forms.some((root) => food.haystack.includes(root)))) continue;
    const value = score(food, words);
    if (value !== null) scored.push({ food, score: value });
  }
  scored.sort((a, b) => b.score - a.score || a.food.name.length - b.food.name.length || a.food.name.localeCompare(b.food.name));
  return scored.slice(0, limit).map((entry) => entry.food);
}

const roundMacro = (value: number) => Math.round(value * 10) / 10;

/** The food as Log food shows and saves it: one everyday serving, as a USDA result is. */
export function genericFoodToFood(food: GenericFood): Food {
  const factor = food.servingGrams / 100;
  return {
    id: food.fdcId,
    user_id: null,
    name: food.name,
    calories: roundMacro(food.kcal * factor),
    protein: roundMacro(food.protein * factor),
    carbs: roundMacro(food.carbs * factor),
    fat: roundMacro(food.fat * factor),
    serving_size: food.servingGrams,
    serving_unit: 'g',
    ...(food.servingLabel ? { serving_label: food.servingLabel } : {}),
    source: 'usda',
    fdc_id: food.fdcId,
  };
}

/** Reads the index ahead of the first search, which would otherwise pay for it. */
export function prepareGenericFoods(): void {
  genericFoods();
}

/** Log food's search: the best matches for the words typed, ready to show. */
export function searchGenericFoods(query: string, limit = 25): Food[] {
  if (query.trim().length < 2) return [];
  return rankGenericFoods(query, limit).map(genericFoodToFood);
}
