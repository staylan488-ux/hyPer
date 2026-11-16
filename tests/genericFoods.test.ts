import { describe, expect, it } from 'vitest';

import index from '@/lib/genericFoodIndex.json';
import { foodWords, genericFoods, genericFoodToFood, rankGenericFoods, searchGenericFoods, stemFoodWord } from '@/lib/genericFoods';
import { buildIndex, serialize, stem } from '../scripts/build-food-index.mjs';

// Log food's search runs over the app's own list of USDA's generic foods
// (scripts/build-food-index.mjs writes it). USDA's live search answered
// "banana" with ten of its 100+ matches in its own order, and "egg" with Egg
// Benedict ahead of an egg. These cases hold the order a person expects.

const names = (query: string, limit = 8) => rankGenericFoods(query, limit).map((food) => food.name);
const first = (query: string) => rankGenericFoods(query, 1)[0];

describe('the food list', () => {
  const foods = genericFoods();

  it('reads every row the build wrote', () => {
    expect(foods.length).toBe(index.count);
    expect(foods.length).toBeGreaterThan(9000);
  });

  it('holds each food once, by name and by USDA id', () => {
    expect(new Set(foods.map((food) => food.name.toLowerCase())).size).toBe(foods.length);
    expect(new Set(foods.map((food) => food.fdcId)).size).toBe(foods.length);
  });

  it('gives every food usable numbers and a serving', () => {
    for (const food of foods) {
      for (const value of [food.kcal, food.protein, food.carbs, food.fat]) {
        expect(Number.isFinite(value) && value >= 0, food.name).toBe(true);
      }
      // nothing is denser than pure fat
      expect(food.kcal, food.name).toBeLessThanOrEqual(905);
      expect(food.servingGrams, food.name).toBeGreaterThan(0);
      expect(food.fdcId).toMatch(/^\d+$/);
    }
  });

  it("carries none of USDA's filing words in a name", () => {
    const filed = foods.filter((food) => /\bNFS\b|\bNS as to\b|not further specified/i.test(food.name));
    expect(filed.map((food) => food.name)).toEqual([]);
  });

  it('is plain text a phone keyboard can match', () => {
    expect(foods.filter((food) => /[^\x20-\x7e]/.test(food.name + food.servingLabel)).map((food) => food.name)).toEqual([]);
  });

  it('splits words the way the build did', () => {
    for (const food of foods.slice(0, 2000)) {
      for (const word of food.name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)) {
        expect(stemFoodWord(word), word).toBe(stem(word));
      }
    }
  });
});

