#!/usr/bin/env node
// Builds src/lib/genericFoodIndex.json, the food list Log food searches on the
// phone, from USDA FoodData Central's three generic datasets (public domain):
// Survey (FNDDS), Foundation and SR Legacy. Branded foods are not included.
//
//   node scripts/build-food-index.mjs [--dir <folder with the USDA JSON files>] [--report <file>]
//
// Without --dir the three zips are downloaded from fdc.nal.usda.gov into a
// temporary folder (about 18 MB) and removed afterwards. The output is
// deterministic for the same input files.
//
// What it does to USDA's ~13,500 records:
//   1. Drops what cannot be logged (no macros) and what this app's audience
//      does not search for (baby food, infant formula, "as ingredient" rows).
//   2. Treats records as one food when their names say the same thing and
//      their macros agree: "Bananas, raw" (SR Legacy), "Banana, raw" (Survey)
//      and "Bananas, ripe and slightly ripe, raw" (Foundation) become one row.
//      Qualifiers that rarely change the numbers (fresh/frozen/canned, with or
//      without salt, enriched, which fat it was cooked in, where it was
//      bought) do not make a new food unless the macros really differ.
//   3. Keeps USDA's own default record as the plain row ("NFS" / "NS as to…"
//      mean "not specified"), named for what it really is.
//   4. Picks one everyday serving per food (USDA's "quantity not specified"
//      amount when it has one: 1 banana, 2 eggs, 1 cup).
//   5. Gives every row a prior the search uses to break ties toward plain,
//      common foods.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATASETS = [
  { zip: 'FoodData_Central_survey_food_json_2024-10-31.zip', json: 'surveyDownload.json', key: 'SurveyFoods', type: 'survey' },
  { zip: 'FoodData_Central_foundation_food_json_2025-04-24.zip', json: 'FoodData_Central_foundation_food_json_2025-04-24.json', key: 'FoundationFoods', type: 'foundation' },
  { zip: 'FoodData_Central_sr_legacy_food_json_2018-04.zip', json: 'FoodData_Central_sr_legacy_food_json_2018-04.json', key: 'SRLegacyFoods', type: 'sr' },
];
const DOWNLOAD_BASE = 'https://fdc.nal.usda.gov/fdc-datasets/';
const OUTPUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'lib', 'genericFoodIndex.json');

// ---------------------------------------------------------------------------
// Reading USDA's files
// ---------------------------------------------------------------------------

function macrosOf(food) {
  const byNumber = new Map();
  for (const entry of food.foodNutrients ?? []) {
    const number = entry.nutrient?.number;
    const unit = entry.nutrient?.unitName;
    if (number == null || typeof entry.amount !== 'number') continue;
    const key = `${number}|${unit}`;
    if (!byNumber.has(key)) byNumber.set(key, entry.amount);
  }
  const pick = (...keys) => {
    for (const key of keys) if (byNumber.has(key)) return byNumber.get(key);
    return null;
  };
  // 208 is energy; Foundation foods often carry only the Atwater figures (957/958).
  let kcal = pick('208|kcal', '958|kcal', '957|kcal');
  if (kcal == null && byNumber.has('268|kJ')) kcal = byNumber.get('268|kJ') / 4.184;
  return {
    kcal,
    protein: pick('203|g'),
    carbs: pick('205|g', '205.2|g'),
    fat: pick('204|g', '298|g'),
  };
}

function portionsOf(food) {
  return (food.foodPortions ?? [])
    .map((portion) => ({
      grams: portion.gramWeight,
      amount: typeof portion.amount === 'number' ? portion.amount : typeof portion.value === 'number' ? portion.value : null,
      modifier: (portion.modifier ?? '').trim(),
      description: (portion.portionDescription ?? '').trim(),
      unit: (portion.measureUnit?.name ?? '').trim(),
      abbreviation: (portion.measureUnit?.abbreviation ?? '').trim(),
      sequence: portion.sequenceNumber ?? 999,
    }))
    .sort((a, b) => a.sequence - b.sequence);
}

function loadRecords(dir) {
  const records = [];
  // How many of USDA's survey recipes use a food as an ingredient: its own
  // measure of what a staple is (whole egg 308 recipes, cooked white rice 154).
  const uses = new Map();
  for (const dataset of DATASETS) {
    const foods = JSON.parse(readFileSync(path.join(dir, dataset.json), 'utf8'))[dataset.key];
    for (const food of foods) {
      const ingredients = dataset.type === 'survey' ? food.inputFoods ?? [] : [];
      for (const ingredient of ingredients) {
        // A food that is one ingredient under another name is that food, not a recipe using it.
        if (ingredients.length === 1) continue;
        const code = String(ingredient.ingredientCode);
        uses.set(code, (uses.get(code) ?? 0) + 1);
      }
      records.push({
        id: food.fdcId,
        type: dataset.type,
        code: String(food.foodCode ?? food.ndbNumber ?? ''),
        raw: food.description.trim().replace(/\s+/g, ' '),
        category: food.foodCategory?.description ?? food.wweiaFoodCategory?.wweiaFoodCategoryDescription ?? '',
        ...macrosOf(food),
        portions: portionsOf(food),
      });
    }
  }
  for (const record of records) record.uses = uses.get(record.code) ?? 0;
  return records;
}

