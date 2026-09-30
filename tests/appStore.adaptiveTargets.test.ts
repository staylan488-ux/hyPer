import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MacroTarget } from '@/types';

const supabaseMock = vi.hoisted(() => ({
  from: vi.fn(),
  auth: {
    getUser: vi.fn(),
  },
}));

vi.mock('@/lib/supabase', () => ({
  supabase: supabaseMock,
}));

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

import { useAppStore } from '@/stores/appStore';
import type { NutritionProfile } from '@/lib/nutritionProfile';
import { localIsoDate } from '@/lib/weightTrend';

type Chain = {
  update: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  neq: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
};

function createChain(overrides: Partial<Chain> = {}): Chain {
  const chain = {
    update: vi.fn(),
    upsert: vi.fn(),
    insert: vi.fn(),
    eq: vi.fn(),
    neq: vi.fn(),
    select: vi.fn(),
    single: vi.fn(),
    maybeSingle: vi.fn(),
  } as Chain;

  chain.update.mockImplementation(() => chain);
  chain.upsert.mockImplementation(() => chain);
  chain.insert.mockImplementation(() => chain);
  chain.eq.mockImplementation(() => chain);
  chain.neq.mockImplementation(() => chain);
  chain.select.mockImplementation(() => chain);
  chain.single.mockResolvedValue({ data: null, error: null });
  chain.maybeSingle.mockResolvedValue({ data: null, error: null });

  Object.assign(chain, overrides);
  return chain;
}

const manualTarget: MacroTarget = {
  id: 'macro-1',
  user_id: 'user-1',
  calories: 2100,
  protein: 170,
  carbs: 200,
  fat: 70,
  source: 'manual',
  updated_at: '2026-09-01T10:00:00.000Z',
};

function dayOffset(days: number, hour = 12): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, hour, 0, 0);
}

const adaptiveProfile: NutritionProfile = {
  user_id: 'user-1',
  sex: 'male',
  birth_year: 1990,
  height_cm: 180,
  body_fat_pct: null,
  activity: 'moderately_active',
  goal: 'maintain',
  rate_pct_per_week: 0,
  unit_system: 'metric',
  adaptive_enabled: true,
  phase_started_on: localIsoDate(dayOffset(-90)),
  expenditure_kcal: null,
  expenditure_confidence: null,
  expenditure_updated_at: null,
  updated_at: '2026-01-01T00:00:00.000Z',
};

/** Three weeks of steady logging and flat weigh-ins: enough to measure. */
function seedMeasurableData() {
  dataMock.getLatestBodyWeight.mockResolvedValue({ kilograms: 80 });
  dataMock.getBodyWeightHistorySince.mockResolvedValue(
    Array.from({ length: 22 }, (_, i) => ({
      measured_at: dayOffset(-21 + i, 7).toISOString(),
      kilograms: 80,
    }))
  );
  dataMock.getDailyIntake.mockResolvedValue(
    Array.from({ length: 22 }, (_, i) => ({
      date: localIsoDate(dayOffset(-21 + i)),
      calories: 2600,
    }))
  );
}

/** Echoes a nutrition_profiles write back as the saved row. */
function profilesTable() {
  const chain = createChain();
  let written: Record<string, unknown> = {};
  const capture = (row: Record<string, unknown>) => {
    written = { ...adaptiveProfile, ...row };
    return chain;
  };
  chain.upsert.mockImplementation(capture);
  chain.update.mockImplementation(capture);
  chain.single.mockImplementation(async () => ({ data: written, error: null }));
  return chain;
}

type Result = { data: unknown; error: unknown };

/**
 * macro_targets with separate answers for the guarded update and the
 * insert-if-absent, since both end in maybeSingle.
 */
function macroTargetsTable(results: { update?: Result; insert?: Result } = {}) {
  const chain = createChain();
  let op: 'update' | 'upsert' | null = null;
  chain.update.mockImplementation(() => { op = 'update'; return chain; });
  chain.upsert.mockImplementation(() => { op = 'upsert'; return chain; });
  chain.maybeSingle.mockImplementation(async () =>
    op === 'update'
      ? results.update ?? { data: null, error: null }
      : results.insert ?? { data: null, error: null }
  );
  return chain;
}

function routeTables(tables: Record<string, Chain>) {
  supabaseMock.from.mockImplementation((table: string) => {
    const chain = tables[table];
    if (!chain) throw new Error(`Unexpected table: ${table}`);
    return chain;
  });
}

beforeEach(() => {
  supabaseMock.from.mockReset();
  supabaseMock.auth.getUser.mockReset();
  supabaseMock.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
  dataMock.getLatestBodyWeight.mockReset();
  dataMock.getBodyWeightHistorySince.mockReset();
  dataMock.getDailyIntake.mockReset();

  useAppStore.setState({ macroTarget: null, nutritionProfile: null });
});