describe('searching the food list', () => {
  it('puts the plain food first', () => {
    const expected: Record<string, string> = {
      banana: 'Banana, raw',
      egg: 'Egg, whole, raw',
      rice: 'Rice, white, cooked',
      milk: 'Milk',
      oats: 'Oats, dry',
      'chicken breast': 'Chicken breast, cooked, skinless',
      'ground beef': 'Ground beef, raw',
      'greek yogurt': 'Yogurt, Greek, nonfat, plain',
      'peanut butter': 'Peanut butter',
      'olive oil': 'Olive oil',
      'protein powder': 'Protein powder',
      'cottage cheese': 'Cottage cheese',
      'sweet potato': 'Sweet potato',
      'whole milk': 'Milk, whole',
      bread: 'Bread, white',
      pasta: 'Pasta, cooked',
      apple: 'Apple, raw',
      avocado: 'Avocado, raw',
      almonds: 'Almonds',
      salmon: 'Salmon, raw',
      mozzarella: 'Cheese, Mozzarella, part skim',
      'french fries': 'Potato, french fries',
    };
    const found = Object.fromEntries(Object.keys(expected).map((query) => [query, first(query)?.name]));
    expect(found).toEqual(expected);
  });

  it('lists one banana, not twenty: every row is a different food', () => {
    const bananas = rankGenericFoods('banana', 8);
    expect(bananas[0]).toMatchObject({ name: 'Banana, raw', servingGrams: 126, servingLabel: '1 banana' });
    expect(bananas.filter((food) => /^bananas?, raw$/i.test(food.name))).toHaveLength(1);
    expect(new Set(bananas.map((food) => food.name)).size).toBe(bananas.length);
  });

  it('keeps the everyday choices together at the top', () => {
    expect(names('egg', 4)).toEqual(['Egg, whole, raw', 'Egg, whole, cooked', 'Egg, whole, fried', 'Egg, whole, baked']);
    expect(names('milk', 6)).toEqual(expect.arrayContaining(['Milk', 'Milk, whole', 'Milk, fat free (skim)', 'Milk, reduced fat (2%)', 'Milk, low fat (1%)']));
    expect(names('rice', 5)).toEqual(expect.arrayContaining(['Rice, white, cooked', 'Rice, brown, cooked', 'Rice, white, dry']));
    expect(names('chicken breast', 3)).toContain('Chicken breast, raw, skinless');
    expect(names('ground beef', 8)).toEqual(expect.arrayContaining(['Ground beef, 80% lean, raw', 'Ground beef, 93% lean, raw']));
  });

  it('says whether meat is raw or cooked, since the numbers differ', () => {
    for (const food of rankGenericFoods('chicken breast', 8)) {
      expect(food.name, food.name).toMatch(/raw|cooked|grilled|stewed|fried|baked|roasted|rotisserie|sauteed|broiled/);
    }
  });

  it('does not take the start of a longer word for the word', () => {
    const eggs = names('egg', 8);
    expect(eggs.some((name) => /eggplant|eggnog/i.test(name))).toBe(false);
  });

  it('answers while a word is still being typed', () => {
    expect(first('ban').name).toBe('Banana, raw');
    expect(first('chicken br').name).toBe('Chicken breast, cooked, skinless');
    expect(names('chick', 3)).toContain('Chicken');
  });

  it('reads plurals, any word order and other names for a food', () => {
    expect(first('bananas').name).toBe('Banana, raw');
    expect(first('eggs').name).toBe('Egg, whole, raw');
    expect(first('yogurt greek').name).toBe(first('greek yogurt').name);
    expect(first('yoghurt').name).toBe('Yogurt, plain');
    expect(first('skim milk').name).toBe('Milk, fat free (skim)');
    expect(first('coke').name).toBe('Soft drink, cola');
    expect(first('diet coke').name).toBe('Soft drink, diet cola');
    expect(first('tofu').name).toMatch(/^Tofu/);
  });

  it('gives servings a person would say', () => {
    expect(first('egg')).toMatchObject({ servingLabel: '1 egg', servingGrams: 50 });
    expect(first('milk')).toMatchObject({ servingLabel: '1 cup', servingGrams: 244 });
    expect(first('peanut butter')).toMatchObject({ servingLabel: '2 tablespoons', servingGrams: 32 });
    expect(first('oats')).toMatchObject({ servingLabel: '1/2 cup', servingGrams: 40 });
    expect(first('olive oil')).toMatchObject({ servingLabel: '1 tablespoon', servingGrams: 14 });
    expect(rankGenericFoods('chicken breast', 3).find((food) => food.name === 'Chicken breast, raw, skinless')).toMatchObject({ servingLabel: '4 oz', servingGrams: 113 });
  });

  it('finds nothing for words no food has, and waits for two letters', () => {
    expect(searchGenericFoods('xyzzy')).toEqual([]);
    expect(searchGenericFoods('b')).toEqual([]);
    expect(searchGenericFoods('  ')).toEqual([]);
    expect(searchGenericFoods('chicken').length).toBe(25);
    expect(searchGenericFoods('chicken', 8).length).toBe(8);
  });

  it('is quick enough to run on every letter', () => {
    genericFoods();
    const started = performance.now();
    for (const query of ['ch', 'chi', 'chic', 'chick', 'chicke', 'chicken', 'chicken b', 'chicken breast']) rankGenericFoods(query);
    // a few milliseconds each here; the limit only catches a search that has become slow
    expect(performance.now() - started).toBeLessThan(1500);
  });
});

