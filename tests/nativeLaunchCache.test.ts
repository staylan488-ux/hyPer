import { AuthRetryableFetchError } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Split, Workout } from '@/types';
import type { TodaySeed } from '../native/src/lib/launchSnapshot';

const mocks = vi.hoisted(() => ({
  user: 'user-1' as string | null,
  // A table's answer; a table without one never answers.
  results: {} as Record<string, unknown>,
  food: vi.fn(),
  supabase: {
    from: vi.fn(),
    auth: { getSession: vi.fn(), onAuthStateChange: vi.fn(), signOut: vi.fn() },
  },
}));
vi.mock('@/lib/supabase', () => ({ supabase: mocks.supabase }));
vi.mock('@/lib/sessionUser', () => ({ getSessionUserId: async () => mocks.user }));
vi.mock('@/lib/nutritionLogQueries', () => ({ fetchNutritionLogsWithFoods: mocks.food }));

function query(table: string) {
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'gte', 'lte', 'order', 'limit', 'in', 'maybeSingle', 'single', 'insert', 'update', 'upsert', 'delete']) {
    chain[method] = () => chain;
  }
  chain.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => (
    table in mocks.results ? Promise.resolve(mocks.results[table]) : new Promise(() => {})
  ).then(resolve, reject);
  return chain;
}

const USER = 'user-1';
const BACKEND = 'hyper-test.invalid';
const BUILD = '2.0.0+42';
// Wednesday 4 November 2026, early afternoon (local time).
const NOW = new Date(2026, 10, 4, 13, 0, 0);
const DAY = '2026-11-04';
const KEYS = ['program', 'templates', 'volume', 'target', 'profile', 'today', 'month', 'training'].map((part) => `hyper-launch:${part}`);

const ppl: Split = {
  id: 'ppl', user_id: USER, name: 'PPL', description: null, days_per_week: 4, is_active: true,
  days: [
    { id: 'push', split_id: 'ppl', day_name: 'Push', day_order: 0, exercises: [] },
    { id: 'legs', split_id: 'ppl', day_name: 'Legs', day_order: 1, exercises: [] },
  ],
};
const log = (id: string, date: string, calories: number, protein: number, user = USER) => ({
  id, user_id: user, date, logged_at: null, food_id: `food-${id}`, servings: 1, food: { calories, protein, carbs: 5, fat: 2 },
});
const target = { id: 't1', user_id: USER, calories: 2800, protein: 160, carbs: 350, fat: 80 };
const seed: TodaySeed = { dayKey: DAY, splitId: 'ppl', mode: 'flexible', basis: '[["push","legs"],null,true]', hero: { kind: 'flexible' }, next: null, weekDone: 2 };
const live = { id: 'w1', user_id: USER, split_day_id: null, date: DAY, notes: null, completed: false, created_at: '2026-11-04T12:00:00.000Z', sets: [] } as unknown as Workout;
const bodies = (): Record<string, unknown> => ({
  program: { splits: [ppl], workoutMode: 'flexible' },
  templates: { templates: [{ id: 'q1', user_id: USER, label: 'Arms', items: [] }] },
  volume: {
    weekStart: '2026-11-02',
    weeklyVolume: [{ muscle_group: 'chest', weekly_sets: 8, status: 'mav' }],
    volumeLandmarks: [{ id: 'l1', user_id: USER, muscle_group: 'chest', mv: 4, mev: 6, mav_low: 8, mav_high: 14, mrv: 20 }],
  },
  target: { value: target },
  profile: { value: { user_id: USER, goal: 'lean_bulk' } },
  today: { dayKey: DAY, totals: { calories: 860, protein: 52, carbs: 10, fat: 4 } },
  month: { month: '2026-11', dayKey: DAY, logs: [log('a', DAY, 500, 30), log('b', DAY, 360, 22)], groups: [] },
  training: { workout: null, today: seed },
});
const stamp = (part: string, userId = USER) => ({ v: 1, part, userId, backend: BACKEND, build: BUILD, savedAt: NOW.getTime() - 3_600_000 });

function spyStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
    removeItem: vi.fn((key: string) => { values.delete(key); }),
  };
}
type SpyStorage = ReturnType<typeof spyStorage>;
function savedCopy(owners: Record<string, string> = {}) {
  const entries = Object.entries(bodies()).map(([part, body]) => [`hyper-launch:${part}`, JSON.stringify({ stamp: stamp(part, owners[part]), body })]);
  return spyStorage(Object.fromEntries(entries));
}
const saved = (storage: SpyStorage, part: string) => {
  const value = storage.values.get(`hyper-launch:${part}`);
  return value ? (JSON.parse(value) as { stamp: { userId: string; savedAt: number }; body: Record<string, unknown> }) : null;
};
const writesOf = (storage: SpyStorage, part: string) => storage.setItem.mock.calls.filter(([key]) => key === `hyper-launch:${part}`).length;

async function load() {
  vi.resetModules();
  const auth = await import('@/stores/authStore');
  const app = await import('@/stores/appStore');
  const fuel = await import('../native/src/lib/fuel');
  const cache = await import('../native/src/lib/launchCache');
  return { auth: auth.useAuthStore, app: app.useAppStore, initialAppData: app.initialAppData, fuel: fuel.useFuelStore, fuelModule: fuel, cache };
}
type Loaded = Awaited<ReturnType<typeof load>>;

let leave: (() => void) | null = null;
function install(modules: Loaded, storage: SpyStorage, options: { preview?: boolean; backend?: string } = {}) {
  modules.cache.installLaunchCache({
    preview: options.preview ?? false,
    backend: options.backend ?? BACKEND,
    build: BUILD,
    storage,
    onLeave: (save) => { leave = save; },
  });
}
async function initialize(modules: Loaded, session: { user: { id: string } } | null, error: unknown = null) {
  mocks.supabase.auth.getSession.mockResolvedValue({ data: { session }, error });
  await modules.auth.getState().initialize();
  return mocks.supabase.auth.onAuthStateChange.mock.calls[0][0] as (event: string, session: { user: { id: string } } | null) => Promise<void>;
}
const signIn = (modules: Loaded, userId = USER) => initialize(modules, { user: { id: userId } });
const freshFuel = (modules: Loaded, userId = USER) => modules.fuel.setState({
  loadedMonth: '2026-11',
  logs: [log('a', DAY, 500, 30, userId)] as never[],
  groups: [],
  status: 'ready',
  todayKey: DAY,
  todayTotals: { calories: 500, protein: 30, carbs: 5, fat: 2 },
  todayLoadedForUserId: userId,
  todayLoadedKey: DAY,
});

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  leave = null;
  mocks.user = USER;
  mocks.results = {};
  mocks.food.mockReset().mockReturnValue(new Promise(() => {}));
  mocks.supabase.from.mockReset().mockImplementation(query);
  mocks.supabase.auth.getSession.mockReset();
  mocks.supabase.auth.onAuthStateChange.mockReset().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
  mocks.supabase.auth.signOut.mockReset().mockResolvedValue({ error: null });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('restoring the copy at launch', () => {
  it('fills the stores inside the same sign-in update, with no loaded marker', async () => {
    const modules = await load();
    const storage = savedCopy();
    install(modules, storage);
    let seen: { splits: unknown; todayTotals: unknown; logs: unknown[] } | null = null;
    modules.auth.subscribe((state, prev) => {
      if (state.user && !prev.user) {
        seen = { splits: modules.app.getState().splits, todayTotals: modules.fuel.getState().todayTotals, logs: modules.fuel.getState().logs };
      }
    });
    await signIn(modules);

    expect(seen).toMatchObject({ splits: [{ id: 'ppl' }], todayTotals: { calories: 860 }, logs: [{ id: 'a' }, { id: 'b' }] });
    const a = modules.app.getState();
    expect(a.splits).toEqual([ppl]);
    expect(a.activeSplit).toBe(a.splits[0]);
    expect(a.workoutMode).toBe('flexible');
    expect(a.flexTemplates).toEqual([{ id: 'q1', user_id: USER, label: 'Arms', items: [] }]);
    expect(a.weeklyVolume).toHaveLength(1);
    expect(a.macroTarget).toEqual(target);
    expect(a.nutritionProfile).toEqual({ user_id: USER, goal: 'lean_bulk' });
    expect(a.currentWorkout).toBeNull();
    expect(a).toMatchObject({ hydratedForUserId: null, workoutLoadedForUserId: null, macroTargetLoadedForUserId: null, nutritionProfileLoadedForUserId: null });
    expect(modules.fuel.getState()).toMatchObject({ loadedMonth: '2026-11', status: 'ready', todayLoadedForUserId: null, todayLoadedKey: null });
    expect(modules.cache.useLaunchHint.getState()).toEqual({ seed, holdPlan: false });
    // Nothing restored is written back.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('holds the plan when the copy recorded a live workout', async () => {
    const modules = await load();
    const storage = savedCopy();
    // Started an hour before now, in any time zone.
    const startedAt = new Date(NOW.getTime() - 3_600_000).toISOString();
    const training = { stamp: stamp('training'), body: { workout: { id: 'w1', created_at: startedAt, date: DAY }, today: null } };
    storage.values.set('hyper-launch:training', JSON.stringify(training));
    install(modules, storage);
    await signIn(modules);
    expect(modules.app.getState().currentWorkout).toBeNull();
    expect(modules.cache.useLaunchHint.getState()).toEqual({ seed: null, holdPlan: true });
  });

  it('brings the month back the next day only beside the figures it was saved with', async () => {
    const NEXT_DAY = new Date(2026, 10, 5, 9, 0, 0);
    /** Day one: Fuel on this month, so today's figures and the month are saved together. */
    const dayOne = async () => {
      vi.setSystemTime(NOW);
      const modules = await load();
      const storage = spyStorage();
      install(modules, storage);
      await signIn(modules);
      freshFuel(modules);
      await vi.advanceTimersByTimeAsync(1_000);
      return { modules, storage };
    };
    const nextDay = async (storage: SpyStorage) => {
      vi.setSystemTime(NEXT_DAY);
      const modules = await load();
      install(modules, storage);
      await signIn(modules);
      return modules.fuel.getState();
    };

    const plain = await dayOne();
    expect(await nextDay(plain.storage)).toMatchObject({
      todayKey: '2026-11-05', todayTotals: { calories: 0 }, loadedMonth: '2026-11', logs: [{ id: 'a' }],
    });

    // Later on day one Fuel goes to October: this month's copy would no longer
    // follow edits (an entry moved to another day of it), so it is removed.
    // Food logged from Today still saves today's figures.
    const { modules, storage } = await dayOne();
    expect(saved(storage, 'month')?.body).toMatchObject({ dayKey: DAY, logs: [{ id: 'a' }] });
    modules.fuel.setState({ loadedMonth: '2026-10', logs: [], groups: [] });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(storage.values.has('hyper-launch:month')).toBe(false);
    modules.fuel.setState({ todayTotals: { calories: 860, protein: 52, carbs: 10, fat: 4 } });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(saved(storage, 'today')?.body).toEqual({ dayKey: DAY, totals: { calories: 860, protein: 52, carbs: 10, fat: 4 } });
    expect(storage.values.has('hyper-launch:month')).toBe(false);
    // The next day Fuel reads the month instead.
    expect(await nextDay(storage)).toMatchObject({
      todayKey: '2026-11-05', todayTotals: { calories: 0 }, loadedMonth: null, status: 'idle', logs: [],
    });
  });

  it('never overwrites stores that already hold data', async () => {
    const modules = await load();
    const storage = savedCopy();
    install(modules, storage);
    modules.fuel.setState({ status: 'loading' });
    await signIn(modules);
    expect(modules.app.getState().splits).toBe(modules.initialAppData.splits);
    expect(modules.app.getState().macroTarget).toBeNull();
    expect(modules.fuel.getState().todayTotals.calories).toBe(0);
  });
});