function download(dir) {
  for (const dataset of DATASETS) {
    const zip = path.join(dir, dataset.zip);
    execFileSync('curl', ['-sSfL', '--retry', '3', '-o', zip, DOWNLOAD_BASE + dataset.zip], { stdio: 'inherit' });
    execFileSync('unzip', ['-o', '-q', zip, '-d', dir], { stdio: 'inherit' });
  }
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

const lower = (text) => text.toLowerCase();

/** A segment that only says USDA did not know more: the record is its default for the food. */
const isDefaultMarker = (segment) => /^(nfs|ns as to .+|.+ or nfs)$/.test(segment) || segment === 'white or nfs';

/** Which fat a food was cooked in: never a food of its own. */
const isFatType = (segment) =>
  /^(made|cooked|fried) with (butter|margarine|oil|butter or margarine|animal fat or meat drippings|cooking spray|fat)$/.test(segment)
  || /^fat added, made with /.test(segment);

/**
 * Qualifiers that rarely change the macros. They are left out of a food's
 * identity, so two records that differ only in these are compared by their
 * numbers: one row when they agree, two when they do not.
 */
function softKind(segment) {
  if (isFatType(segment)) return 'fat';
  if (segment === 'fat added' || segment === 'no added fat' || segment === 'fat not added in cooking') return 'fat';
  if (/^(from )?(fresh|frozen|canned|raw|pre-?cooked|dried|dry mix|mix)$/.test(segment) && segment !== 'raw' && segment !== 'dried') return 'form';
  if (/^(from |purchased at )?(a )?(fast food|restaurant|fast food \/ restaurant|restaurant or fast food|school lunch|school cafeteria|school|other sources|vending machine|bakery)$/.test(segment)) return 'source';
  if (/^(home recipe|made from home recipe.*|ready-to-heat|ready-to-eat|ready-to-serve|commercially prepared|prepared from recipe|store bought|homemade)$/.test(segment)) return 'source';
  if (/^(reduced sodium|low sodium|lower sodium|no salt added|unsalted|salted|lightly salted|with salt|without salt|with salt added|without salt added|salt added|no added salt)$/.test(segment)) return 'salt';
  if (/^(enriched|unenriched|fluid|all grades|all varieties|all commercial varieties|all areas|year round average|all types|includes .*)$/.test(segment)) return 'usda';
  if (/^with(out)? added (vitamin|calcium|nonfat milk solids)/.test(segment) || /^(vitamin [ad]( and vitamin [ad])? (added|fortified)|calcium fortified)$/.test(segment)) return 'usda';
  if (/^(broilers? or fryers?|mature seeds|immature seeds|solids and liquids)$/.test(segment)) return 'usda';
  return null;
}

/** Soft segments that never help a reader, whatever else is in the cluster. */
const neverShown = (segment) =>
  softKind(segment) === 'usda' || /^from (raw|pre-?cooked)$/.test(segment);

const FRIENDLY = new Map([
  ['skin not eaten', 'skinless'],
  ['skin eaten', 'with skin'],
  ['skin / coating not eaten', 'skin and coating removed'],
  ['skin / coating eaten', 'with skin and coating'],
  ['peel not eaten', 'without peel'],
  ['peel eaten', 'with peel'],
  ['lean only eaten', 'lean only'],
  ['lean and fat eaten', 'lean and fat'],
  ['meat only', 'skinless'],
  ['grilled without sauce', 'grilled'],
  ['meat and skin', 'with skin'],
]);

/** "KFC" stays; "QUAKER" and "POPEYES" read as words. */
function calmCapitals(text) {
  return text.replace(/\b[A-Z][A-Z'&-]{3,}\b/g, (word) => word[0] + word.slice(1).toLowerCase());
}

function splitSegments(raw) {
  // USDA's own remark, not part of the food's name.
  const text = raw.replace(/\s*\(Includes foods for USDA's Food Distribution Program\)/i, '');
  // Commas inside brackets ("1/8 of 9" dia, sliced)") do not start a segment.
  const segments = [];
  let depth = 0;
  let current = '';
  for (const char of text) {
    if (char === '(') depth += 1;
    if (char === ')') depth = Math.max(0, depth - 1);
    if (char === ',' && depth === 0) {
      segments.push(current.trim());
      current = '';
    } else current += char;
  }
  segments.push(current.trim());
  return segments.filter(Boolean);
}

const STOP = new Set(['and', 'or', 'with', 'of', 'the', 'a', 'an', 'as', 'to', 'in', 'on', 'from', 'for', 'by', 'style', 'type', 'made', 'not', 'no']);
const KEEP_S = new Set(['swiss', 'molasses', 'hummus', 'couscous', 'asparagus', 'citrus', 'greens', 'grits', 'bass', 'cress', 'watercress', 'lemongrass', 'boneless', 'skinless', 'seedless', 'meatless', 'crustless', 'fatless', 'plus', 'octopus', 'cactus', 'hibiscus', 'gras', 'mousse', 'swiss', 'less', 'dress', 'glass', 'grass', 'series', 'species', 'schnapps', 'chips', 'oats']);

/** The same stemmer the app's search uses (src/lib/genericFoods.ts): plurals only. */
export function stem(word) {
  if (word.length <= 3 || KEEP_S.has(word)) return word;
  if (word.endsWith('ies') && word.length > 4) return `${word.slice(0, -3)}y`;
  if (word.endsWith('oes') && word.length > 4) return word.slice(0, -2);
  if (/(ch|sh|ss|x|z)es$/.test(word)) return word.slice(0, -2);
  if (word.endsWith('s') && !/(ss|us|is)$/.test(word)) return word.slice(0, -1);
  return word;
}

export function tokens(text) {
  return lower(text)
    .replace(/[’']/g, '')
    .replace(/(\d)%/g, '$1 percent')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map(stem);
}

/** Phrases whose words would otherwise collide ("skin eaten" inside "skin not eaten"). */
function identityText(segment) {
  return segment
    .replace(/skin \/ coating not eaten|skin not eaten|meat only/g, 'skinless')
    .replace(/skin \/ coating eaten|skin eaten|meat and skin/g, 'withskin')
    .replace(/peel not eaten/g, 'nopeel')
    .replace(/peel eaten/g, 'withpeel')
    .replace(/lean only eaten|separable lean only/g, 'leanonly')
    .replace(/lean and fat eaten|separable lean and fat/g, 'leanfat')
    .replace(/fat free|nonfat|non-fat/g, 'fatfree')
    .replace(/low fat|lowfat|low-fat/g, 'lowfat')
    .replace(/reduced fat/g, 'reducedfat')
    .replace(/sugar free|sugar-free/g, 'sugarfree')
    .replace(/unsweetened|no sugar added|without added sugar/g, 'unsweetened')
    .replace(/uncooked|unprepared/g, 'raw')
    .replace(/\bdry\b(?! (heat|roasted|mix))/g, 'raw');
}

function describe(record) {
  const segments = splitSegments(record.raw);
  const lowered = segments.map(lower);
  const isDefault = lowered.some(isDefaultMarker);
  const hard = [];
  const soft = [];
  lowered.forEach((segment, index) => {
    if (isDefaultMarker(segment)) return;
    // The first segment is the food itself, whatever it says.
    const kind = index === 0 ? null : softKind(segment);
    if (kind) soft.push({ kind, text: segment, original: segments[index] });
    else hard.push({ text: segment, original: segments[index] });
    // "cooked with oil" still says cooked.
    const way = kind === 'fat' ? /^(cooked|fried) with /.exec(segment)?.[1] : null;
    if (way) hard.push({ text: way, original: way });
  });
  const key = [...new Set(hard.flatMap((segment) => tokens(identityText(segment.text))).filter((token) => !STOP.has(token)))].sort().join(' ');
  return { segments, lowered, isDefault, hard, soft, key };
}

const PREPARED = /^(raw|cooked|fried|baked|broiled|grilled|steamed|smoked|canned|dried|breaded|battered|coated|floured|pickled|baked or broiled|baked or grilled)\b/;
const WHOLE_NAMES = new Map([
  ['Nutritional powder mix, protein', 'Protein powder'],
  ['Nutritional powder mix, whey based', 'Protein powder, whey'],
  ['Nutritional powder mix, protein, soy based', 'Protein powder, soy'],
  ['Nutritional powder mix, protein, light', 'Protein powder, light'],
]);

/** USDA files a food under its category; people ask for it by name. */
function everydayName(name) {
  if (WHOLE_NAMES.has(name)) return WHOLE_NAMES.get(name);
  const segments = name.split(', ');
  if (segments[0] === 'Soybean curd') return ['Tofu', ...segments.slice(1)].join(', ');
  // "Fish, salmon, grilled" is salmon; "Fish, fried" stays fish.
  if (segments[0] === 'Fish' && segments.length > 1 && /^[a-z]+( [a-z]+)?$/.test(segments[1]) && !PREPARED.test(segments[1])) {
    segments.shift();
    segments[0] = segments[0].charAt(0).toUpperCase() + segments[0].slice(1);
    return segments.join(', ');
  }
  if (segments.length > 1 && /^(Beef|Turkey|Pork|Chicken|Lamb|Bison|Veal)$/.test(segments[0]) && segments[1] === 'ground') {
    return [`Ground ${segments[0].toLowerCase()}`, ...segments.slice(2)].join(', ');
  }
  // Asked for as a phrase; other cheeses keep "Cheese, Cheddar", so "cheese" lists them together.
  if (segments[0] === 'Cheese' && (segments[1] === 'cottage' || segments[1] === 'cream')) {
    return [`${segments[1].charAt(0).toUpperCase()}${segments[1].slice(1)} cheese`, ...segments.slice(2)].join(', ');
  }
  return name;
}

const COOKED = /\b(cooked|baked|broiled|fried|grilled|roasted|stewed|steamed|boiled|braised|smoked|rotisserie|microwaved|poached|scrambled|sauteed|barbecued|toasted)\b/;

/** The row's name: the record's own words, minus what says nothing. */
function displayName(record, droppedSoft = new Set()) {
  const shown = [];
  record.lowered.forEach((segment, index) => {
    if (segment === 'ns as to cooking method') {
      // Cooked somehow: say so, or the row reads as the raw food.
      if (!record.lowered.some((other) => COOKED.test(other)) && !shown.includes('cooked')) shown.push('cooked');
      return;
    }
    if (isDefaultMarker(segment)) return;
    if (index > 0 && (neverShown(segment) || droppedSoft.has(segment))) return;
    if (index > 0 && isFatType(segment)) {
      const way = /^(cooked|fried)/.exec(segment)?.[1];
      if (way && !shown.includes(way)) shown.push(way);
      // Fried says fat was used.
      if (way === 'fried') return;
      if (!shown.includes('fat added')) shown.push('fat added');
      return;
    }
    const text = FRIENDLY.get(segment) ?? calmCapitals(record.segments[index]);
    if (!shown.includes(text)) shown.push(text);
  });
  const name = shown.join(', ');
  return name.charAt(0).toUpperCase() + name.slice(1);
}

// ---------------------------------------------------------------------------
// Which records are one food
// ---------------------------------------------------------------------------

function near(a, b, { kcalAbs, kcalRel, gramAbs, gramRel }) {
  const within = (x, y, abs, rel) => Math.abs(x - y) <= Math.max(abs, rel * Math.max(Math.abs(x), Math.abs(y)));
  return within(a.kcal, b.kcal, kcalAbs, kcalRel)
    && within(a.protein, b.protein, gramAbs, gramRel)
    && within(a.carbs, b.carbs, gramAbs, gramRel)
    && within(a.fat, b.fat, gramAbs, gramRel);
}
/** Same name, numbers that agree as well as two samples of one food do. */
const SAME_FOOD = { kcalAbs: 8, kcalRel: 0.12, gramAbs: 2, gramRel: 0.2 };
/** The same numbers, for records USDA derived from one another. */
const TWIN = { kcalAbs: 1.5, kcalRel: 0.015, gramAbs: 0.25, gramRel: 0.02 };

/** One name inside the other, across datasets: the numbers of a record copied with rounding. */
const SAME_WORDS = { kcalAbs: 2, kcalRel: 0.02, gramAbs: 0.3, gramRel: 0.03 };

const namesFat = (record) => record.soft.some((segment) => isFatType(segment.text));
const fatFree = (record) => record.soft.some((segment) => segment.text === 'no added fat' || segment.text === 'fat not added in cooking' || /with cooking spray$/.test(segment.text));
/** 'none', 'added' or null when the name does not say. */
const fatClass = (record) => (fatFree(record) ? 'none' : record.soft.some((segment) => segment.kind === 'fat') ? 'added' : null);

const TYPE_RANK = { survey: 0, foundation: 1, sr: 2 };

/** Lower sorts first: the record that should name and represent its cluster. */
function seedOrder(a, b) {
  return TYPE_RANK[a.type] - TYPE_RANK[b.type]
    || Number(b.isDefault) - Number(a.isDefault)
    || a.soft.length - b.soft.length
    || a.raw.length - b.raw.length
    || a.raw.localeCompare(b.raw)
    || a.id - b.id;
}

function cluster(records) {
  const byKey = new Map();
  for (const record of records) {
    if (!byKey.has(record.key)) byKey.set(record.key, []);
    byKey.get(record.key).push(record);
  }

  const clusters = [];
  for (const group of byKey.values()) {
    group.sort(seedOrder);
    const taken = new Set();
    for (const seed of group) {
      if (taken.has(seed)) continue;
      // A row for each fat a food was cooked in is noise: when the food has a
      // record cooked in fat that does not name it, the ones that do fold
      // into the nearest of those.
      if (namesFat(seed) && group.some((other) => !namesFat(other) && !fatFree(other))) continue;
      taken.add(seed);
      const members = [seed];
      for (const other of group) {
        if (taken.has(other) || !near(seed, other, SAME_FOOD)) continue;
        taken.add(other);
        members.push(other);
      }
      clusters.push({ seed, members });
    }
    // The fat-type records nothing absorbed join the nearest cluster of their food cooked in fat.
    const ofFood = clusters.filter((entry) => entry.seed.key === group[0].key);
    const here = ofFood.some((entry) => !fatFree(entry.seed)) ? ofFood.filter((entry) => !fatFree(entry.seed)) : ofFood;
    for (const record of group) {
      if (taken.has(record)) continue;
      let best = here[0];
      for (const entry of here) if (Math.abs(entry.seed.kcal - record.kcal) < Math.abs(best.seed.kcal - record.kcal)) best = entry;
      best.members.push(record);
    }
  }

  // USDA's default record ("Potato, NFS") usually copies a specific one
  // ("Potato, boiled"). They are one row, named for what the numbers are.
  const byMacro = new Map();
  const macroKey = (record) => `${Math.round(record.kcal)}|${Math.round(record.protein)}|${Math.round(record.carbs)}|${Math.round(record.fat)}`;
  for (const entry of clusters) {
    const key = macroKey(entry.seed);
    if (!byMacro.has(key)) byMacro.set(key, []);
    byMacro.get(key).push(entry);
  }
  const absorbed = new Set();
  const keySet = (entry) => new Set(entry.seed.key.split(' '));
  const isSubset = (small, big) => small.size < big.size && [...small].every((token) => big.has(token));
  // Smallest names first, so a chain (Potato < Potato, boiled < Potato, boiled, without peel) folds upward.
  const ordered = [...clusters].sort((a, b) => a.seed.key.split(' ').length - b.seed.key.split(' ').length || seedOrder(a.seed, b.seed));
  for (const bare of ordered) {
    if (absorbed.has(bare)) continue;
    const bareKeys = keySet(bare);
    const twins = (byMacro.get(macroKey(bare.seed)) ?? []).filter((other) =>
      other !== bare && !absorbed.has(other) && near(bare.seed, other.seed, TWIN) && isSubset(bareKeys, keySet(other)));
    if (twins.length === 0) continue;
    for (const twin of twins) {
      absorbed.add(twin);
      bare.members.push(...twin.members);
    }
    bare.twins = twins.map((twin) => twin.seed);
    // "Milk, nonfat" (Foundation) and "Milk, fat free (skim)" (Survey) with the
    // same numbers: the friendlier record names the row.
    if (!bare.seed.isDefault) bare.seed = [bare.seed, ...bare.twins].sort(seedOrder)[0];
  }
  const kept = clusters.filter((entry) => !absorbed.has(entry));

  // The reference datasets describe the same food in more words ("Milk,
  // whole, 3.25% milkfat" for Survey's "Milk, whole"). When one name contains
  // the other and the numbers agree closely, the friendlier dataset's row stands.
  const byWord = new Map();
  for (const entry of kept) {
    for (const word of keySet(entry)) {
      if (!byWord.has(word)) byWord.set(word, []);
      byWord.get(word).push(entry);
    }
  }
  const folded = new Set();
  for (const entry of [...kept].sort((a, b) => seedOrder(a.seed, b.seed))) {
    if (folded.has(entry) || entry.seed.type === 'survey') continue;
    const words = keySet(entry);
    // The rarest word narrows the candidates.
    // A name inside this one shares each of its own words with it; a name this
    // one is inside shares all of this one's.
    const candidates = new Set([...words].flatMap((word) => byWord.get(word)));
    let best = null;
    for (const other of candidates) {
      if (other === entry || folded.has(other) || TYPE_RANK[other.seed.type] >= TYPE_RANK[entry.seed.type]) continue;
      const otherWords = keySet(other);
      if (!(isSubset(words, otherWords) || isSubset(otherWords, words))) continue;
      // A one-word name is inside too many others to mean the same food.
      if (Math.min(words.size, otherWords.size) < 2) continue;
      if (!near(entry.seed, other.seed, SAME_WORDS)) continue;
      const distance = Math.abs(otherWords.size - words.size);
      if (!best || distance < best.distance) best = { other, distance };
    }
    if (!best) continue;
    folded.add(entry);
    best.other.members.push(...entry.members);
  }
  return kept.filter((entry) => !folded.has(entry));
}

/**
 * A default record that copies specific ones is named by what those have in
 * common: "Rice, cooked, NFS" = "Rice, white, cooked…" reads "Rice, white, cooked".
 */
function nameCluster(entry) {
  const { seed, members } = entry;
  // A soft qualifier some member of the cluster lacks is not true of the row.
  const dropped = new Set();
  for (const segment of seed.soft) {
    // Fresh, frozen or canned (and where it was bought) stay unless some member says neither.
    const differs = segment.kind === 'fat'
      ? members.some((member) => fatClass(member) !== fatClass(seed))
      : segment.kind === 'form' || segment.kind === 'source'
        ? members.some((member) => !member.soft.some((other) => other.kind === segment.kind))
        : members.some((member) => !member.lowered.includes(segment.text));
    if (differs) dropped.add(segment.text);
  }
  const own = everydayName(displayName(seed, dropped));
  if (!entry.twins || !seed.isDefault) return own;
  const twinNames = entry.twins.map((twin) => displayName(twin, new Set(twin.soft.map((segment) => segment.text))).split(', '));
  const common = twinNames[0].filter((segment) => twinNames.every((name) => name.includes(segment)));
  // Only when the twins agree on something the default leaves out.
  const ownPlain = displayName(seed, dropped).split(', ');
  if (common.length > ownPlain.length && ownPlain.every((segment) => common.includes(segment))) return everydayName(common.join(', '));
  return own;
}

// ---------------------------------------------------------------------------
// One everyday serving
// ---------------------------------------------------------------------------

const tidyAmount = (value) => String(Math.round(value * 100) / 100);

function surveyLabel(portion) {
  return portion.description
    .replace(/\s*\((.*?)\)\s*$/, '')
    .replace(/, any size$/i, '')
    .replace(/, (NFS|NS as to .*)$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function pluralize(label, count) {
  // "1 egg" x 2 -> "2 eggs". Only labels that are plainly "1 <thing>".
  const match = /^1 ([a-z]+(?: [a-z]+)?)$/.exec(label);
  if (!match || /\b(small|medium|large|regular|whole|each|cup|oz)$/.test(match[1])) return null;
  const thing = match[1];
  const plural = /(s|x|z|ch|sh)$/.test(thing) ? `${thing}es` : /[^aeiou]y$/.test(thing) ? `${thing.slice(0, -1)}ies` : `${thing}s`;
  return `${count} ${plural}`;
}

function surveyPortion(portions) {
  const named = portions.filter((portion) => portion.grams > 0 && portion.description && !/quantity not specified|guideline amount/i.test(portion.description));
  if (named.length === 0) return null;
  const usual = portions.find((portion) => /quantity not specified/i.test(portion.description) && portion.grams > 0)?.grams;
  // Weights and fluid ounces are units the review converts anyway; a household
  // measure says more. A pack size or a restaurant's cup says less.
  const odd = /calorie package|school container|single serving|snack size|juice box|pouch|mcdonald|spaghettio|wendy|burger king|starbucks|dunkin|subway|taco bell|kfc|, nfs$/i;
  const weight = /^1 (oz|fl oz|lb|pound|gram)\b/i;
  const household = named.filter((portion) => !weight.test(portion.description) && !odd.test(portion.description));
  const pool = household.length > 0 ? household : named;
  if (usual) {
    const exact = pool.find((portion) => Math.abs(portion.grams - usual) <= usual * 0.02)
      ?? named.find((portion) => Math.abs(portion.grams - usual) <= usual * 0.02 && !odd.test(portion.description));
    if (exact) return { grams: exact.grams, label: surveyLabel(exact) };
    for (const portion of pool) {
      const count = usual / portion.grams;
      if (count >= 1.9 && count <= 4.1 && Math.abs(count - Math.round(count)) <= 0.05) {
        const label = pluralize(surveyLabel(portion), Math.round(count));
        if (label) return { grams: usual, label };
      }
      // Half a cup of berries.
      if (Math.abs(count - 0.5) <= 0.02 && /^1 (cup|tablespoon|teaspoon)\b/.test(portion.description)) {
        return { grams: usual, label: surveyLabel(portion).replace(/^1 /, '1/2 ') };
      }
    }
  }
  if (usual) {
    // A drink: its usual amount in fluid ounces.
    const fluidOunce = named.find((portion) => /^1 fl oz\b/i.test(portion.description));
    const glasses = fluidOunce ? usual / fluidOunce.grams : 0;
    if (glasses >= 1.9 && glasses <= 32.1 && Math.abs(glasses - Math.round(glasses)) <= 0.06) {
      return { grams: usual, label: `${Math.round(glasses)} fl oz` };
    }
    const ounces = usual / 28.35;
    if (ounces >= 1.9 && ounces <= 8.1 && Math.abs(ounces - Math.round(ounces)) <= 0.03) {
      return { grams: usual, label: `${Math.round(ounces)} oz` };
    }
    // No measure is the usual amount: a measure near it, or the amount itself in grams.
    const nearby = pool.filter((portion) => portion.grams >= usual * 0.6 && portion.grams <= usual * 1.7)
      .sort((a, b) => Math.abs(Math.log(a.grams / usual)) - Math.abs(Math.log(b.grams / usual)))[0];
    return nearby ? { grams: nearby.grams, label: surveyLabel(nearby) } : { grams: usual, label: '' };
  }
  const first = pool[0];
  return { grams: first.grams, label: surveyLabel(first) };
}

function referencePortion(portions) {
  // SR Legacy and Foundation: an amount and a modifier ("1.0", "cup, mashed") or a measure unit.
  const usable = portions.filter((portion) => portion.grams > 0);
  if (usable.length === 0) return null;
  const labelOf = (portion) => {
    const amount = portion.amount && portion.amount > 0 ? tidyAmount(portion.amount) : null;
    const unit = portion.modifier || (portion.unit && portion.unit !== 'undetermined' ? portion.unit : '') || portion.description;
    const text = `${amount ?? ''} ${unit}`.replace(/\s*\((.*?)\)/g, '').replace(/\s+/g, ' ').trim();
    return text ? lower(text) : null;
  };
  const labelled = usable.map((portion) => ({ grams: portion.grams, label: labelOf(portion) })).filter((portion) => portion.label);
  if (labelled.length === 0) return null;
  const everyday = labelled.filter((portion) => portion.grams >= 5 && portion.grams <= 400 && !/\b(lb|pound|quart|gallon|package|pkg|container|can|bottle|box|loaf|pie|cake|recipe|yield|unit)\b/.test(portion.label));
  const pool = everyday.length > 0 ? everyday : labelled;
  const whole = pool.find((portion) => /^1 (medium|large|small|whole|fruit|piece|slice|egg|serving|breast|thigh|fillet|patty|link|bar|cookie|cracker|muffin|bagel|tortilla|pancake|waffle|stick|strip|leg|wing|drumstick|sausage|frankfurter|tbsp|tablespoon|cup|oz)\b/.test(portion.label) && /^1 (medium|whole|fruit|egg|breast|thigh|fillet|patty|link|bar|slice|piece|serving)/.test(portion.label));
  return whole ?? pool[0];
}

function portionFor(entry) {
  // The cluster's best-named record first; any member's serving beats "100 g".
  const order = [entry.seed, ...entry.members.filter((member) => member !== entry.seed).sort(seedOrder)];
  for (const record of order) {
    const portion = record.type === 'survey' ? surveyPortion(record.portions) : referencePortion(record.portions);
    if (portion && portion.grams > 0) return { grams: Math.round(portion.grams * 100) / 100, label: portion.label };
    if (portion === null && record.type === 'survey') continue;
  }
  return null;
}

// ---------------------------------------------------------------------------
// A prior for the search
// ---------------------------------------------------------------------------

const RARE_CATEGORY = /American Indian\/Alaska Native|Restaurant Foods|Fast Foods|Lamb, Veal, and Game/;

const PLAIN = new Set(['raw', 'cooked', 'plain', 'fresh', 'whole', 'regular', 'unsweetened', 'skinless', 'boneless']);
/** How people usually cook, so "grilled" comes before "stewed" when nothing else decides. */
const COMMON_WAYS = [[/\b(grilled|baked|roasted|broiled)\b/, 4], [/\b(boiled|fried|scrambled|steamed|rotisserie)\b/, 2]];

function priorFor(entry, name) {
  const { seed, members } = entry;
  let prior = 0;
  if (seed.type === 'survey') prior += 30;
  else if (seed.type === 'foundation') prior += 12;
  // USDA's default record is the everyday food; most of all when it is the
  // default for the food itself ("Potato, NFS", "Egg, whole, cooked, NS as to cooking method").
  const defaults = members.filter((member) => member.isDefault);
  if (defaults.length > 0) prior += 6;
  const headWords = new Set(tokens(identityText(seed.lowered[0])));
  if (defaults.some((member) => member.key.split(' ').every((word) => headWords.has(word) || PLAIN.has(word)))) prior += 16;
  // So is what its recipes are made of.
  const uses = members.reduce((sum, member) => sum + member.uses, 0);
  prior += Math.min(24, Math.round(3 * Math.log2(1 + uses)));
  prior += Math.min(8, Math.round(Math.log2(members.length) * 3));
  const segments = name.split(', ');
  // Each further qualifier is a narrower food; "plain" and "raw" are the opposite.
  const narrowing = segments.slice(1).filter((segment) => !tokens(segment).every((word) => PLAIN.has(word)));
  prior -= Math.max(0, narrowing.length - 1) * 5;
  if (segments.slice(1).some((segment) => /^(plain|raw)$/.test(segment))) prior += 4;
  // A dish of several things, when the plain thing exists too.
  if (segments.slice(1).some((segment) => /^(with|and) /.test(segment))) prior -= 8;
  for (const [way, bonus] of COMMON_WAYS) if (way.test(name.toLowerCase())) { prior += bonus; break; }
  prior -= seed.soft.filter((segment) => name.toLowerCase().includes(segment.text)).length * 4;
  if (RARE_CATEGORY.test(seed.category)) prior -= 12;
  // Clinical cut and grade descriptions.
  if (/separable|trimmed to|choice|select|prime|imported|composite|variety meats|mechanically/i.test(name)) prior -= 14;
  // A brand in capitals in USDA's name: a product, not the generic food.
  if (/\b[A-Z][A-Z'&-]{2,}\b/.test(seed.raw.replace(/\b(USDA|NFS|NS|UHT|BBQ|DHA|ARA)\b/g, ''))) prior -= 10;
  return prior;
}

// ---------------------------------------------------------------------------

const EXCLUDED_CATEGORY = /^(Baby Foods|Baby food: .*|Baby juice|Baby water|Formula, .*|Human milk)$/;

function usable(record) {
  if ([record.kcal, record.protein, record.carbs, record.fat].some((value) => typeof value !== 'number' || !Number.isFinite(value) || value < 0)) return false;
  if (EXCLUDED_CATEGORY.test(record.category)) return false;
  if (/^(babyfood|baby food|infant formula|child formula|toddler formula)\b/i.test(record.raw)) return false;
  // Survey's recipe-building rows, measured in fluid ounces of a drink.
  if (/, as ingredient\b|, for use (on|with|in) /i.test(record.raw)) return false;
  return true;
}

const round1 = (value) => Math.round(value * 10) / 10;

const STAPLES = JSON.parse(readFileSync(new URL('./food-index-staples.json', import.meta.url), 'utf8')).staples;

export function buildIndex(records, staples = STAPLES) {
  const described = records.filter(usable).map((record) => ({ ...record, ...describe(record) })).filter((record) => record.key);
  const clusters = cluster(described);
  const rows = clusters.map((entry) => {
    const name = nameCluster(entry);
    const portion = portionFor(entry);
    // Words of merged records the name does not carry, so "skim" still finds "Milk, fat free".
    const nameTokens = new Set(tokens(name));
    const extra = [...new Set(entry.members.flatMap((member) => member.hard.flatMap((segment) => tokens(segment.text))))]
      .filter((token) => !nameTokens.has(token) && !STOP.has(token) && !/^\d+$/.test(token) && token.length > 1)
      .sort();
    return {
      name,
      kcal: round1(entry.seed.kcal),
      protein: round1(entry.seed.protein),
      carbs: round1(entry.seed.carbs),
      fat: round1(entry.seed.fat),
      grams: portion?.grams ?? 100,
      label: portion?.label ?? '',
      id: entry.seed.id,
      prior: priorFor(entry, name),
      extra: extra.join(' '),
      members: entry.members,
    };
  });
  for (const staple of staples) {
    const row = rows.find((candidate) => candidate.members.some((member) => member.id === staple.id));
    if (!row) throw new Error(`Staple ${staple.id} matches no food`);
    if (staple.name) row.name = staple.name;
    if (staple.grams) row.grams = staple.grams;
    if (staple.label !== undefined) row.label = staple.label;
    if (staple.prior !== undefined) row.prior = staple.prior;
    const nameWords = new Set(tokens(row.name));
    row.extra = [...new Set([...row.extra.split(' '), ...tokens(staple.words ?? '')])].filter((word) => word && !nameWords.has(word)).sort().join(' ');
  }
  // Two rows that read the same help nobody: the better one stays.
  const byName = new Map();
  for (const row of rows.sort((a, b) => b.prior - a.prior || a.id - b.id)) {
    const key = lower(row.name);
    const kept = byName.get(key);
    if (!kept) byName.set(key, row);
    else kept.extra = [...new Set(`${kept.extra} ${row.extra}`.split(' ').filter(Boolean))].sort().join(' ');
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
}

export function serialize(rows) {
  const clean = (text) => String(text).replace(/[\t\n]/g, ' ');
  const lines = rows.map((row) => [clean(row.name), row.kcal, row.protein, row.carbs, row.fat, row.grams, clean(row.label), row.id, row.prior, clean(row.extra)].join('\t'));
  return {
    source: 'USDA FoodData Central: Survey (FNDDS) 2021-2023, Foundation Foods April 2025, SR Legacy 2018. Public domain.',
    columns: 'name\tkcal\tprotein\tcarbs\tfat\tservingGrams\tservingLabel\tfdcId\tprior\tsearchWords (macros are per 100 g)',
    count: rows.length,
    rows: lines.join('\n'),
  };
}

function main() {
  const args = process.argv.slice(2);
  const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
  let dir = option('--dir');
  let temporary = null;
  if (!dir) {
    temporary = mkdtempSync(path.join(tmpdir(), 'usda-'));
    dir = temporary;
    download(dir);
  }
  for (const dataset of DATASETS) {
    if (!existsSync(path.join(dir, dataset.json))) throw new Error(`Missing ${dataset.json} in ${dir}`);
  }
  const records = loadRecords(dir);
  const rows = buildIndex(records);
  writeFileSync(OUTPUT, `${JSON.stringify(serialize(rows), null, 1)}\n`);
  const report = option('--report');
  if (report) {
    writeFileSync(report, rows.map((row) => `${row.name}\t${row.kcal}\t${row.grams} g ${row.label}\tprior ${row.prior}\n${row.members.map((member) => `    ${member.type} ${member.raw} [${Math.round(member.kcal)}]`).join('\n')}`).join('\n'));
  }
  if (temporary) rmSync(temporary, { recursive: true, force: true });
  console.log(`${records.length} USDA records -> ${rows.length} foods (${Math.round(Buffer.byteLength(JSON.stringify(serialize(rows))) / 1024)} KB) in ${path.relative(process.cwd(), OUTPUT)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
