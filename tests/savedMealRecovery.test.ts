import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown> & { id: string };
const db = vi.hoisted(() => ({ rows: [] as Row[], loseInsertResponse: false, failRead: false, releaseResponseLost: false }));
vi.mock('@/lib/sessionUser', () => ({ getSessionUserId: async () => 'user-a' }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: () => {
  let operation = 'read';
  let payload: Record<string, unknown> = {};
  const filters: ((row: Row) => boolean)[] = [];
  const run = async () => {
    const selected = db.rows.filter((row) => filters.every((filter) => filter(row)));
    if (operation === 'read') {
      if (db.failRead) return { data: null, error: { message: 'offline' } };
      return { data: selected, error: null };
    }
    const targets = operation === 'insert' ? [{ id: `new-${db.rows.length}`, ...payload } as Row] : selected.map((row) => ({ ...row, ...payload }));
    if (targets.some((target) => target.external_id && target.external_source && db.rows.some((row) => row.id !== target.id && row.user_id === target.user_id && row.external_id === target.external_id && row.external_source === target.external_source))) {
      return { data: null, error: { code: '23505' } };
    }
    if (operation === 'insert') db.rows.push(...targets);
    else targets.forEach((target) => Object.assign(db.rows.find((row) => row.id === target.id)!, target));
    if (operation === 'insert' && db.loseInsertResponse) {
      db.loseInsertResponse = false;
      return { data: null, error: { message: 'response lost' } };
    }
    if (operation === 'update' && payload.external_id === null && db.releaseResponseLost) {
      db.releaseResponseLost = false;
      return { data: null, error: { message: 'response lost' } };
    }
    return { data: targets, error: null };
  };
  const chain = {
    select: () => chain,
    insert: (value: Record<string, unknown>) => { operation = 'insert'; payload = value; return chain; },
    update: (value: Record<string, unknown>) => { operation = 'update'; payload = value; return chain; },
    eq: (key: string, value: unknown) => { filters.push((row) => row[key] === value); return chain; },
    in: (key: string, values: unknown[]) => { filters.push((row) => values.includes(row[key])); return chain; },
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => { const result = await run(); return { ...result, data: result.data?.[0] ?? null }; },
    single: async () => chain.maybeSingle(),
    then: (resolve: (value: unknown) => unknown) => run().then(resolve),
  };
  return chain;
} } }));

const values = (calories: number) => ({ name: 'Oats', calories, protein: 10, carbs: 20, fat: 3 });
const barcode = '0123456789012';
beforeEach(() => {
  const stored = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => { stored.set(key, value); },
    removeItem: (key: string) => { stored.delete(key); },
  });
  vi.resetModules();
  db.rows = [{ id: 'old', user_id: 'user-a', ...values(100), source: 'saved_meal', serving_size: 250, serving_unit: 'g', external_source: 'barcode', external_id: barcode }];
  db.loseInsertResponse = false;
  db.failRead = false;
  db.releaseResponseLost = false;
});

describe('saved-meal barcode recovery through the real insert and scan paths', () => {
  it.each([{ restart: false, calories: 300 }, { restart: true, calories: 300 }, { restart: true, calories: 200 }])('retries a committed insert with a lost answer ($restart restart, $calories calories)', async ({ restart, calories }) => {
    let { replaceSavedMeal } = await import('@/lib/savedMeals');
    db.loseInsertResponse = true;
    expect((await replaceSavedMeal('user-a', 'old', values(200))).id).toBeNull();
    expect(db.rows.find((row) => row.external_id === barcode)?.calories).toBe(200);
    if (restart) {
      vi.resetModules();
      ({ replaceSavedMeal } = await import('@/lib/savedMeals'));
    }
    const result = await replaceSavedMeal('user-a', 'old', values(calories));
    expect(result.id).not.toBeNull();
    const { findSavedFoodByBarcode } = await import('@/lib/savedBarcodeFoods');
    expect(await findSavedFoodByBarcode(barcode)).toMatchObject({ id: result.id, calories, serving_size: 250, serving_unit: 'g' });
    // Existing logs can still reference both immutable nutrition snapshots.
    expect(db.rows.find((row) => row.id === 'old')).toMatchObject({ calories: 100, source: 'manual_entry' });
    expect(db.rows.find((row) => row.calories === 200)).toMatchObject({ calories: 200, source: 'manual_entry', external_id: null });
    expect(db.rows.filter((row) => row.source === 'saved_meal')).toHaveLength(1);
    const laterEdit = await replaceSavedMeal('user-a', result.id!, values(400));
    expect(await findSavedFoodByBarcode(barcode)).toMatchObject({ id: laterEdit.id, calories: 400 });
  });

  it('leaves the food untouched if durable recovery cannot be stored', async () => {
    const original = structuredClone(db.rows);
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('disk full'); });
    const { replaceSavedMeal } = await import('@/lib/savedMeals');
    expect((await replaceSavedMeal('user-a', 'old', values(200))).id).toBeNull();
    expect(db.rows).toEqual(original);
  });

  it('keeps recovery through an offline retry', async () => {
    const { replaceSavedMeal } = await import('@/lib/savedMeals');
    db.loseInsertResponse = true;
    await replaceSavedMeal('user-a', 'old', values(200));
    db.failRead = true;
    expect((await replaceSavedMeal('user-a', 'old', values(300))).id).toBeNull();
    db.failRead = false;
    const result = await replaceSavedMeal('user-a', 'old', values(300));
    const { findSavedFoodByBarcode } = await import('@/lib/savedBarcodeFoods');
    expect(await findSavedFoodByBarcode(barcode)).toMatchObject({ id: result.id, calories: 300 });
  });

  it('recovers a released barcode after relaunch, even if no replacement was inserted', async () => {
    const first = await import('@/lib/savedMeals');
    db.releaseResponseLost = true;
    expect((await first.replaceSavedMeal('user-a', 'old', values(200))).id).toBeNull();
    vi.resetModules();
    const second = await import('@/lib/savedMeals');
    const result = await second.replaceSavedMeal('user-a', 'old', values(300));
    const { findSavedFoodByBarcode } = await import('@/lib/savedBarcodeFoods');
    expect(await findSavedFoodByBarcode(barcode)).toMatchObject({ id: result.id, calories: 300 });
  });
});