describe('keeping accounts and builds apart', () => {
  it('restores nothing and removes every part when one belongs to another account', async () => {
    const modules = await load();
    const storage = savedCopy({ profile: 'user-2' });
    install(modules, storage);
    await signIn(modules);
    expect(modules.app.getState().splits).toBe(modules.initialAppData.splits);
    expect(modules.fuel.getState().todayTotals.calories).toBe(0);
    expect([...storage.values.keys()]).toEqual([]);
  });

  it('removes the copy on sign-out and resets the hint', async () => {
    const modules = await load();
    const storage = savedCopy();
    install(modules, storage);
    const callback = await signIn(modules);
    expect(modules.cache.useLaunchHint.getState().seed).toEqual(seed);
    await callback('SIGNED_OUT', null);
    expect(storage.values.size).toBe(0);
    expect(modules.cache.useLaunchHint.getState()).toEqual({ seed: null, holdPlan: false });
  });

  it('removes the copy when another account signs in, and writes nothing of the first under the second', async () => {
    const modules = await load();
    const storage = spyStorage();
    install(modules, storage);
    const callback = await signIn(modules);
    freshFuel(modules);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(saved(storage, 'today')?.stamp.userId).toBe(USER);

    mocks.user = 'user-2';
    await callback('SIGNED_IN', { user: { id: 'user-2' } });
    expect(storage.values.size).toBe(0);
    // Fuel still holds the first account's rows until its own reset.
    modules.fuel.setState({ todayTotals: { calories: 501, protein: 30, carbs: 5, fat: 2 } });
    modules.app.setState({ workoutLoadedForUserId: USER });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(storage.values.size).toBe(0);
  });

  it('removes the copy when the launch finds no saved sign-in', async () => {
    const modules = await load();
    const storage = savedCopy();
    install(modules, storage);
    await initialize(modules, null);
    expect(storage.values.size).toBe(0);
  });

  it('keeps the copy while offline, and restores it when the session comes back', async () => {
    const modules = await load();
    const storage = savedCopy();
    install(modules, storage);
    const callback = await initialize(modules, null, new AuthRetryableFetchError('Failed to fetch', 0));
    expect(modules.auth.getState().reconnecting).toBe(true);
    expect([...storage.values.keys()].sort()).toEqual([...KEYS].sort());
    await callback('TOKEN_REFRESHED', { user: { id: USER } });
    await Promise.resolve();
    expect([...storage.values.keys()].sort()).toEqual([...KEYS].sort());
    expect(modules.app.getState().splits).toEqual([ppl]);
    expect(modules.fuel.getState().todayTotals.calories).toBe(860);
  });

  it('does not restore over a read that landed while offline', async () => {
    const modules = await load();
    const storage = savedCopy();
    install(modules, storage);
    const callback = await initialize(modules, null, new AuthRetryableFetchError('Failed to fetch', 0));
    modules.app.setState({ macroTargetLoadedForUserId: USER });
    await callback('TOKEN_REFRESHED', { user: { id: USER } });
    expect(modules.app.getState().splits).toBe(modules.initialAppData.splits);
  });

  it.each([
    ['auth-js signs out', async (callback: (event: string, session: null) => Promise<void>) => { await callback('SIGNED_OUT', null); }],
    ['the person signs out', async (_callback: unknown, modules: Loaded) => { await modules.auth.getState().signOut(); }],
  ])('removes the copy when %s while offline', async (_name, leaveOffline) => {
    const modules = await load();
    const storage = savedCopy();
    install(modules, storage);
    const callback = await initialize(modules, null, new AuthRetryableFetchError('Failed to fetch', 0));
    await leaveOffline(callback, modules);
    await Promise.resolve();
    expect(storage.values.size).toBe(0);
  });

  it('never reads or writes in preview, or without a backend', async () => {
    for (const options of [{ preview: true }, { backend: '' }]) {
      const modules = await load();
      const storage = savedCopy();
      install(modules, storage, options);
      await signIn(modules);
      freshFuel(modules);
      modules.app.setState({ workoutLoadedForUserId: USER, hydratedForUserId: USER });
      await vi.advanceTimersByTimeAsync(2_000);
      expect(storage.getItem).not.toHaveBeenCalled();
      expect(storage.setItem).not.toHaveBeenCalled();
      expect(storage.removeItem).not.toHaveBeenCalled();
      expect(modules.app.getState().splits).toEqual([]);
    }
  });

  it('drops a copy from another build', async () => {
    const modules = await load();
    const storage = savedCopy();
    modules.cache.installLaunchCache({ preview: false, backend: BACKEND, build: '2.0.1+43', storage });
    expect(storage.values.size).toBe(0);
  });
});