describe('a listed food, as Log food saves it', () => {
  it("is one serving of a USDA food, in the serving's grams", () => {
    const banana = genericFoodToFood(first('banana'));
    expect(banana).toMatchObject({
      name: 'Banana, raw', source: 'usda', user_id: null, serving_size: 126, serving_unit: 'g', serving_label: '1 banana',
    });
    expect(banana.fdc_id).toBe(first('banana').fdcId);
    expect(banana.id).toBe(banana.fdc_id);
    // 126 g of a food that is 97 kcal and 0.7 g protein per 100 g
    expect(banana.calories).toBeCloseTo(first('banana').kcal * 1.26, 1);
    expect(banana.protein).toBeCloseTo(first('banana').protein * 1.26, 1);
  });

  it('names no serving when the amount is only grams', () => {
    const plain = genericFoods().find((food) => food.servingLabel === '')!;
    expect(plain).toBeDefined();
    expect(genericFoodToFood(plain)).not.toHaveProperty('serving_label');
  });
});

describe('building the food list', () => {
  const record = (id: number, type: 'survey' | 'sr' | 'foundation', raw: string, macros: [number, number, number, number], portions: [string, number][] = []) => ({
    id, type, code: String(id), raw, category: '', uses: 0,
    kcal: macros[0], protein: macros[1], carbs: macros[2], fat: macros[3],
    portions: portions.map(([description, grams], sequence) => ({ grams, amount: 1, modifier: '', description, unit: '', abbreviation: '', sequence })),
  });
  const build = (records: ReturnType<typeof record>[]) => buildIndex(records, []) as { name: string; grams: number; label: string; id: number; kcal: number; members: unknown[] }[];

  it('folds the same food from two USDA datasets into one row', () => {
    const rows = build([
      record(1, 'survey', 'Banana, raw', [97, 0.7, 23, 0.3], [['Quantity not specified', 126], ['1 banana', 126]]),
      record(2, 'sr', 'Bananas, raw', [89, 1.1, 22.8, 0.3]),
      record(3, 'foundation', 'Bananas, ripe and slightly ripe, raw', [98, 0.7, 23, 0.3]),
    ]);
    expect(rows.find((row) => row.name === 'Banana, raw')).toMatchObject({ grams: 126, label: '1 banana', id: 1 });
    expect(rows.filter((row) => /^bananas?, raw$/i.test(row.name))).toHaveLength(1);
  });

  it('keeps foods apart when their numbers differ', () => {
    const rows = build([
      record(1, 'survey', 'Banana, raw', [97, 0.7, 23, 0.3]),
      record(2, 'sr', 'Bananas, dehydrated, or banana powder', [346, 3.9, 88, 1.8]),
      record(3, 'survey', 'Banana, fried', [190, 1, 30, 8]),
    ]);
    expect(rows).toHaveLength(3);
  });

  it("drops USDA's filing words and says cooked when the way is not given", () => {
    const rows = build([
      record(1, 'survey', 'Chicken breast, NS as to cooking method, skin not eaten', [144, 28, 0, 3]),
      record(2, 'survey', 'Potato, NFS', [126, 2, 20, 4]),
    ]);
    expect(rows.map((row) => row.name).sort()).toEqual(['Chicken breast, cooked, skinless', 'Potato']);
  });

  it('leaves out baby food and ingredient-only records', () => {
    const rows = build([
      record(1, 'survey', 'Banana, raw', [97, 0.7, 23, 0.3]),
      record(2, 'survey', 'Baby food, banana', [91, 1, 21, 0.2]),
      record(3, 'survey', 'Infant formula, NFS', [63, 1.4, 7, 3.4]),
    ]);
    expect(rows.map((row) => row.name)).toEqual(['Banana, raw']);
  });

  it('writes one line a food, with tabs between the fields', () => {
    const written = serialize(build([record(1, 'survey', 'Banana, raw', [97, 0.7, 23, 0.3], [['Quantity not specified', 126], ['1 banana', 126]])]));
    expect(written.count).toBe(1);
    expect(written.rows.split('\t').slice(0, 8)).toEqual(['Banana, raw', '97', '0.7', '23', '0.3', '126', '1 banana', '1']);
  });

  it('shares its word splitting with the search', () => {
    expect(foodWords('Bananas, overripe, raw')).toEqual(['banana', 'overripe', 'raw']);
    for (const word of ['bananas', 'berries', 'tomatoes', 'peaches', 'swiss', 'oats', 'chips', 'eggs', 'fries']) {
      expect(stemFoodWord(word), word).toBe(stem(word));
    }
  });
});
