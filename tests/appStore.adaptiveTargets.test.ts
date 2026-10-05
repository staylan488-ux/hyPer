import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MacroTarget } from '@/types';

const supabaseMock = vi.hoisted(() => ({
  from: vi.fn(),
  auth: {
    getUser: vi.fn(),
    getSession: vi.fn(),
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

import { useAppStore, resetAppData } from '@/stores/appStore';
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

/** A one-row nutrition_profiles table; every write merges and echoes the row. */
function profilesTable() {
  const chain = createChain() as Chain & { row: Record<string, unknown> };
  chain.row = { ...adaptiveProfile };
  const capture = (fields: Record<string, unknown>) => {
    chain.row = { ...chain.row, ...fields };
    return chain;
  };
  chain.upsert.mockImplementation(capture);
  chain.update.mockImplementation(capture);
  chain.single.mockImplementation(async () => ({ data: chain.row, error: null }));
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
  supabaseMock.auth.getSession.mockReset();
  supabaseMock.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } } });
  dataMock.getLatestBodyWeight.mockReset();
  dataMock.getBodyWeightHistorySince.mockReset();
  dataMock.getDailyIntake.mockReset();

  resetAppData();
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

describe('refreshAdaptiveTargets write order and status', () => {
  beforeEach(() => {
    seedMeasurableData();
    useAppStore.setState({ nutritionProfile: adaptiveProfile });
  });

  const tablesInOrder = () => supabaseMock.from.mock.calls.map(([table]) => table as string);

  it('leaves the profile unstamped when the target write fails, so the next visit retries', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const profiles = profilesTable();
    const macroTargets = macroTargetsTable({ update: { data: null, error: { message: 'offline' } } });
    routeTables({ nutrition_profiles: profiles, macro_targets: macroTargets });

    await expect(useAppStore.getState().refreshAdaptiveTargets()).resolves.toBe('failed');

    expect(profiles.upsert).not.toHaveBeenCalled();
    expect(profiles.update).not.toHaveBeenCalled();
    expect(useAppStore.getState().nutritionProfile?.expenditure_updated_at).toBeNull();
    expect(warn).toHaveBeenCalledWith('[adaptive] refresh failed', expect.anything());
    warn.mockRestore();
  });

  it('writes the adaptive target first, then stamps the profile', async () => {
    const macroTargets = macroTargetsTable({
      update: { data: { ...manualTarget, source: 'adaptive' }, error: null },
    });
    const profiles = profilesTable();
    routeTables({ nutrition_profiles: profiles, macro_targets: macroTargets });

    await expect(useAppStore.getState().refreshAdaptiveTargets()).resolves.toBe('updated');

    expect(macroTargets.update).toHaveBeenCalledWith(expect.objectContaining({ source: 'adaptive' }));
    const order = tablesInOrder();
    expect(order.indexOf('macro_targets')).toBeLessThan(order.indexOf('nutrition_profiles'));
    expect(useAppStore.getState().nutritionProfile?.expenditure_updated_at).toEqual(expect.any(String));
    expect(useAppStore.getState().nutritionProfile?.expenditure_confidence).toBe('measured');
  });

  it('stamps the profile but leaves a manual target alone', async () => {
    useAppStore.setState({ macroTarget: manualTarget });
    routeTables({ nutrition_profiles: profilesTable(), macro_targets: macroTargetsTable() });

    await expect(useAppStore.getState().refreshAdaptiveTargets()).resolves.toBe('unchanged');

    expect(tablesInOrder()).toEqual(['nutrition_profiles']);
    expect(useAppStore.getState().macroTarget).toBe(manualTarget);
    expect(useAppStore.getState().nutritionProfile?.expenditure_updated_at).toEqual(expect.any(String));
  });

  it('stamps the profile but does not rewrite the target on a predicted estimate', async () => {
    dataMock.getDailyIntake.mockResolvedValue([]);
    routeTables({ nutrition_profiles: profilesTable(), macro_targets: macroTargetsTable() });

    await expect(useAppStore.getState().refreshAdaptiveTargets()).resolves.toBe('unchanged');

    expect(tablesInOrder()).toEqual(['nutrition_profiles']);
    expect(useAppStore.getState().nutritionProfile?.expenditure_confidence).toBe('predicted');
  });

  it('resolves failed rather than rejecting when the session lookup throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    supabaseMock.auth.getSession.mockRejectedValue(new Error('auth down'));

    await expect(useAppStore.getState().refreshAdaptiveTargets()).resolves.toBe('failed');
    expect(supabaseMock.from).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('skips without a weigh-in', async () => {
    dataMock.getLatestBodyWeight.mockResolvedValue(null);

    await expect(useAppStore.getState().refreshAdaptiveTargets()).resolves.toBe('skipped');
    expect(supabaseMock.from).not.toHaveBeenCalled();
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe('refreshAdaptiveTargets against concurrent edits', () => {
  beforeEach(() => {
    seedMeasurableData();
    useAppStore.setState({ nutritionProfile: adaptiveProfile });
  });

  it('writes only the expenditure columns', async () => {
    const profiles = profilesTable();
    routeTables({ nutrition_profiles: profiles, macro_targets: macroTargetsTable() });

    await useAppStore.getState().refreshAdaptiveTargets();

    expect(profiles.upsert).not.toHaveBeenCalled();
    expect(profiles.update).toHaveBeenCalledWith({
      expenditure_kcal: expect.any(Number),
      expenditure_confidence: 'measured',
      expenditure_updated_at: expect.any(String),
      updated_at: expect.any(String),
    });
    expect(profiles.eq).toHaveBeenCalledWith('user_id', 'user-1');
  });

  it('keeps a goal change made mid-refresh and writes nothing computed for the old goal', async () => {
    const intakeGate = deferred<unknown>();
    const intake = await dataMock.getDailyIntake();
    dataMock.getDailyIntake.mockReset();
    dataMock.getDailyIntake.mockReturnValue(intakeGate.promise);

    const profiles = profilesTable();
    const macroTargets = macroTargetsTable();
    routeTables({ nutrition_profiles: profiles, macro_targets: macroTargets });

    const refresh = useAppStore.getState().refreshAdaptiveTargets();
    await vi.waitFor(() => expect(dataMock.getDailyIntake).toHaveBeenCalled());

    const { expenditure_kcal, expenditure_confidence, expenditure_updated_at } = adaptiveProfile;
    await useAppStore.getState().updateNutritionProfile({
      sex: 'male',
      birth_year: 1990,
      height_cm: 180,
      body_fat_pct: null,
      activity: 'moderately_active',
      goal: 'cut',
      rate_pct_per_week: -0.5,
      unit_system: 'metric',
      adaptive_enabled: true,
      phase_started_on: adaptiveProfile.phase_started_on,
      expenditure_kcal,
      expenditure_confidence,
      expenditure_updated_at,
    });
    const phaseAfterEdit = useAppStore.getState().nutritionProfile?.phase_started_on;
    expect(phaseAfterEdit).not.toBe(adaptiveProfile.phase_started_on);

    intakeGate.resolve(intake);
    await expect(refresh).resolves.toBe('skipped');

    expect(supabaseMock.from).not.toHaveBeenCalledWith('macro_targets');
    expect(profiles.update).not.toHaveBeenCalled();
    for (const profile of [useAppStore.getState().nutritionProfile, profiles.row]) {
      expect(profile).toMatchObject({ goal: 'cut', rate_pct_per_week: -0.5, phase_started_on: phaseAfterEdit });
    }
  });

  it('does not replace a target saved while it ran', async () => {
    const intakeGate = deferred<unknown>();
    const intake = await dataMock.getDailyIntake();
    dataMock.getDailyIntake.mockReset();
    dataMock.getDailyIntake.mockReturnValue(intakeGate.promise);
    const macroTargets = macroTargetsTable();
    routeTables({ nutrition_profiles: profilesTable(), macro_targets: macroTargets });

    const refresh = useAppStore.getState().refreshAdaptiveTargets();
    await vi.waitFor(() => expect(dataMock.getDailyIntake).toHaveBeenCalled());
    useAppStore.setState({ macroTarget: manualTarget });
    intakeGate.resolve(intake);

    await expect(refresh).resolves.toBe('skipped');
    expect(macroTargets.update).not.toHaveBeenCalled();
    expect(macroTargets.upsert).not.toHaveBeenCalled();
    expect(useAppStore.getState().macroTarget).toBe(manualTarget);
  });

  it('keeps a manual target saved while the adaptive write was in flight', async () => {
    const calculated: MacroTarget = { ...manualTarget, source: 'calculated' };
    useAppStore.setState({ macroTarget: calculated });

    // The guarded update is held; the Settings save's upsert answers at once.
    const updateGate = deferred<Result>();
    const savedManual: MacroTarget = { ...manualTarget, updated_at: '2026-09-30T09:00:00.000Z' };
    const macroTargets = createChain({
      maybeSingle: vi.fn().mockReturnValue(updateGate.promise),
      single: vi.fn().mockResolvedValue({ data: savedManual, error: null }),
    });
    const profiles = profilesTable();
    routeTables({ nutrition_profiles: profiles, macro_targets: macroTargets });

    const refresh = useAppStore.getState().refreshAdaptiveTargets();
    await vi.waitFor(() => expect(macroTargets.maybeSingle).toHaveBeenCalled());

    await useAppStore.getState().updateMacroTarget({
      calories: savedManual.calories,
      protein: savedManual.protein,
      carbs: savedManual.carbs,
      fat: savedManual.fat,
      source: 'manual',
    });
    expect(useAppStore.getState().macroTarget).toEqual(savedManual);

    // The adaptive response arrives late, echoing the row as it was before.
    updateGate.resolve({ data: { ...calculated, calories: 2600, source: 'adaptive' }, error: null });

    await expect(refresh).resolves.toBe('updated');
    expect(useAppStore.getState().macroTarget).toEqual(savedManual);
    // The profile is still stamped, so the write is not retried next visit.
    expect(profiles.update).toHaveBeenCalledTimes(1);
  });

  it('shares one run between two concurrent unforced calls', async () => {
    const profiles = profilesTable();
    const macroTargets = macroTargetsTable({
      update: { data: { ...manualTarget, source: 'adaptive' }, error: null },
    });
    routeTables({ nutrition_profiles: profiles, macro_targets: macroTargets });

    const first = useAppStore.getState().refreshAdaptiveTargets();
    const second = useAppStore.getState().refreshAdaptiveTargets();

    expect(second).toBe(first);
    await expect(Promise.all([first, second])).resolves.toEqual(['updated', 'updated']);
    expect(dataMock.getLatestBodyWeight).toHaveBeenCalledTimes(1);
    expect(dataMock.getDailyIntake).toHaveBeenCalledTimes(1);
    expect(macroTargets.update).toHaveBeenCalledTimes(1);
    expect(profiles.update).toHaveBeenCalledTimes(1);
  });

  it('runs a fresh computation for a forced call made while one is in flight', async () => {
    const intakeGate = deferred<unknown>();
    const intake = await dataMock.getDailyIntake();
    dataMock.getDailyIntake.mockReset();
    dataMock.getDailyIntake.mockReturnValueOnce(intakeGate.promise).mockResolvedValue(intake);
    const profiles = profilesTable();
    const macroTargets = macroTargetsTable({
      update: { data: { ...manualTarget, source: 'adaptive' }, error: null },
    });
    routeTables({ nutrition_profiles: profiles, macro_targets: macroTargets });

    const unforced = useAppStore.getState().refreshAdaptiveTargets();
    const forced = useAppStore.getState().refreshAdaptiveTargets({ force: true });
    expect(forced).not.toBe(unforced);

    let forcedDone = false;
    void forced.then(() => { forcedDone = true; });
    await vi.waitFor(() => expect(dataMock.getDailyIntake).toHaveBeenCalledTimes(1));
    expect(forcedDone).toBe(false);

    intakeGate.resolve(intake);
    await expect(unforced).resolves.toBe('updated');
    await expect(forced).resolves.toBe('updated');

    // The forced call ran its own reads and writes after the first finished,
    // even though the first had just stamped the profile as fresh.
    expect(dataMock.getDailyIntake).toHaveBeenCalledTimes(2);
    expect(macroTargets.update).toHaveBeenCalledTimes(2);
    expect(profiles.update).toHaveBeenCalledTimes(2);
  });
});

describe('nutrition account isolation', () => {
  it('starts a new adaptive run after signing back in while the previous run is unresolved', async () => {
    seedMeasurableData();
    useAppStore.setState({ nutritionProfile: adaptiveProfile });
    const oldWeight = deferred<unknown>();
    dataMock.getLatestBodyWeight.mockReturnValueOnce(oldWeight.promise);
    routeTables({ nutrition_profiles: profilesTable(), macro_targets: macroTargetsTable() });
    const oldRun = useAppStore.getState().refreshAdaptiveTargets();
    await vi.waitFor(() => expect(dataMock.getLatestBodyWeight).toHaveBeenCalledTimes(1));
    resetAppData();
    useAppStore.setState({ nutritionProfile: adaptiveProfile });
    const newRun = useAppStore.getState().refreshAdaptiveTargets();
    expect(newRun).not.toBe(oldRun);
    await expect(newRun).resolves.toBe('unchanged');
    oldWeight.resolve({ kilograms: 80 });
    await expect(oldRun).resolves.toBe('skipped');
    expect(dataMock.getDailyIntake).toHaveBeenCalledTimes(1);
  });

  it('rejects a cached profile belonging to a different account before reading health data', async () => {
    useAppStore.setState({ nutritionProfile: { ...adaptiveProfile, user_id: 'old-user' } });
    await expect(useAppStore.getState().refreshAdaptiveTargets()).resolves.toBe('skipped');
    expect(dataMock.getLatestBodyWeight).not.toHaveBeenCalled();
  });

  it('does not insert a target after an account reset during the guarded update', async () => {
    seedMeasurableData();
    useAppStore.setState({ nutritionProfile: adaptiveProfile });
    const result = deferred<Result>();
    const targets = createChain({ maybeSingle: vi.fn().mockReturnValue(result.promise) });
    routeTables({ macro_targets: targets, nutrition_profiles: profilesTable() });
    const request = useAppStore.getState().refreshAdaptiveTargets();
    await vi.waitFor(() => expect(targets.update).toHaveBeenCalled());
    resetAppData();
    result.resolve({ data: null, error: null });
    await expect(request).resolves.toBe('skipped');
    expect(targets.upsert).not.toHaveBeenCalled();
  });

  it('keeps user B target when delayed user A fetch completes after account reset', async () => {
    const result = deferred<Result>();
    const chain = createChain({ maybeSingle: vi.fn().mockReturnValue(result.promise) });
    routeTables({ macro_targets: chain });
    const request = useAppStore.getState().fetchMacroTarget();
    await vi.waitFor(() => expect(chain.maybeSingle).toHaveBeenCalled());
    resetAppData();
    supabaseMock.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'user-2' } } } });
    const targetB = { ...manualTarget, id: 'macro-2', user_id: 'user-2', calories: 1800 };
    useAppStore.setState({ macroTarget: targetB });
    result.resolve({ data: manualTarget, error: null });
    await request;
    expect(useAppStore.getState().macroTarget).toEqual(targetB);
  });

  it('keeps user B profile when delayed user A fetch completes after account reset', async () => {
    const result = deferred<Result>();
    const chain = createChain({ maybeSingle: vi.fn().mockReturnValue(result.promise) });
    routeTables({ nutrition_profiles: chain });
    const request = useAppStore.getState().fetchNutritionProfile();
    await vi.waitFor(() => expect(chain.maybeSingle).toHaveBeenCalled());
    resetAppData();
    supabaseMock.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'user-2' } } } });
    const profileB = { ...adaptiveProfile, user_id: 'user-2', sex: 'female' as const, height_cm: 160 };
    useAppStore.setState({ nutritionProfile: profileB });
    result.resolve({ data: adaptiveProfile, error: null });
    await request;
    expect(useAppStore.getState().nutritionProfile).toEqual(profileB);
  });

  it('ignores adaptive response from old account when both accounts have no target', async () => {
    seedMeasurableData();
    useAppStore.setState({ nutritionProfile: adaptiveProfile, macroTarget: null });
    const result = deferred<Result>();
    const targets = createChain({ maybeSingle: vi.fn().mockReturnValue(result.promise) });
    const profiles = profilesTable();
    routeTables({ macro_targets: targets, nutrition_profiles: profiles });
    const request = useAppStore.getState().refreshAdaptiveTargets();
    await vi.waitFor(() => expect(targets.maybeSingle).toHaveBeenCalled());
    resetAppData();
    supabaseMock.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'user-2' } } } });
    result.resolve({ data: { ...manualTarget, source: 'adaptive' }, error: null });
    await request;
    expect(useAppStore.getState().macroTarget).toBeNull();
  });
});