describe('saving only what this launch read', () => {
  it('saves today’s food without waiting for the program, and the program once it has loaded', async () => {
    const modules = await load();
    const storage = spyStorage();
    install(modules, storage);
    await signIn(modules);
    modules.app.setState({ splits: [ppl], activeSplit: ppl });
    freshFuel(modules);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(saved(storage, 'today')?.body).toEqual({ dayKey: DAY, totals: { calories: 500, protein: 30, carbs: 5, fat: 2 } });
    expect(saved(storage, 'month')?.body).toMatchObject({ month: '2026-11', dayKey: DAY, logs: [{ id: 'a' }] });
    expect(saved(storage, 'program')).toBeNull();

    modules.app.setState({ hydratedForUserId: USER });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(saved(storage, 'program')?.body).toEqual({ splits: [ppl], workoutMode: 'split' });
    expect(writesOf(storage, 'program')).toBe(1);
  });

  it('leaves the saved target alone when its read failed', async () => {
    const modules = await load();
    const storage = savedCopy();
    const before = storage.values.get('hyper-launch:target');
    install(modules, storage);
    await signIn(modules);
    modules.app.setState({ macroTarget: { ...target, calories: 2600 } });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(storage.values.get('hyper-launch:target')).toBe(before);
    modules.app.setState({ macroTargetLoadedForUserId: USER });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(saved(storage, 'target')?.body).toEqual({ value: { ...target, calories: 2600 } });
  });

  it('saves quick starts only once a read brings a new list', async () => {
    const modules = await load();
    const storage = savedCopy();
    install(modules, storage);
    await signIn(modules);
    const row = { id: 'q1', user_id: USER, label: 'Arms', items: [] };
    mocks.results.flex_day_templates = { data: [row], error: null };
    await modules.app.getState().fetchFlexTemplates();
    modules.app.setState({ hydratedForUserId: USER });
    await vi.advanceTimersByTimeAsync(1_000);
    // The same list keeps the copy's array (appStore's sameData), which is never saved back.
    expect(writesOf(storage, 'templates')).toBe(0);

    mocks.results.flex_day_templates = { data: [row, { ...row, id: 'q2', label: 'Legs' }], error: null };
    await modules.app.getState().fetchFlexTemplates({ force: true });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(saved(storage, 'templates')?.body).toMatchObject({ templates: [{ id: 'q1' }, { id: 'q2' }] });
  });

  it('does not save volume that may belong to the week that just ended', async () => {
    const modules = await load();
    const storage = spyStorage();
    install(modules, storage);
    await signIn(modules);
    vi.setSystemTime(new Date(2026, 10, 9, 0, 0, 30));
    modules.app.setState({ weeklyVolume: [{ muscle_group: 'chest', weekly_sets: 8, status: 'mav' }] });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(saved(storage, 'volume')).toBeNull();

    vi.setSystemTime(new Date(2026, 10, 9, 0, 5));
    modules.app.setState({ weeklyVolume: [{ muscle_group: 'chest', weekly_sets: 2, status: 'below_mev' }] });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(saved(storage, 'volume')?.body).toMatchObject({ weekStart: '2026-11-09', weeklyVolume: [{ weekly_sets: 2 }] });
  });

  it('saves volume when only the landmarks changed, never the copy alone', async () => {
    const modules = await load();
    const storage = savedCopy();
    install(modules, storage);
    await signIn(modules);
    const restored = modules.app.getState().weeklyVolume;
    modules.app.setState({ hydratedForUserId: USER });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(writesOf(storage, 'volume')).toBe(0);

    const landmarks = [{ id: 'l1', user_id: USER, muscle_group: 'chest' as const, mv: 4, mev: 6, mav_low: 9, mav_high: 15, mrv: 22 }];
    modules.app.setState({ volumeLandmarks: landmarks });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(saved(storage, 'volume')?.body).toEqual({ weekStart: '2026-11-02', weeklyVolume: restored, volumeLandmarks: landmarks });
  });

  it('never saves the month while Fuel shows the copy', async () => {
    const modules = await load();
    const storage = savedCopy();
    install(modules, storage);
    await signIn(modules);
    expect(modules.fuelModule.isFuelMonthFromCopy()).toBe(true);
    modules.fuel.setState({ todayLoadedForUserId: USER, todayLoadedKey: DAY });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(writesOf(storage, 'today')).toBe(1);
    expect(writesOf(storage, 'month')).toBe(0);
  });
});

