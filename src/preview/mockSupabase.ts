// DEV-ONLY in-memory Supabase stand-in. Serves the canned previewTables rows
// through a chainable query builder that honours the common filters (eq/in/
// gte/lte/order/limit/single/count). Mutations PERSIST into previewTables for
// the lifetime of the tab so preview flows (add -> navigate -> re-fetch) behave
// like the real database; a full page reload re-seeds from scratch.
import type { SupabaseClient } from '@supabase/supabase-js';
import { previewTables, PREVIEW_USER_ID } from './previewData';

const PREVIEW_USER = {
  id: PREVIEW_USER_ID,
  email: 'preview@hyper.app',
  user_metadata: { full_name: 'Sam Rivera' },
  app_metadata: {},
  aud: 'authenticated',
  created_at: new Date(0).toISOString(),
};

type Row = Record<string, unknown>;
type Predicate = (r: Row) => boolean;

const PREVIEW_USDA_FOODS = [
  {
    fdcId: 171077,
    description: 'Chicken Breast, grilled',
    servingSize: 100,
    servingSizeUnit: 'g',
    foodNutrients: [
      { nutrientName: 'Energy', value: 165 },
      { nutrientName: 'Protein', value: 31 },
      { nutrientName: 'Carbohydrate, by difference', value: 0 },
      { nutrientName: 'Total lipid (fat)', value: 3.6 },
    ],
  },
  {
    fdcId: 168878,
    description: 'White Rice, cooked',
    servingSize: 100,
    servingSizeUnit: 'g',
    foodNutrients: [
      { nutrientName: 'Energy', value: 130 },
      { nutrientName: 'Protein', value: 2.7 },
      { nutrientName: 'Carbohydrate, by difference', value: 28.2 },
      { nutrientName: 'Total lipid (fat)', value: 0.3 },
    ],
  },
  {
    fdcId: 748608,
    description: 'Olive Oil',
    servingSize: 100,
    servingSizeUnit: 'g',
    foodNutrients: [
      { nutrientName: 'Energy', value: 884 },
      { nutrientName: 'Protein', value: 0 },
      { nutrientName: 'Carbohydrate, by difference', value: 0 },
      { nutrientName: 'Total lipid (fat)', value: 100 },
    ],
  },
] as const;

function mockFoodLookup(body: Record<string, unknown> | undefined): unknown {
  if (body?.action === 'detail') {
    return PREVIEW_USDA_FOODS.find((food) => String(food.fdcId) === String(body.fdcId)) ?? null;
  }

  if (body?.action === 'barcode') return { foods: [] };
  if (body?.action === 'open-food-facts-barcode') {
    return {
      code: String(body.barcode || '0041570054161'),
      status: 1,
      product: {
        product_name: 'Preview protein bar',
        brands: 'Hyper Test Kitchen',
        serving_size: '1 bar (55 g)',
        serving_quantity: 55,
        nutriments: {
          'energy-kcal_serving': 210,
          proteins_serving: 20,
          carbohydrates_serving: 23,
          fat_serving: 6,
        },
      },
    };
  }

  const query = String(body?.query ?? '').toLowerCase();
  const terms = query.split(/\s+/).filter((term) => term.length > 2);
  const foods = PREVIEW_USDA_FOODS.filter((food) => {
    const name = food.description.toLowerCase();
    return terms.some((term) => name.includes(term));
  });
  return { foods };
}

let mockIdCounter = 0;

function stampRow(row: Row): Row {
  const now = new Date().toISOString();
  return { id: `mock-${Date.now()}-${++mockIdCounter}`, created_at: now, updated_at: now, ...row };
}

type MockResult = { data: unknown; error: { message: string; code: string } | null; count: number; status?: number };
type MockScenario = { remainingSetFailures: number; delayMs: number };

// Only the relationships queried by the app are simulated. Resolve them fresh
// from flat rows on every read so editing a program or old set never returns
// stale embedded fixture data. This is not a general PostgREST emulator.
const relationships: Record<string, Record<string, [string, string, boolean]>> = {
  splits: { split_days: ['id', 'split_id', true] },
  split_days: { split_exercises: ['id', 'split_day_id', true] },
  split_exercises: { exercises: ['exercise_id', 'id', false] },
  workouts: { sets: ['id', 'workout_id', true], split_days: ['split_day_id', 'id', false] },
  sets: { exercises: ['exercise_id', 'id', false] },
  nutrition_logs: { foods: ['food_id', 'id', false] },
};

