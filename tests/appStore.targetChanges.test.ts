import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MacroTarget } from '@/types';

const supabaseMock = vi.hoisted(() => ({
  from: vi.fn(),
  auth: { getUser: vi.fn(), getSession: vi.fn() },
}));

vi.mock('@/lib/supabase', () => ({ supabase: supabaseMock }));

const dataMock = vi.hoisted(() => ({
  getLatestBodyWeight: vi.fn(),
  getBodyWeightHistorySince: vi.fn(),
  getDailyIntake: vi.fn(),
}));

vi.mock('@/lib/healthWeights', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/healthWeights')>()),
  getLatestBodyWeight: dataMock.getLatestBodyWeight,
  getBodyWeightHistorySince: dataMock.getBodyWeightHistorySince,
}));

vi.mock('@/lib/nutritionIntake', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/nutritionIntake')>()),
  getDailyIntake: dataMock.getDailyIntake,
}));

import { useAppStore, resetAppData } from '@/stores/appStore';
import type { NutritionProfile } from '@/lib/nutritionProfile';
import type { MacroTargetChange } from '@/lib/targetChanges';
import { localIsoDate } from '@/lib/weightTrend';

type Result = { data: unknown; error: unknown };

/** A query chain whose every step returns itself, ending in the given answers. */
function chain(end: { single?: () => Result; maybeSingle?: () => Result } = {}) {
  const c: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const step of ['select', 'insert', 'update', 'upsert', 'eq', 'neq', 'order', 'limit']) {
    c[step] = vi.fn(() => c);
  }
  c.single = vi.fn(async () => (end.single ? end.single() : { data: null, error: null }));
  c.maybeSingle = vi.fn(async () => (end.maybeSingle ? end.maybeSingle() : { data: null, error: null }));
  return c;
}

function routeTables(tables: Record<string, ReturnType<typeof chain>>) {
  supabaseMock.from.mockImplementation((table: string) => {
    const found = tables[table];
    // A table the backend doesn't have, as PostgREST would answer it.
    if (!found) throw new Error(`relation "public.${table}" does not exist`);
    return found;
  });
}

function dayOffset(days: number, hour = 12): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, hour, 0, 0);
}

const profile: NutritionProfile = {
  user_id: 'user-1',
  sex: 'male',
  birth_year: 1998,
  height_cm: 178,
  body_fat_pct: null,
  activity: 'moderately_active',
  goal: 'lean_bulk',
  rate_pct_per_week: 0.25,
  unit_system: 'imperial',
  adaptive_enabled: true,
  phase_started_on: localIsoDate(dayOffset(-90)),
  expenditure_kcal: null,
  expenditure_confidence: null,
  expenditure_updated_at: null,
  updated_at: '2026-01-01T00:00:00.000Z',
};

const previous: MacroTarget = {
  id: 'macro-1',
  user_id: 'user-1',
  calories: 2500,
  protein: 150,
  carbs: 300,
  fat: 70,
  source: 'adaptive',
  updated_at: '2026-09-01T10:00:00.000Z',
};

/** Three weeks of steady logging and a slow gain: enough to measure. */
function seedMeasurableData() {
  dataMock.getLatestBodyWeight.mockResolvedValue({ kilograms: 65 });
  dataMock.getBodyWeightHistorySince.mockResolvedValue(
    Array.from({ length: 22 }, (_, i) => ({ measured_at: dayOffset(-21 + i, 7).toISOString(), kilograms: 64 + i * 0.01 })),
  );
  dataMock.getDailyIntake.mockResolvedValue(
    Array.from({ length: 22 }, (_, i) => ({ date: localIsoDate(dayOffset(-21 + i)), calories: 2900 })),
  );
}

function profilesTable() {
  let row: Record<string, unknown> = { ...profile };
  const c = chain({ single: () => ({ data: row, error: null }) });
  c.update.mockImplementation((fields: Record<string, unknown>) => { row = { ...row, ...fields }; return c; });
  return c;
}

function savedRow(fields: Partial<MacroTarget>) {
  return { ...previous, ...fields, source: 'adaptive', updated_at: new Date().toISOString() };
}

/** macro_targets that saves whatever the refresh asks for. */
function macroTargetsTable() {
  let written: Record<string, unknown> = {};
  const c = chain({ maybeSingle: () => ({ data: savedRow(written as Partial<MacroTarget>), error: null }) });
  c.update.mockImplementation((fields: Record<string, unknown>) => { written = fields; return c; });
  return c;
}