describe('when and how the copy is written', () => {
  it('waits a second, writes each part once, and skips an unchanged part', async () => {
    const modules = await load();
    const storage = spyStorage();
    install(modules, storage);
    await signIn(modules);
    freshFuel(modules);
    await vi.advanceTimersByTimeAsync(999);
    expect(storage.setItem).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(writesOf(storage, 'today')).toBe(1);
    expect(writesOf(storage, 'month')).toBe(1);

    modules.fuel.setState({ todayTotals: { calories: 500, protein: 30, carbs: 5, fat: 2 } });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(writesOf(storage, 'today')).toBe(1);
  });

  it('writes at once as the app leaves the screen', async () => {
    const modules = await load();
    const storage = spyStorage();
    install(modules, storage);
    await signIn(modules);
    freshFuel(modules);
    expect(storage.setItem).not.toHaveBeenCalled();
    leave?.();
    expect(writesOf(storage, 'today')).toBe(1);
  });

  it('writes the workout mark at once, never the workout itself, and drops the seed when a workout starts', async () => {
    const modules = await load();
    const storage = savedCopy();
    install(modules, storage);
    await signIn(modules);
    modules.app.setState({ workoutLoadedForUserId: USER });
    expect(saved(storage, 'training')?.body).toEqual({ workout: null, today: seed });

    modules.app.setState({ currentWorkout: live });
    expect(saved(storage, 'training')?.body).toEqual({ workout: { id: 'w1', created_at: '2026-11-04T12:00:00.000Z', date: DAY }, today: null });
    expect(modules.cache.useLaunchHint.getState().seed).toBeNull();

    // A logged set changes the workout, not its id: nothing is written.
    const writes = writesOf(storage, 'training');
    modules.app.setState({ currentWorkout: { ...live, notes: 'heavy' } });
    expect(writesOf(storage, 'training')).toBe(writes);

    modules.app.setState({ currentWorkout: null });
    expect(saved(storage, 'training')?.body).toEqual({ workout: null, today: null });
  });

  it('keeps today’s decided plan and shows it to screens mounted later', async () => {
    const modules = await load();
    const storage = spyStorage();
    install(modules, storage);
    await signIn(modules);
    modules.app.setState({ workoutLoadedForUserId: USER });
    const decided: TodaySeed = { ...seed, hero: { kind: 'rest' }, next: 'Tomorrow · Legs', mode: 'split' };
    modules.cache.noteTodayPlan(decided);
    expect(saved(storage, 'training')?.body).toEqual({ workout: null, today: decided });
    expect(modules.cache.useLaunchHint.getState().seed).toEqual(decided);
  });

  it('removes a part whose save fails, and never throws out of a store update', async () => {
    const modules = await load();
    const storage = savedCopy();
    install(modules, storage);
    await signIn(modules);
    storage.setItem.mockImplementation(() => { throw new Error('disk full'); });
    expect(() => modules.app.setState({ workoutLoadedForUserId: USER })).not.toThrow();
    expect(storage.removeItem).toHaveBeenCalledWith('hyper-launch:training');
    expect(storage.values.has('hyper-launch:training')).toBe(false);
  });

  it('removes a part too big to keep', async () => {
    const modules = await load();
    const storage = savedCopy();
    install(modules, storage);
    await signIn(modules);
    modules.app.setState({ splits: [{ ...ppl, name: 'x'.repeat(1_000_001) }], hydratedForUserId: USER });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(writesOf(storage, 'program')).toBe(0);
    expect(storage.values.has('hyper-launch:program')).toBe(false);
  });
});