function selectionParts(selection: string): string[] {
  let depth = 0;
  let start = 0;
  const parts: string[] = [];
  for (let i = 0; i < selection.length; i++) {
    if (selection[i] === '(') depth++;
    else if (selection[i] === ')') depth--;
    else if (selection[i] === ',' && depth === 0) { parts.push(selection.slice(start, i)); start = i + 1; }
  }
  parts.push(selection.slice(start));
  return parts;
}

function hydrate(table: string, row: Row, selection: string): Row {
  const result = structuredClone(row);
  for (const part of selectionParts(selection)) {
    const match = part.trim().match(/^(?:(\w+):)?(\w+)(?:![\w]+)?\s*\(([\s\S]*)\)$/);
    if (!match) continue;
    const [, alias, relatedTable, nestedSelection] = match;
    const relation = relationships[table]?.[relatedTable];
    if (!relation) continue;
    const [localColumn, foreignColumn, many] = relation;
    const matches = (previewTables[relatedTable] ?? []).filter((candidate) => candidate[foreignColumn] === row[localColumn]);
    const values = matches.map((candidate) => hydrate(relatedTable, candidate, nestedSelection));
    result[alias || relatedTable] = many ? values : values[0] ?? null;
  }
  return result;
}

function cascadeDelete(table: string, deleted: Set<Row>) {
  const ids = new Set([...deleted].map((row) => row.id));
  const removeRelated = (child: string, column: string) => {
    const rows = previewTables[child] ?? [];
    const removed = new Set(rows.filter((row) => ids.has(row[column])));
    cascadeDelete(child, removed);
    for (let i = rows.length - 1; i >= 0; i--) if (removed.has(rows[i])) rows.splice(i, 1);
  };
  if (table === 'splits') { removeRelated('split_days', 'split_id'); removeRelated('plan_schedules', 'split_id'); }
  if (table === 'split_days') {
    removeRelated('split_exercises', 'split_day_id');
    for (const workout of previewTables.workouts) if (ids.has(workout.split_day_id)) workout.split_day_id = null;
  }
  if (table === 'workouts') { removeRelated('sets', 'workout_id'); removeRelated('workout_day_plans', 'workout_id'); }
}

class MockBuilder implements PromiseLike<MockResult> {
  // live reference into previewTables so mutations persist across builders
  private live: Row[];
  private filters: Predicate[] = [];
  private orderSpecs: { col: string; asc: boolean }[] = [];
  private selection = '*';
  private limitN: number | null = null;
  private rangeSpec: [number, number] | null = null;
  private wantSingle = false;
  private headOnly = false;
  private insertVals: Row[] | null = null;
  private upsertVals: Row[] | null = null;
  private onConflictCols: string[] = ['id'];
  private updateVals: Row | null = null;
  private del = false;

  private table: string;
  private scenario: MockScenario;

  constructor(table: string, scenario: MockScenario) {
    this.table = table;
    this.scenario = scenario;
    if (!previewTables[table]) previewTables[table] = [];
    this.live = previewTables[table];
  }

  select(cols?: string, opts?: { head?: boolean; count?: string }) {
    if (cols) this.selection = cols;
    if (opts?.head) this.headOnly = true;
    return this;
  }
  insert(values: Row | Row[]) { this.insertVals = Array.isArray(values) ? values : [values]; return this; }
  upsert(values: Row | Row[], opts?: { onConflict?: string }) {
    this.upsertVals = Array.isArray(values) ? values : [values];
    if (opts?.onConflict) this.onConflictCols = opts.onConflict.split(',').map((c) => c.trim());
    return this;
  }
  update(values: Row) { this.updateVals = values; return this; }
  abortSignal() { return this; }
  delete() { this.del = true; return this; }

  eq(col: string, val: unknown) { this.filters.push((r) => r[col] === val); return this; }
  neq(col: string, val: unknown) { this.filters.push((r) => r[col] !== val); return this; }
  in(col: string, arr: unknown[]) { this.filters.push((r) => arr.includes(r[col])); return this; }
  // normalise undefined to null so `.is('col', null)` matches seeded rows that omit the key
  is(col: string, val: unknown) { this.filters.push((r) => (r[col] ?? null) === val); return this; }
  gte(col: string, val: unknown) { this.filters.push((r) => (r[col] as number | string) >= (val as number | string)); return this; }
  lte(col: string, val: unknown) { this.filters.push((r) => (r[col] as number | string) <= (val as number | string)); return this; }
  gt(col: string, val: unknown) { this.filters.push((r) => (r[col] as number | string) > (val as number | string)); return this; }
  lt(col: string, val: unknown) { this.filters.push((r) => (r[col] as number | string) < (val as number | string)); return this; }
  ilike(col: string, pattern: string) { const s = String(pattern).replace(/%/g, '').toLowerCase(); this.filters.push((r) => String(r[col] ?? '').toLowerCase().includes(s)); return this; }
  like(col: string, pattern: string) { return this.ilike(col, pattern); }
  contains() { return this; }
  not() { return this; }
  filter() { return this; }
  match(obj: Row) { Object.entries(obj).forEach(([c, v]) => this.eq(c, v)); return this; }
  order(col: string, opts?: { ascending?: boolean }) { this.orderSpecs.push({ col, asc: opts?.ascending !== false }); return this; }
  limit(n: number) { this.limitN = n; return this; }
  range(a: number, b: number) { this.rangeSpec = [a, b]; return this; }
  single() { this.wantSingle = true; return this; }
  maybeSingle() { this.wantSingle = true; return this; }