describe('fetchMacroTarget', () => {
  it('clears a leftover target when the read succeeds with no row', async () => {
    useAppStore.setState({ macroTarget: manualTarget });
    const chain = createChain();
    supabaseMock.from.mockImplementation(() => chain);

    await useAppStore.getState().fetchMacroTarget();

    expect(useAppStore.getState().macroTarget).toBeNull();
  });

  it('keeps the shown target when the read fails', async () => {
    useAppStore.setState({ macroTarget: manualTarget });
    const chain = createChain({
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { message: 'network' } }),
    });
    supabaseMock.from.mockImplementation(() => chain);

    await useAppStore.getState().fetchMacroTarget();

    expect(useAppStore.getState().macroTarget).toBe(manualTarget);
  });

  it('stores the row when one exists', async () => {
    const chain = createChain({
      maybeSingle: vi.fn().mockResolvedValue({ data: manualTarget, error: null }),
    });
    supabaseMock.from.mockImplementation(() => chain);

    await useAppStore.getState().fetchMacroTarget();

    expect(useAppStore.getState().macroTarget).toEqual(manualTarget);
  });
});

describe('refreshAdaptiveTargets never overwrites a manual target', () => {
  const adaptiveRow = (source: string): MacroTarget => ({
    ...manualTarget,
    calories: 2600,
    source: source as MacroTarget['source'],
  });

  beforeEach(() => {
    seedMeasurableData();
    useAppStore.setState({ nutritionProfile: adaptiveProfile });
  });

  it('leaves a manual row alone after a failed read left the store empty', async () => {
    const macroTargets = macroTargetsTable();
    routeTables({ nutrition_profiles: profilesTable(), macro_targets: macroTargets });

    await useAppStore.getState().refreshAdaptiveTargets();

    expect(macroTargets.neq).toHaveBeenCalledWith('source', 'manual');
    // Only the insert-if-absent form is ever used; a plain upsert would overwrite.
    expect(macroTargets.upsert).toHaveBeenCalledTimes(1);
    expect(macroTargets.upsert.mock.calls[0][1]).toEqual({ onConflict: 'user_id', ignoreDuplicates: true });
    expect(useAppStore.getState().macroTarget).toBeNull();
  });

  it('updates a non-manual row in place and stores it', async () => {
    const row = adaptiveRow('adaptive');
    const macroTargets = macroTargetsTable({ update: { data: row, error: null } });
    routeTables({ nutrition_profiles: profilesTable(), macro_targets: macroTargets });

    await useAppStore.getState().refreshAdaptiveTargets();

    expect(macroTargets.update).toHaveBeenCalledWith(expect.objectContaining({ source: 'adaptive' }));
    expect(macroTargets.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(macroTargets.neq).toHaveBeenCalledWith('source', 'manual');
    expect(macroTargets.upsert).not.toHaveBeenCalled();
    expect(useAppStore.getState().macroTarget).toEqual(row);
  });

  it('inserts a first target when no row exists', async () => {
    const row = adaptiveRow('adaptive');
    const macroTargets = macroTargetsTable({ insert: { data: row, error: null } });
    routeTables({ nutrition_profiles: profilesTable(), macro_targets: macroTargets });

    await useAppStore.getState().refreshAdaptiveTargets();

    expect(macroTargets.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-1', source: 'adaptive' }),
      { onConflict: 'user_id', ignoreDuplicates: true }
    );
    expect(useAppStore.getState().macroTarget).toEqual(row);
  });

  it('skips macro_targets entirely when the store already says manual', async () => {
    useAppStore.setState({ macroTarget: manualTarget });
    const macroTargets = macroTargetsTable();
    routeTables({ nutrition_profiles: profilesTable(), macro_targets: macroTargets });

    await useAppStore.getState().refreshAdaptiveTargets();

    expect(supabaseMock.from).not.toHaveBeenCalledWith('macro_targets');
    expect(useAppStore.getState().macroTarget).toBe(manualTarget);
  });

  it('still writes adaptive values after Resume hands the target back', async () => {
    // Resume saves source 'calculated', then forces a refresh inside the week.
    useAppStore.setState({
      macroTarget: adaptiveRow('calculated'),
      nutritionProfile: { ...adaptiveProfile, expenditure_updated_at: new Date().toISOString() },
    });
    const row = adaptiveRow('adaptive');
    const macroTargets = macroTargetsTable({ update: { data: row, error: null } });
    routeTables({ nutrition_profiles: profilesTable(), macro_targets: macroTargets });

    await useAppStore.getState().refreshAdaptiveTargets({ force: true });

    expect(macroTargets.update).toHaveBeenCalledWith(expect.objectContaining({ source: 'adaptive' }));
    expect(useAppStore.getState().macroTarget).toEqual(row);
  });
});
