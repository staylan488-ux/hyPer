import { beforeEach, describe, expect, it, vi } from 'vitest';

// Each supabase.from() call starts a chain that records its method calls and,
// when awaited (directly or via single/maybeSingle), resolves to the next
// queued result.
const mocks = vi.hoisted(() => ({
  chains: [] as Array<Array<[string, ...unknown[]]>>,
  results: [] as Array<{ data?: unknown; error?: unknown }>,
}));

vi.mock('@/lib/supabase', () => {
  const from = (table: string) => {
    const calls: Array<[string, ...unknown[]]> = [['from', table]];
    mocks.chains.push(calls);
    const settle = () => Promise.resolve({ data: null, error: null, ...(mocks.results.shift() ?? {}) });
    const chain: Record<string, unknown> = {
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => settle().then(resolve, reject),
    };
    for (const method of ['select', 'insert', 'update', 'delete', 'eq', 'in', 'order', 'limit']) {
      chain[method] = (...args: unknown[]) => { calls.push([method, ...args]); return chain; };
    }
    for (const method of ['single', 'maybeSingle']) {
      chain[method] = (...args: unknown[]) => { calls.push([method, ...args]); return settle(); };
    }
    return chain;
  };
  return { supabase: { from } };
});

import { insertOneServingFood, persistExternalFood } from '@/lib/foodPersistence';
import {
  SAVED_MEAL_FETCH_LIMIT,
  SAVED_MEAL_SOURCES,
  dedupeSavedMealsByName,
  insertSavedMeal,
  listSavedMealRows,
  replaceSavedMeal,
  retireSavedMeal,
} from '@/lib/savedMeals';

const values = { name: 'Oats', calories: 300, protein: 10, carbs: 50, fat: 6 };
const missingServingSize = { message: 'column "serving_size" of relation "foods" does not exist' };