  private matching(): Row[] {
    return this.live.filter((r) => this.filters.every((f) => f(r)));
  }

  private resolve(): MockResult {
    if (this.insertVals) {
      const data = this.insertVals.map((r) => stampRow(this.table === 'sets' ? { weight: null, reps: null, rpe: null, completed_at: null, ...r } : r));
      this.live.push(...data);
      const copies = data.map((r) => hydrate(this.table, r, this.selection));
      return { data: this.wantSingle ? copies[0] ?? null : copies, error: null, count: copies.length };
    }
    if (this.upsertVals) {
      const results: Row[] = [];
      for (const value of this.upsertVals) {
        const existing = this.live.find((r) => this.onConflictCols.every((c) => r[c] === value[c]));
        if (existing) {
          Object.assign(existing, value, { updated_at: new Date().toISOString() });
          results.push(existing);
        } else {
          const stamped = stampRow(value);
          this.live.push(stamped);
          results.push(stamped);
        }
      }
      const copies = results.map((r) => hydrate(this.table, r, this.selection));
      return { data: this.wantSingle ? copies[0] ?? null : copies, error: null, count: copies.length };
    }
    if (this.updateVals) {
      if (this.table === 'sets' && this.updateVals.completed === true && this.scenario.remainingSetFailures > 0) {
        this.scenario.remainingSetFailures--;
        return { data: null, error: { message: 'Preview set-save failure', code: 'PREVIEW_FAILURE' }, count: 0, status: 503 };
      }
      const targets = this.matching();
      targets.forEach((r) => Object.assign(r, this.updateVals));
      const copies = targets.map((r) => hydrate(this.table, r, this.selection));
      return { data: this.wantSingle ? copies[0] ?? null : copies, error: null, count: copies.length };
    }
    if (this.del) {
      const targets = new Set(this.matching());
      const count = targets.size;
      cascadeDelete(this.table, targets);
      for (let i = this.live.length - 1; i >= 0; i--) {
        if (targets.has(this.live[i])) this.live.splice(i, 1);
      }
      return { data: null, error: null, count };
    }
    let data = this.matching().map((r) => hydrate(this.table, r, this.selection));
    if (this.orderSpecs.length) {
      data = [...data].sort((a, b) => {
        for (const { col, asc } of this.orderSpecs) {
          const av = a[col] as number | string;
          const bv = b[col] as number | string;
          const difference = (av > bv ? 1 : av < bv ? -1 : 0) * (asc ? 1 : -1);
          if (difference) return difference;
        }
        return 0;
      });
    }
    const count = data.length;
    if (this.rangeSpec) data = data.slice(this.rangeSpec[0], this.rangeSpec[1] + 1);
    if (this.limitN != null) data = data.slice(0, this.limitN);
    if (this.headOnly) return { data: null, error: null, count };
    if (this.wantSingle) return { data: data[0] ?? null, error: null, count };
    return { data, error: null, count };
  }