describe('the quiet refresh after a restore', () => {
  it('keeps the restored program when the read finds it unchanged, and renews its copy', async () => {
    const modules = await load();
    const storage = savedCopy();
    install(modules, storage);
    await signIn(modules);
    const { splits, activeSplit } = modules.app.getState();
    mocks.results.splits = { data: [structuredClone(ppl)], error: null };
    mocks.results.workouts = { data: null, error: null };
    mocks.results.program_preferences = { data: { workout_mode: 'flexible' }, error: null };
    await Promise.all([
      modules.app.getState().fetchSplits(),
      modules.app.getState().fetchCurrentWorkout(),
      modules.app.getState().fetchWorkoutMode(),
    ]);
    expect(modules.app.getState().splits).toBe(splits);
    expect(modules.app.getState().activeSplit).toBe(activeSplit);
    expect(modules.app.getState().hydratedForUserId).toBe(USER);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(writesOf(storage, 'program')).toBe(1);
    expect(saved(storage, 'program')?.stamp.savedAt).toBe(NOW.getTime() + 1_000);
  });

  it('keeps the restored target when its read fails', async () => {
    const modules = await load();
    const storage = savedCopy();
    install(modules, storage);
    await signIn(modules);
    mocks.results.macro_targets = { data: null, error: { message: 'offline' } };
    await modules.app.getState().fetchMacroTarget();
    expect(modules.app.getState().macroTarget).toEqual(target);
    expect(modules.app.getState().macroTargetLoadedForUserId).toBeNull();
  });

  it('falls back to the device’s mode when the mode read fails (documented)', async () => {
    const modules = await load();
    const storage = savedCopy();
    install(modules, storage);
    await signIn(modules);
    expect(modules.app.getState().workoutMode).toBe('flexible');
    mocks.results.program_preferences = { data: null, error: { message: 'offline' } };
    await modules.app.getState().fetchWorkoutMode();
    expect(modules.app.getState().workoutMode).toBe('split');
  });
});