beforeEach(() => {
  mocks.chains.length = 0;
  mocks.results.length = 0;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('saved meal list', () => {
  it('queries the user\'s saved and custom foods newest first with the caller\'s columns', async () => {
    const rows = [{ id: 'a', name: 'Oats' }];
    mocks.results.push({ data: rows });

    const result = await listSavedMealRows('user-a', 'id, name');

    expect(result).toEqual({ data: rows, error: null });
    expect(mocks.chains).toEqual([[
      ['from', 'foods'],
      ['select', 'id, name'],
      ['eq', 'user_id', 'user-a'],
      ['in', 'source', ['saved_meal', 'custom']],
      ['order', 'created_at', { ascending: false }],
      ['limit', 150],
    ]]);
    expect(SAVED_MEAL_SOURCES).toEqual(['saved_meal', 'custom']);
    // one limit for the logger and Settings, so both list the same meals
    expect(SAVED_MEAL_FETCH_LIMIT).toBe(150);
  });

  it('passes a query error through', async () => {
    const error = { message: 'offline' };
    mocks.results.push({ error });
    expect(await listSavedMealRows('user-a', 'id')).toEqual({ data: null, error });
  });

  it('keeps the newest row per normalized name and skips empty names', () => {
    const rows = [
      { id: 'new', name: '  Protein   Shake ' },
      { id: 'blank', name: '   ' },
      { id: 'none', name: null },
      { id: 'old', name: 'protein shake' },
      { id: 'oats', name: 'Oats' },
    ];
    expect(dedupeSavedMealsByName(rows, (row) => row.id)).toEqual(['new', 'oats']);
    expect(dedupeSavedMealsByName(null, (row: { name: string }) => row)).toEqual([]);
  });
});

describe('saved meal writes', () => {
  it('inserts a saved meal as one serving', async () => {
    mocks.results.push({ data: { id: 'meal-1' } });

    expect(await insertSavedMeal('user-a', values)).toEqual({ id: 'meal-1', error: null });
    expect(mocks.chains).toEqual([[
      ['from', 'foods'],
      ['insert', { user_id: 'user-a', ...values, source: 'saved_meal', serving_size: 1, serving_unit: 'serving' }],
      ['select', 'id'],
      ['single'],
    ]]);
  });

  it('retries once without serving columns only when the database lacks them', async () => {
    mocks.results.push({ error: missingServingSize }, { data: { id: 'meal-2' } });

    expect(await insertOneServingFood('user-a', values, 'manual_entry')).toEqual({ id: 'meal-2', error: null });
    expect(mocks.chains).toHaveLength(2);
    expect(mocks.chains[1][1]).toEqual(['insert', { user_id: 'user-a', ...values, source: 'manual_entry' }]);
  });

  it('does not retry other insert errors and returns them', async () => {
    const error = { message: 'permission denied' };
    mocks.results.push({ error });

    expect(await insertSavedMeal('user-a', values)).toEqual({ id: null, error });
    expect(mocks.chains).toHaveLength(1);
  });

  it('retires a saved meal to manual_entry for that user and never deletes it', async () => {
    expect(await retireSavedMeal('user-a', 'meal-1')).toEqual({ error: null });
    expect(mocks.chains).toEqual([[
      ['from', 'foods'],
      // a deleted product no longer answers a scan of its barcode
      ['update', { source: 'manual_entry', external_source: null, external_id: null }],
      ['eq', 'id', 'meal-1'],
      ['eq', 'user_id', 'user-a'],
      ['in', 'source', ['saved_meal', 'custom']],
    ]]);
  });

  it('returns a retire error', async () => {
    const error = { message: 'offline' };
    mocks.results.push({ error });
    expect(await retireSavedMeal('user-a', 'meal-1')).toEqual({ error });
  });
});

describe('replacing a saved meal', () => {
  const read = [
    ['from', 'foods'],
    ['select', 'serving_size, serving_unit, external_source, external_id'],
    ['eq', 'id', 'old'],
    ['eq', 'user_id', 'user-a'],
    ['maybeSingle'],
  ];
  const retire = [
    ['from', 'foods'],
    ['update', { source: 'manual_entry', external_source: null, external_id: null }],
    ['eq', 'id', 'old'],
    ['eq', 'user_id', 'user-a'],
    ['in', 'source', ['saved_meal', 'custom']],
  ];

  it('keeps the serving basis of the meal it replaces', async () => {
    mocks.results.push({ data: { serving_size: 250, serving_unit: 'g', external_source: null, external_id: null } }, { data: { id: 'new' } });

    expect(await replaceSavedMeal('user-a', 'old', values)).toEqual({ id: 'new', retireFailed: false });
    expect(mocks.chains).toEqual([
      read,
      [['from', 'foods'], ['insert', { user_id: 'user-a', ...values, source: 'saved_meal', serving_size: 250, serving_unit: 'g' }], ['select', 'id'], ['single']],
      retire,
    ]);
  });

  it('moves a barcode to the new meal, so a scan logs the edited numbers', async () => {
    mocks.results.push(
      { data: { serving_size: '6.00', serving_unit: 'piece', external_source: 'barcode', external_id: '0123456789012' } },
      {},
      { data: { id: 'new' } },
    );

    expect(await replaceSavedMeal('user-a', 'old', values)).toEqual({ id: 'new', retireFailed: false });
    expect(mocks.chains).toEqual([
      read,
      // one row per barcode: the old row lets go of it before the new one takes it
      [['from', 'foods'], ['update', { external_source: null, external_id: null }], ['eq', 'id', 'old'], ['eq', 'user_id', 'user-a']],
      [
        ['from', 'foods'],
        ['insert', { user_id: 'user-a', ...values, source: 'saved_meal', external_source: 'barcode', external_id: '0123456789012', serving_size: 6, serving_unit: 'piece' }],
        ['select', 'id'],
        ['single'],
      ],
      retire,
    ]);
  });

  it('gives the barcode back to the old meal when the new one cannot be saved', async () => {
    mocks.results.push(
      { data: { serving_size: 1, serving_unit: 'serving', external_source: 'barcode', external_id: '0123456789012' } },
      {},
      { error: { message: 'offline' } },
    );

    expect(await replaceSavedMeal('user-a', 'old', values)).toEqual({ id: null, retireFailed: false });
    expect(mocks.chains).toHaveLength(4);
    expect(mocks.chains[3]).toEqual([
      ['from', 'foods'],
      ['update', { external_source: 'barcode', external_id: '0123456789012' }],
      ['eq', 'id', 'old'],
      ['eq', 'user_id', 'user-a'],
    ]);
  });

  it('hands back a barcode it could not give back, and the retry saves it on the new meal', async () => {
    const barcode = { external_source: 'barcode', external_id: '0123456789012' };
    mocks.results.push(
      { data: { serving_size: 1, serving_unit: 'serving', ...barcode } },
      {},
      { error: { message: 'offline' } },
      { error: { message: 'offline' } },
    );
    expect(await replaceSavedMeal('user-a', 'old', values)).toEqual({ id: null, retireFailed: false, barcode });

    // The old row no longer has it, so the retry takes the one handed back.
    mocks.chains.length = 0;
    mocks.results.push({ data: { serving_size: 1, serving_unit: 'serving', external_source: null, external_id: null } }, { data: { id: 'new' } });
    expect(await replaceSavedMeal('user-a', 'old', values, { barcode })).toEqual({ id: 'new', retireFailed: false });
    expect(mocks.chains).toEqual([
      read,
      [['from', 'foods'], ['insert', { user_id: 'user-a', ...values, source: 'saved_meal', ...barcode, serving_size: 1, serving_unit: 'serving' }], ['select', 'id'], ['single']],
      retire,
    ]);
  });

  it('keeps handing back that barcode while a retry fails, and gives it to the old meal when it can', async () => {
    const barcode = { external_source: 'barcode', external_id: '0123456789012' };
    const empty = { data: { serving_size: 1, serving_unit: 'serving', external_source: null, external_id: null } };
    mocks.results.push({ error: { message: 'offline' } });
    expect(await replaceSavedMeal('user-a', 'old', values, { barcode })).toEqual({ id: null, retireFailed: false, barcode });

    mocks.chains.length = 0;
    mocks.results.push(empty, { error: { message: 'offline' } }, {});
    expect(await replaceSavedMeal('user-a', 'old', values, { barcode })).toEqual({ id: null, retireFailed: false });
    expect(mocks.chains[2]).toEqual([['from', 'foods'], ['update', barcode], ['eq', 'id', 'old'], ['eq', 'user_id', 'user-a']]);

    // A clash means another row holds the barcode, so it is not lost and not handed back.
    mocks.chains.length = 0;
    mocks.results.push(empty, { error: { code: '23505' } }, { error: { code: '23505' } });
    expect(await replaceSavedMeal('user-a', 'old', values, { barcode })).toEqual({ id: null, retireFailed: false });
  });

  it('changes nothing when the old meal cannot be read or let go of its barcode', async () => {
    mocks.results.push({ error: { message: 'offline' } });
    expect(await replaceSavedMeal('user-a', 'old', values)).toEqual({ id: null, retireFailed: false });
    expect(mocks.chains).toHaveLength(1);

    mocks.chains.length = 0;
    mocks.results.push({ data: { serving_size: 1, serving_unit: 'serving', external_source: 'barcode', external_id: '0123' } }, { error: { message: 'offline' } });
    expect(await replaceSavedMeal('user-a', 'old', values)).toEqual({ id: null, retireFailed: false });
    expect(mocks.chains).toHaveLength(2);
  });

  it('still saves as one serving when the old row is gone', async () => {
    mocks.results.push({ data: null }, { data: { id: 'new' } });
    expect(await replaceSavedMeal('user-a', 'old', values)).toEqual({ id: 'new', retireFailed: false });
    expect(mocks.chains[1][1]).toEqual(['insert', { user_id: 'user-a', ...values, source: 'saved_meal', serving_size: 1, serving_unit: 'serving' }]);
  });
});

describe('barcode provider foods', () => {
  const food = {
    name: 'Bar', calories: 200, protein: 20, carbs: 22, fat: 7,
    serving_size: 0, serving_unit: '', external_id: '0123456789',
  };

  it.each(['open_food_facts', 'fatsecret'] as const)('reuses the existing %s row', async (source) => {
    mocks.results.push({ data: { id: 'existing' } });

    expect(await persistExternalFood(food, 'user-a', source)).toBe('existing');
    expect(mocks.chains).toEqual([[
      ['from', 'foods'],
      ['select', 'id'],
      ['eq', 'user_id', 'user-a'],
      ['eq', 'external_source', source],
      ['eq', 'external_id', '0123456789'],
      ['limit', 1],
      ['maybeSingle'],
    ]]);
  });

  it.each(['open_food_facts', 'fatsecret'] as const)('creates a %s row on a miss', async (source) => {
    mocks.results.push({ data: null }, { data: { id: 'created' } });

    expect(await persistExternalFood(food, 'user-a', source)).toBe('created');
    expect(mocks.chains[1]).toEqual([
      ['from', 'foods'],
      ['insert', {
        user_id: 'user-a', name: 'Bar', calories: 200, protein: 20, carbs: 22, fat: 7,
        serving_size: 1, serving_unit: 'serving',
        source, fdc_id: null, external_source: source, external_id: '0123456789',
      }],
      ['select', 'id'],
      ['single'],
    ]);
  });

  it('still inserts after a failed lookup, and returns null when the insert fails', async () => {
    mocks.results.push({ error: { message: 'lookup failed' } }, { error: { message: 'insert failed' } });

    expect(await persistExternalFood({ ...food, serving_size: 45, serving_unit: 'g' }, 'user-a', 'fatsecret')).toBeNull();
    expect(mocks.chains).toHaveLength(2);
    expect(mocks.chains[1][1][1]).toMatchObject({ serving_size: 45, serving_unit: 'g' });
    expect(console.error).toHaveBeenCalledWith('Error looking up FatSecret food:', { message: 'lookup failed' });
    expect(console.error).toHaveBeenCalledWith('Error creating FatSecret food:', { message: 'insert failed' });
  });
});