  then<TResult1 = MockResult, TResult2 = never>(
    onfulfilled?: ((value: MockResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    const pending = this.table === 'sets' && this.updateVals?.completed === true && this.scenario.delayMs > 0
      ? new Promise<MockResult>((resolve) => setTimeout(() => resolve(this.resolve()), this.scenario.delayMs))
      : Promise.resolve(this.resolve());
    return pending.then(onfulfilled, onrejected);
  }
}

function saveMockSplitSnapshot(params: Row): MockResult {
  const split = previewTables.splits.find((row) => row.id === params.p_split_id && row.user_id === PREVIEW_USER_ID);
  const payload = params.p_days;
  if (!split || !Array.isArray(payload) || payload.some((day) => !day || !Array.isArray(day.exercises))) {
    return { data: null, error: { message: 'Invalid preview program snapshot', code: 'PREVIEW_SNAPSHOT' }, count: 0 };
  }
  // Stage the complete snapshot, mirroring save_split_snapshot's existing-ID
  // upserts and removal semantics. Publish only after it has been assembled.
  const days = structuredClone(previewTables.split_days);
  const exercises = structuredClone(previewTables.split_exercises);
  const keptDays = new Set<unknown>();
  for (const day of payload as Array<Row & { exercises: Row[] }>) {
    let savedDay = days.find((row) => row.id === day.id && row.split_id === split.id);
    const dayValues = { split_id: split.id, day_name: day.day_name, day_order: day.day_order };
    if (savedDay) Object.assign(savedDay, dayValues);
    else { savedDay = stampRow(dayValues); days.push(savedDay); }
    keptDays.add(savedDay.id);
    const keptExercises = new Set<unknown>();
    for (const exercise of day.exercises) {
      let savedExercise = exercises.find((row) => row.id === exercise.id && row.split_day_id === savedDay.id);
      const values = {
        split_day_id: savedDay.id, exercise_id: exercise.exercise_id,
        target_sets: exercise.target_sets, target_reps_min: exercise.target_reps_min,
        target_reps_max: exercise.target_reps_max, exercise_order: exercise.exercise_order,
        notes: exercise.notes ?? null, superset_group_id: exercise.superset_group_id ?? null,
      };
      if (savedExercise) Object.assign(savedExercise, values);
      else { savedExercise = stampRow(values); exercises.push(savedExercise); }
      keptExercises.add(savedExercise.id);
    }
    for (let i = exercises.length - 1; i >= 0; i--) {
      if (exercises[i].split_day_id === savedDay.id && !keptExercises.has(exercises[i].id)) exercises.splice(i, 1);
    }
  }
  const removedDayIds = new Set(days.filter((day) => day.split_id === split.id && !keptDays.has(day.id)).map((day) => day.id));
  const keptDayRows = days.filter((day) => !removedDayIds.has(day.id));
  const keptExerciseRows = exercises.filter((exercise) => !removedDayIds.has(exercise.split_day_id));
  Object.assign(split, { name: params.p_name, description: params.p_description, days_per_week: params.p_days_per_week });
  previewTables.split_days.splice(0, previewTables.split_days.length, ...keptDayRows);
  previewTables.split_exercises.splice(0, previewTables.split_exercises.length, ...keptExerciseRows);
  for (const workout of previewTables.workouts) if (removedDayIds.has(workout.split_day_id)) workout.split_day_id = null;
  return { data: null, error: null, count: 1 };
}

export function createMockClient(options?: { setSaveFailures?: number }): SupabaseClient {
  // DEV mock-only QA: enter /preview?previewSetSave=fail, then Save set.
  // Both automatic attempts fail before any write; the next explicit Retry succeeds.
  const requestedFailure = import.meta.env.DEV && typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('previewSetSave') === 'fail';
  const scenario: MockScenario = { remainingSetFailures: options?.setSaveFailures ?? (requestedFailure ? 2 : 0), delayMs: requestedFailure ? 600 : 0 };
  const auth = {
    getUser: async () => ({ data: { user: PREVIEW_USER }, error: null }),
    getSession: async () => ({ data: { session: { user: PREVIEW_USER, access_token: 'preview' } }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signInWithPassword: async () => ({ data: { user: PREVIEW_USER }, error: null }),
    signUp: async () => ({ data: { user: PREVIEW_USER }, error: null }),
    signInWithOAuth: async () => ({ data: {}, error: null }),
    signOut: async () => ({ error: null }),
    resend: async () => ({ data: {}, error: null }),
    updateUser: async () => ({ data: { user: PREVIEW_USER }, error: null }),
  };

  const client = {
    auth,
    from: (table: string) => new MockBuilder(table, scenario),
    rpc: async (name: string, params: Row) => name === 'save_split_snapshot'
      ? saveMockSplitSnapshot(params)
      : { data: null, error: { message: `${name} is not available in preview`, code: 'PREVIEW_UNSUPPORTED' } },
    functions: {
      invoke: async (name: string, options?: { body?: Record<string, unknown> }) => name === 'food-lookup'
        ? { data: mockFoodLookup(options?.body), error: null }
        : { data: null, error: { message: `${name} is not available in preview` } },
    },
    channel: () => ({ on() { return this; }, subscribe() { return this; }, unsubscribe() {} }),
    removeChannel: () => {},
  };

  return client as unknown as SupabaseClient;
}