const change: MacroTargetChange = {
  id: 'change-1',
  user_id: 'user-1',
  changed_at: new Date().toISOString(),
  old_calories: 2500,
  old_protein: 150,
  old_carbs: 300,
  old_fat: 70,
  new_calories: 2600,
  new_protein: 150,
  new_carbs: 325,
  new_fat: 70,
  expenditure_kcal: 2450,
  expenditure_confidence: 'measured',
  kg_per_week: 0.07,
  goal_kg_per_week: 0.163,
  mean_intake_kcal: 2900,
  logged_days: 21,
  weigh_in_days: 21,
  undone_at: null,
};

beforeEach(() => {
  supabaseMock.from.mockReset();
  supabaseMock.auth.getSession.mockReset();
  supabaseMock.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } } });
  dataMock.getLatestBodyWeight.mockReset();
  dataMock.getBodyWeightHistorySince.mockReset();
  dataMock.getDailyIntake.mockReset();
  resetAppData();
});

describe('recording a target change', () => {
  beforeEach(() => {
    seedMeasurableData();
    useAppStore.setState({ nutritionProfile: profile, macroTarget: previous });
  });

  it('records the old and new target and why, then shows it', async () => {
    const changes = chain({
      single: () => ({ data: { id: 'change-9', ...changes.insert.mock.calls[0][0], undone_at: null }, error: null }),
    });
    routeTables({ nutrition_profiles: profilesTable(), macro_targets: macroTargetsTable(), macro_target_changes: changes });

    await expect(useAppStore.getState().refreshAdaptiveTargets()).resolves.toBe('updated');

    const saved = useAppStore.getState().macroTarget as MacroTarget;
    expect(saved.calories).not.toBe(previous.calories);
    const row = changes.insert.mock.calls[0][0];
    expect(row).toMatchObject({
      user_id: 'user-1',
      old_calories: 2500,
      old_protein: 150,
      old_carbs: 300,
      old_fat: 70,
      new_calories: saved.calories,
      new_protein: saved.protein,
      new_carbs: saved.carbs,
      new_fat: saved.fat,
      expenditure_confidence: 'measured',
      logged_days: expect.any(Number),
      weigh_in_days: expect.any(Number),
    });
    expect(row.expenditure_kcal).toBe(useAppStore.getState().nutritionProfile?.expenditure_kcal);
    // 0.25% of 65 kg a week.
    expect(row.goal_kg_per_week).toBeCloseTo(0.163, 3);
    expect(row.kg_per_week).toBeGreaterThan(0);
    expect(useAppStore.getState().targetChange?.id).toBe('change-9');
  });

  it('goes on exactly as before when the backend has no change table', async () => {
    const profiles = profilesTable();
    routeTables({ nutrition_profiles: profiles, macro_targets: macroTargetsTable() });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(useAppStore.getState().refreshAdaptiveTargets()).resolves.toBe('updated');

    expect(useAppStore.getState().targetChange).toBeNull();
    expect(useAppStore.getState().nutritionProfile?.expenditure_updated_at).toEqual(expect.any(String));
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('goes on when the insert is refused', async () => {
    const changes = chain({ single: () => ({ data: null, error: { code: 'PGRST205', message: 'not found' } }) });
    routeTables({ nutrition_profiles: profilesTable(), macro_targets: macroTargetsTable(), macro_target_changes: changes });

    await expect(useAppStore.getState().refreshAdaptiveTargets()).resolves.toBe('updated');
    expect(useAppStore.getState().targetChange).toBeNull();
  });

  it('records nothing when the target came out the same', async () => {
    const changes = chain();
    const targets = chain({ maybeSingle: () => ({ data: previous, error: null }) });
    routeTables({ nutrition_profiles: profilesTable(), macro_targets: targets, macro_target_changes: changes });

    await useAppStore.getState().refreshAdaptiveTargets();

    expect(changes.insert).not.toHaveBeenCalled();
  });

  it('records nothing for a first target, with nothing before it', async () => {
    useAppStore.setState({ macroTarget: null });
    const changes = chain();
    routeTables({ nutrition_profiles: profilesTable(), macro_targets: macroTargetsTable(), macro_target_changes: changes });

    await useAppStore.getState().refreshAdaptiveTargets();

    expect(changes.insert).not.toHaveBeenCalled();
  });
});

describe('fetchTargetChange', () => {
  it('stores the latest change', async () => {
    const changes = chain({ maybeSingle: () => ({ data: { ...change, kg_per_week: '0.070' }, error: null }) });
    routeTables({ macro_target_changes: changes });

    await useAppStore.getState().fetchTargetChange();

    expect(changes.order).toHaveBeenCalledWith('changed_at', { ascending: false });
    expect(useAppStore.getState().targetChange).toEqual(change);
  });

  it('stays quiet on a backend without the table', async () => {
    routeTables({});
    await expect(useAppStore.getState().fetchTargetChange()).resolves.toBeUndefined();
    expect(useAppStore.getState().targetChange).toBeNull();
  });

  it('keeps what is shown when the read fails', async () => {
    useAppStore.setState({ targetChange: change });
    routeTables({ macro_target_changes: chain({ maybeSingle: () => ({ data: null, error: { message: 'offline' } }) }) });

    await useAppStore.getState().fetchTargetChange();

    expect(useAppStore.getState().targetChange).toBe(change);
  });
});

describe('undoTargetChange', () => {
  const current: MacroTarget = { ...previous, calories: 2600, carbs: 325 };

  it('puts the old target back, still adaptive, only while the change is in force', async () => {
    useAppStore.setState({ macroTarget: current, targetChange: change });
    const targets = chain({ maybeSingle: () => ({ data: { ...previous, updated_at: 'now' }, error: null }) });
    const changes = chain({ single: () => ({ data: { ...change, undone_at: changes.update.mock.calls[0][0].undone_at }, error: null }) });
    routeTables({ macro_targets: targets, macro_target_changes: changes });

    await expect(useAppStore.getState().undoTargetChange(change)).resolves.toBe(true);

    expect(targets.update).toHaveBeenCalledWith(expect.objectContaining({ calories: 2500, protein: 150, carbs: 300, fat: 70, source: 'adaptive' }));
    expect(targets.neq).toHaveBeenCalledWith('source', 'manual');
    expect(targets.eq).toHaveBeenCalledWith('calories', 2600);
    expect(targets.eq).toHaveBeenCalledWith('carbs', 325);
    expect(useAppStore.getState().macroTarget?.calories).toBe(2500);
    expect(useAppStore.getState().targetChange?.undone_at).toEqual(expect.any(String));
  });

  it('changes nothing when the target moved on since', async () => {
    useAppStore.setState({ macroTarget: { ...current, source: 'manual' }, targetChange: change });
    const targets = chain();
    const changes = chain();
    routeTables({ macro_targets: targets, macro_target_changes: changes });

    await expect(useAppStore.getState().undoTargetChange(change)).resolves.toBe(false);

    expect(changes.update).not.toHaveBeenCalled();
    expect(useAppStore.getState().targetChange).toBe(change);
  });

  it('keeps the old target when only the undone mark fails', async () => {
    useAppStore.setState({ macroTarget: current, targetChange: change });
    const targets = chain({ maybeSingle: () => ({ data: previous, error: null }) });
    const changes = chain({ single: () => ({ data: null, error: { message: 'offline' } }) });
    routeTables({ macro_targets: targets, macro_target_changes: changes });

    await expect(useAppStore.getState().undoTargetChange(change)).resolves.toBe(true);

    expect(useAppStore.getState().macroTarget).toEqual(previous);
    expect(useAppStore.getState().targetChange?.undone_at).toEqual(expect.any(String));
  });

  it('throws when the target save fails, changing nothing', async () => {
    useAppStore.setState({ macroTarget: current, targetChange: change });
    routeTables({ macro_targets: chain({ maybeSingle: () => ({ data: null, error: { message: 'offline' } }) }), macro_target_changes: chain() });

    await expect(useAppStore.getState().undoTargetChange(change)).rejects.toBeTruthy();
    expect(useAppStore.getState().macroTarget).toBe(current);
  });
});

describe('readBurnProgress', () => {
  it('counts logged days and weigh-ins the way the estimate does', async () => {
    useAppStore.setState({ nutritionProfile: profile });
    dataMock.getLatestBodyWeight.mockResolvedValue({ kilograms: 65 });
    dataMock.getBodyWeightHistorySince.mockResolvedValue(
      Array.from({ length: 6 }, (_, i) => ({ measured_at: dayOffset(-i, 7).toISOString(), kilograms: 65 })),
    );
    dataMock.getDailyIntake.mockResolvedValue(
      Array.from({ length: 9 }, (_, i) => ({ date: localIsoDate(dayOffset(-1 - i)), calories: 2800 })),
    );

    await expect(useAppStore.getState().readBurnProgress()).resolves.toEqual({ loggedDays: 9, weighInDays: 6 });
  });

  it('answers null when the reads fail', async () => {
    useAppStore.setState({ nutritionProfile: profile });
    dataMock.getLatestBodyWeight.mockRejectedValue(new Error('offline'));
    await expect(useAppStore.getState().readBurnProgress()).resolves.toBeNull();
  });
});
