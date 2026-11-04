// @vitest-environment happy-dom
import { act, createElement, Fragment, useEffect, type ComponentType, type PropsWithChildren } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';

import * as dateFns from 'date-fns';

import { captureAccountScope } from '@/lib/accountScope';
import * as bodyWeightSummary from '@/lib/bodyWeightSummary';
import * as nutritionCalculator from '@/lib/nutritionCalculator';
import type { NutritionProfile } from '@/lib/nutritionProfile';
import * as nutritionWizard from '@/lib/nutritionWizard';
import * as settingsUx from '@/lib/settingsUx';
import * as weightDisplayCore from '@/lib/weightDisplayCore';
import { loadNativeModule } from './helpers/loadNativeModule';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Read = { data: unknown; error: unknown };
type HealthResult = { imported: number; latest: null };
type YouModule = {
  connectWhoop: () => Promise<{ ok: boolean; message: string } | null>;
  connectOrSyncHealth: () => Promise<boolean>;
  useHealthStore: { getState: () => { enabled: boolean; message: { text: string; alert?: boolean } | null } };
  useTargetsLoaded: (what: 'targets' | 'profile') => { loaded: boolean; failed: boolean; retry: () => void };
  stageTargets: (draft: settingsUx.TargetDraft) => void;
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

const saved = { id: 'macro-1', user_id: 'user-1', calories: 2400, protein: 180, carbs: 250, fat: 70, source: 'manual' };
const Wrap = ({ children }: PropsWithChildren) => createElement(Fragment, null, children);

/** The real lib/you.ts over in-memory stores; only device and backend boundaries are mocked. */
function youHarness() {
  const reads: Array<ReturnType<typeof deferred<Read>>> = [];
  const supabase = {
    from: vi.fn(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => {
            const read = deferred<Read>();
            reads.push(read);
            return read.promise;
          },
        }),
      }),
    })),
  };
  const health = {
    enabledFlag: false,
    connectOrSyncHealthWeights: vi.fn<(userId: string, enabled: boolean) => Promise<HealthResult>>(),
  };
  const preview = { active: false };
  const getNutritionProfile = vi.fn<(userId: string) => Promise<NutritionProfile | null>>(async () => null);
  const getBodyWeightHistorySince = vi.fn<(userId: string, days: number) => Promise<unknown[]>>(async () => []);
  const useAppStore = create(() => ({
    macroTarget: null as typeof saved | null,
    nutritionProfile: null,
    macroTargetLoadedForUserId: null as string | null,
    nutritionProfileLoadedForUserId: null as string | null,
    updateMacroTarget: vi.fn<(target: unknown) => Promise<void>>(async () => {}),
    updateNutritionProfile: vi.fn<(input: unknown) => Promise<void>>(async () => {}),
    connectWhoop: vi.fn<(returnTo: string) => Promise<string | null>>(async () => null),
    fetchWhoopConnection: vi.fn(async () => null),
    syncWhoop: vi.fn(async () => null),
  }));
  const useAuthStore = create(() => ({ user: { id: 'user-1' } as { id: string } | null }));
  const openAuthSessionAsync = vi.fn<(url: string, returnTo: string, options: unknown) => Promise<{ type: string; url?: string }>>(
    async () => ({ type: 'success', url: 'app.hyper.mobile://settings?whoop=connected' }),
  );
  const imports = {
    'expo-router': { router: { push: vi.fn() } },
    'expo-web-browser': { openAuthSessionAsync },
    'react-native': { Appearance: { setColorScheme: vi.fn() } },
    zustand: { create },
    '@/lib/accountScope': { captureAccountScope },
    '@/lib/foodTrial': { getFoodAnalysisMode: () => 'gemini', saveFoodAnalysisMode: vi.fn() },
    '@/lib/bodyWeightSummary': { WEIGHT_TREND_WINDOW_DAYS: 60 },
    '@/lib/healthWeights': {
      HEALTH_SYNC_STOPPED_MESSAGE: 'stopped',
      connectOrSyncHealthWeights: health.connectOrSyncHealthWeights,
      deleteManualBodyWeight: vi.fn(),
      getBodyWeightHistorySince,
      healthSyncMessage: () => 'Apple Health weight is up to date.',
      isHealthWeightSyncEnabled: () => health.enabledFlag,
      recordManualBodyWeight: vi.fn(),
      setHealthWeightSyncEnabled: (on: boolean) => { health.enabledFlag = on; },
    },
    '@/lib/mealComposition': { decodeMealComposition: () => null },
    '@/lib/nutritionProfile': { getNutritionProfile },
    '@/lib/savedMeals': { loadSavedMeals: vi.fn(async () => ({ meals: [], error: null })) },
    '@/lib/supabase': { supabase },
    '@/lib/weightDisplayCore': { getPreferredWeightUnit: () => 'lb', setPreferredWeightUnit: vi.fn() },
    '@/lib/whoopStatus': {
      whoopCallbackStatus: (url: string) => (url.includes('whoop=connected') ? 'connected' : 'error'),
    },
    '@/stores/appStore': { useAppStore },
    '@/stores/authStore': { useAuthStore },
    '~/platform/previewFlag': { isPreviewActive: () => preview.active },
  };
  const you = loadNativeModule<YouModule>('lib/you.ts', imports);
  return { you, reads, health, preview, useAppStore, useAuthStore, openAuthSessionAsync, imports, getNutritionProfile, getBodyWeightHistorySince };
}

let root: Root | null = null;
async function mount(element: ReturnType<typeof createElement>) {
  root = createRoot(document.createElement('div'));
  await act(async () => { root!.render(element); });
}

afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
});

describe('You waits for the saved targets before starting from them', () => {
  it('reads the targets once when they are not read for this account, and reports when they are', async () => {
    const { you, reads, useAppStore } = youHarness();
    const seen: Array<{ loaded: boolean; failed: boolean }> = [];
    function Probe() {
      const state = you.useTargetsLoaded('targets');
      useEffect(() => { seen.push({ loaded: state.loaded, failed: state.failed }); });
      return null;
    }
    await mount(createElement(Probe));
    expect(reads).toHaveLength(1);
    expect(seen.at(-1)).toEqual({ loaded: false, failed: false });

    await act(async () => { reads[0].resolve({ data: saved, error: null }); });
    expect(useAppStore.getState()).toMatchObject({ macroTarget: saved, macroTargetLoadedForUserId: 'user-1' });
    expect(seen.at(-1)).toEqual({ loaded: true, failed: false });
    expect(reads).toHaveLength(1);
  });

  it('says when the read failed and reads again on retry', async () => {
    const { you, reads } = youHarness();
    let latest!: ReturnType<YouModule['useTargetsLoaded']>;
    function Probe() {
      latest = you.useTargetsLoaded('profile');
      return null;
    }
    await mount(createElement(Probe));
    await act(async () => { reads[0].resolve({ data: null, error: new Error('offline') }); });
    expect(latest).toMatchObject({ loaded: false, failed: true });

    await act(async () => { latest.retry(); });
    expect(reads).toHaveLength(2);
    expect(latest.failed).toBe(false);
    await act(async () => { reads[1].resolve({ data: null, error: null }); });
    expect(latest).toMatchObject({ loaded: true, failed: false });
  });

  it('does not read again when the targets are already read for this account', async () => {
    const { you, reads, useAppStore } = youHarness();
    useAppStore.setState({ macroTarget: saved, macroTargetLoadedForUserId: 'user-1' });
    function Probe() {
      you.useTargetsLoaded('targets');
      return null;
    }
    await mount(createElement(Probe));
    expect(reads).toHaveLength(0);
  });
});

describe('Edit targets opened before the targets are read', () => {
  type FieldProps = { label: string; value: string; editable?: boolean; autoFocus?: boolean; onChangeText: (text: string) => void; ref?: (node: unknown) => void };
  type ButtonProps = { title: string; busy?: boolean; disabled?: boolean; onPress: () => void };

  function sheetHarness(focus?: string) {
    const harness = youHarness();
    const fields: Record<string, FieldProps> = {};
    const buttons: Record<string, ButtonProps> = {};
    const focused: string[] = [];
    const text = ({ children }: PropsWithChildren) => createElement('span', null, children);
    const Sheet = loadNativeModule<{ default: ComponentType }>('app/targets-edit.tsx', {
      'expo-router': { router: { back: vi.fn() }, useLocalSearchParams: () => ({ focus }) },
      'react-native': { Keyboard: { dismiss: vi.fn() }, View: Wrap },
      'react-native-keyboard-controller': { KeyboardAwareScrollView: Wrap },
      '@/lib/settingsUx': settingsUx,
      '@/stores/appStore': { useAppStore: harness.useAppStore },
      '~/components/BlancText': { BlancText: text },
      '~/components/Capsule': { Capsule: (props: ButtonProps) => { buttons[props.title] = props; return null; } },
      '~/components/Form': {
        FieldRow: (props: FieldProps) => {
          fields[props.label] = props;
          props.ref?.({ focus: () => focused.push(props.label) });
          return null;
        },
        FormNote: text,
      },
      '~/components/GlassButton': { GlassButton: () => null },
      '~/components/Label': { Label: Wrap },
      '~/components/Row': { Hairline: () => null },
      '~/components/Section': { Section: Wrap },
      '~/lib/format': { formatWhole: (value: number) => String(Math.round(value)) },
      '~/lib/haptics': { haptics: { success: vi.fn(), error: vi.fn() } },
      '~/lib/leaveGuard': { useLeaveGuard: vi.fn() },
      '~/lib/you': harness.you,
      '~/theme/blanc': { useBlanc: () => ({ ground: '#fff' }) },
    }).default;
    return { ...harness, Sheet, fields, buttons, focused };
  }

  it('holds the fields and Save until the read, then starts from the saved targets', async () => {
    const { Sheet, reads, fields, buttons, useAppStore } = sheetHarness();
    await mount(createElement(Sheet));

    expect(fields.Calories).toMatchObject({ value: '', editable: false });
    expect(buttons['Save targets'].busy).toBe(true);
    await act(async () => { reads[0].resolve({ data: saved, error: null }); });

    expect(fields.Calories).toMatchObject({ value: '2400', editable: true });
    expect(fields.Protein.value).toBe('180');
    expect(buttons['Save targets']).toMatchObject({ busy: false, disabled: true });

    await act(async () => { fields.Protein.onChangeText('190'); });
    await act(async () => { buttons['Save targets'].onPress(); });
    expect(useAppStore.getState().updateMacroTarget).toHaveBeenCalledWith(
      expect.objectContaining({ calories: 2400, protein: 190, carbs: 250, fat: 70 }),
    );
  });

  it('lets a cleared field stay empty while a new number is typed, and saves only with a number in it', async () => {
    const { Sheet, reads, fields, buttons, useAppStore } = sheetHarness();
    await mount(createElement(Sheet));
    await act(async () => { reads[0].resolve({ data: saved, error: null }); });

    await act(async () => { fields.Calories.onChangeText(''); });
    expect(fields.Calories.value).toBe('');
    expect(buttons['Save targets'].disabled).toBe(true);
    await act(async () => { buttons['Save targets'].onPress(); });
    expect(useAppStore.getState().updateMacroTarget).not.toHaveBeenCalled();

    await act(async () => { fields.Calories.onChangeText('2'); });
    expect(fields.Calories.value).toBe('2');
    await act(async () => { fields.Calories.onChangeText('2300'); });
    expect(buttons['Save targets'].disabled).toBe(false);
    await act(async () => { buttons['Save targets'].onPress(); });
    expect(useAppStore.getState().updateMacroTarget).toHaveBeenCalledWith(expect.objectContaining({ calories: 2300 }));
  });

  it('still saves a 0 that was typed', async () => {
    const { Sheet, reads, fields, buttons, useAppStore } = sheetHarness();
    await mount(createElement(Sheet));
    await act(async () => { reads[0].resolve({ data: saved, error: null }); });

    await act(async () => { fields.Fat.onChangeText('0'); });
    expect(fields.Fat.value).toBe('0');
    await act(async () => { buttons['Save targets'].onPress(); });
    expect(useAppStore.getState().updateMacroTarget).toHaveBeenCalledWith(expect.objectContaining({ fat: 0 }));
  });

  it('puts the cursor in the field it was opened from once the targets arrive', async () => {
    const { Sheet, reads, fields, focused } = sheetHarness('protein');
    await mount(createElement(Sheet));
    expect(fields.Protein.autoFocus).toBe(false);
    expect(focused).toEqual([]);

    await act(async () => { reads[0].resolve({ data: saved, error: null }); });
    expect(focused).toEqual(['Protein']);
  });

  it('offers Try again instead of Save when the read fails', async () => {
    const { Sheet, reads, buttons } = sheetHarness();
    await mount(createElement(Sheet));
    await act(async () => { reads[0].resolve({ data: null, error: new Error('offline') }); });

    expect(buttons['Try again']).toBeDefined();
    await act(async () => { buttons['Try again'].onPress(); });
    expect(reads).toHaveLength(2);
  });

  it('opens at once with numbers the calculator or coach suggested', async () => {
    const { Sheet, fields, buttons, you } = sheetHarness();
    you.stageTargets({ calories: 2600, protein: 190, carbs: 280, fat: 75, source: 'calculated' });
    await mount(createElement(Sheet));

    expect(fields.Calories).toMatchObject({ value: '2600', editable: true });
    expect(buttons['Save targets'].busy).toBe(false);
  });
});

describe('Calculate targets opened before the profile is read', () => {
  const profile: NutritionProfile = {
    user_id: 'user-1', sex: 'male', birth_year: new Date().getFullYear() - 34, height_cm: 180, body_fat_pct: null,
    activity: 'moderately_active', goal: 'cut', rate_pct_per_week: -0.5, unit_system: 'metric',
    adaptive_enabled: true, phase_started_on: '2026-09-01', expenditure_kcal: 2850,
    expenditure_confidence: 'learning', expenditure_updated_at: '2026-10-30',
  };
  type FieldProps = { label: string; value: string };
  type ButtonProps = { title: string; disabled?: boolean; onPress: () => void };

  function calculatorHarness() {
    const harness = youHarness();
    const fields: Record<string, FieldProps> = {};
    const buttons: Record<string, ButtonProps> = {};
    const spinner = vi.fn();
    const recordManualBodyWeight = vi.fn<(userId: string, kilograms: number) => Promise<void>>(async () => {});
    const text = ({ children }: PropsWithChildren) => createElement('span', null, children);
    const Sheet = loadNativeModule<{ default: ComponentType }>('app/targets-calculate.tsx', {
      '@expo/ui/swift-ui': { Host: Wrap, Picker: Wrap, Text: Wrap },
      '@expo/ui/swift-ui/modifiers': { pickerStyle: () => null, tag: () => null },
      'expo-router': { router: { back: vi.fn(), replace: vi.fn() } },
      'expo-symbols': { SymbolView: () => null },
      'react-native': {
        ActivityIndicator: () => { spinner(); return null; },
        Keyboard: { dismiss: vi.fn() },
        Pressable: Wrap,
        ScrollView: Wrap,
        TextInput: () => null,
        View: Wrap,
      },
      '@/lib/healthWeights': { recordManualBodyWeight },
      '@/lib/nutritionCalculator': nutritionCalculator,
      '@/lib/nutritionWizard': nutritionWizard,
      '@/stores/appStore': { useAppStore: harness.useAppStore },
      '@/stores/authStore': { useAuthStore: harness.useAuthStore },
      '~/components/BlancText': { BlancText: text },
      '~/components/Capsule': { Capsule: (props: ButtonProps) => { buttons[props.title] = props; return null; } },
      '~/components/Form': { FieldRow: (props: FieldProps) => { fields[props.label] = props; return null; }, FormNote: text },
      '~/components/GlassButton': { GlassButton: () => null },
      '~/components/Label': { Label: Wrap },
      '~/components/Row': { Hairline: () => null, Row: () => null },
      '~/components/Section': { Section: Wrap },
      '~/lib/format': { formatWhole: (value: number) => String(Math.round(value)) },
      '~/lib/haptics': { haptics: { success: vi.fn(), error: vi.fn(), select: vi.fn() } },
      '~/lib/leaveGuard': { useLeaveGuard: vi.fn() },
      '~/lib/you': harness.you,
      '~/theme/blanc': { type: { field: {} }, useBlanc: () => ({ ground: '#fff', ink: '#000', pressed: '#eee', fill: '#ddd' }) },
    }).default;
    return { ...harness, Sheet, fields, buttons, spinner, recordManualBodyWeight };
  }

  it('waits for the saved profile, then keeps its learned burn when saved', async () => {
    const { Sheet, reads, fields, buttons, spinner, useAppStore, getNutritionProfile, getBodyWeightHistorySince } = calculatorHarness();
    getNutritionProfile.mockResolvedValue(profile);
    getBodyWeightHistorySince.mockResolvedValue([{ id: 'w1', kilograms: 82, measured_at: '2026-11-03T07:00:00Z', source: 'manual' }]);
    await mount(createElement(Sheet));

    expect(fields.Age).toBeUndefined();
    expect(spinner).toHaveBeenCalled();
    await act(async () => { reads[0].resolve({ data: saved, error: null }); });

    expect(fields.Age.value).toBe('34');
    expect(fields.Weight.value).toBe('82');
    expect(fields.Height.value).toBe('180');
    await act(async () => { buttons['Save profile and review'].onPress(); });
    expect(useAppStore.getState().updateNutritionProfile).toHaveBeenCalledWith(
      expect.objectContaining({ expenditure_kcal: 2850, expenditure_confidence: 'learning', phase_started_on: '2026-09-01' }),
    );
  });

  it('keeps what was typed when the weights are read again', async () => {
    const { Sheet, reads, fields, you } = calculatorHarness();
    await mount(createElement(Sheet));
    await act(async () => { reads[0].resolve({ data: saved, error: null }); });
    await act(async () => { (fields.Age as FieldProps & { onChangeText: (text: string) => void }).onChangeText('40'); });

    await act(async () => { await (you as unknown as { loadWeights: () => Promise<void> }).loadWeights(); });
    expect(fields.Age.value).toBe('40');
  });

  it('records no weigh-in when an Apple Health import lands while it is open and the weight is left alone', async () => {
    const { Sheet, reads, fields, buttons, you, getNutritionProfile, getBodyWeightHistorySince, recordManualBodyWeight } = calculatorHarness();
    getNutritionProfile.mockResolvedValue(profile);
    getBodyWeightHistorySince.mockResolvedValue([{ id: 'w1', kilograms: 81, measured_at: '2026-11-03T07:00:00Z', source: 'manual' }]);
    await mount(createElement(Sheet));
    await act(async () => { reads[0].resolve({ data: saved, error: null }); });
    expect(fields.Weight.value).toBe('81');

    getBodyWeightHistorySince.mockResolvedValue([
      { id: 'w2', kilograms: 80.4, measured_at: '2026-11-04T07:00:00Z', source: 'healthkit' },
      { id: 'w1', kilograms: 81, measured_at: '2026-11-03T07:00:00Z', source: 'manual' },
    ]);
    await act(async () => { await (you as unknown as { loadWeights: () => Promise<void> }).loadWeights(); });
    expect(fields.Weight.value).toBe('81');

    await act(async () => { buttons['Save profile and review'].onPress(); });
    expect(recordManualBodyWeight).not.toHaveBeenCalled();
  });

  it('records a weigh-in when the weight is changed', async () => {
    const { Sheet, reads, fields, buttons, getNutritionProfile, getBodyWeightHistorySince, recordManualBodyWeight } = calculatorHarness();
    getNutritionProfile.mockResolvedValue(profile);
    getBodyWeightHistorySince.mockResolvedValue([{ id: 'w1', kilograms: 81, measured_at: '2026-11-03T07:00:00Z', source: 'manual' }]);
    await mount(createElement(Sheet));
    await act(async () => { reads[0].resolve({ data: saved, error: null }); });

    await act(async () => { (fields.Weight as FieldProps & { onChangeText: (text: string) => void }).onChangeText('79.5'); });
    await act(async () => { buttons['Save profile and review'].onPress(); });
    expect(recordManualBodyWeight).toHaveBeenCalledWith('user-1', 79.5);
  });

  it('records no made-up weigh-in when the weights did not load and the default weight is left alone', async () => {
    const { Sheet, reads, fields, buttons, useAppStore, getNutritionProfile, getBodyWeightHistorySince, recordManualBodyWeight } = calculatorHarness();
    getNutritionProfile.mockResolvedValue(profile);
    getBodyWeightHistorySince.mockRejectedValue(new Error('offline'));
    await mount(createElement(Sheet));
    await act(async () => { reads[0].resolve({ data: saved, error: null }); });
    expect(fields.Weight.value).toBe('77');

    await act(async () => { buttons['Save profile and review'].onPress(); });
    expect(useAppStore.getState().updateNutritionProfile).toHaveBeenCalled();
    expect(recordManualBodyWeight).not.toHaveBeenCalled();
  });

  it('still records a weight typed after the weights did not load', async () => {
    const { Sheet, reads, fields, buttons, getNutritionProfile, getBodyWeightHistorySince, recordManualBodyWeight } = calculatorHarness();
    getNutritionProfile.mockResolvedValue(profile);
    getBodyWeightHistorySince.mockRejectedValue(new Error('offline'));
    await mount(createElement(Sheet));
    await act(async () => { reads[0].resolve({ data: saved, error: null }); });

    await act(async () => { (fields.Weight as FieldProps & { onChangeText: (text: string) => void }).onChangeText('80,5'); });
    await act(async () => { buttons['Save profile and review'].onPress(); });
    expect(recordManualBodyWeight).toHaveBeenCalledWith('user-1', 80.5);
  });

  it('offers Try again when the profile does not load', async () => {
    const { Sheet, reads, buttons, fields } = calculatorHarness();
    await mount(createElement(Sheet));
    await act(async () => { reads[0].resolve({ data: null, error: new Error('offline') }); });

    expect(fields.Age).toBeUndefined();
    await act(async () => { buttons['Try again'].onPress(); });
    expect(reads).toHaveLength(2);
  });
});

describe('Apple Health switch after a failed first sync', () => {
  it('stays on when access was granted and only the first sync failed', async () => {
    const { you, health } = youHarness();
    health.connectOrSyncHealthWeights.mockImplementation(async () => {
      health.enabledFlag = true; // access granted, then the upload failed
      throw new Error('Network request failed');
    });

    await expect(you.connectOrSyncHealth()).resolves.toBe(false);
    expect(you.useHealthStore.getState()).toMatchObject({
      enabled: true,
      message: { text: 'Network request failed', alert: true },
    });
  });

  it('stays off when access was not granted', async () => {
    const { you, health } = youHarness();
    health.connectOrSyncHealthWeights.mockRejectedValue(new Error('Apple Health is unavailable on this device.'));

    await you.connectOrSyncHealth();
    expect(you.useHealthStore.getState().enabled).toBe(false);
  });
});

describe('Connecting WHOOP', () => {
  it('starts the first import once connected', async () => {
    const { you, useAppStore } = youHarness();
    useAppStore.getState().connectWhoop.mockResolvedValue('https://api.prod.whoop.com/oauth');

    await expect(you.connectWhoop()).resolves.toEqual({ ok: true, message: 'WHOOP connected.' });
    expect(useAppStore.getState().fetchWhoopConnection).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().syncWhoop).toHaveBeenCalledTimes(1);
  });

  it('starts no import when the sign-in sheet is closed or fails', async () => {
    const { you, useAppStore, openAuthSessionAsync } = youHarness();
    useAppStore.getState().connectWhoop.mockResolvedValue('https://api.prod.whoop.com/oauth');
    openAuthSessionAsync.mockResolvedValueOnce({ type: 'cancel' });
    await expect(you.connectWhoop()).resolves.toBeNull();
    openAuthSessionAsync.mockResolvedValueOnce({ type: 'success', url: 'app.hyper.mobile://settings?whoop=error' });
    await expect(you.connectWhoop()).resolves.toMatchObject({ ok: false });
    expect(useAppStore.getState().syncWhoop).not.toHaveBeenCalled();
  });

  it('keeps a failed first import quiet', async () => {
    const { you, useAppStore } = youHarness();
    useAppStore.getState().connectWhoop.mockResolvedValue('https://api.prod.whoop.com/oauth');
    useAppStore.getState().syncWhoop.mockRejectedValue(new Error('offline'));
    await expect(you.connectWhoop()).resolves.toMatchObject({ ok: true });
  });

  it('reads no consent address as connected only with sample data', async () => {
    const { you, useAppStore, preview } = youHarness();
    await expect(you.connectWhoop()).resolves.toMatchObject({ ok: false });
    expect(useAppStore.getState().syncWhoop).not.toHaveBeenCalled();

    preview.active = true;
    await expect(you.connectWhoop()).resolves.toEqual({ ok: true, message: 'WHOOP connected.' });
    expect(useAppStore.getState().syncWhoop).toHaveBeenCalledTimes(1);
  });

  it('says so when signed out', async () => {
    const { you, useAppStore } = youHarness();
    useAppStore.getState().connectWhoop.mockRejectedValue(new Error('You are signed out. Sign in and try again.'));
    await expect(you.connectWhoop()).resolves.toEqual({
      ok: false,
      message: 'Could not start the WHOOP connection. You are signed out. Sign in and try again.',
    });
  });
});

describe('Food analysis after the Mac worker is saved', () => {
  it('shows the saved address on the way back', async () => {
    type RowProps = { title: string; value?: string };
    const rows: Record<string, RowProps> = {};
    const settings = { url: '', provider: 'openai' };
    let focus: (() => void) | null = null;
    const text = ({ children }: PropsWithChildren) => createElement('span', null, children);
    const Screen = loadNativeModule<{ default: ComponentType }>('app/(tabs)/you/analysis.tsx', {
      'expo-router': {
        router: { push: vi.fn() },
        Stack: { Screen: () => null },
        useFocusEffect: (effect: () => void) => {
          focus = effect;
          useEffect(() => effect(), [effect]);
        },
      },
      'expo-symbols': { SymbolView: () => null },
      'react-native': { Pressable: Wrap, View: Wrap },
      '@/lib/foodTrial': { getFoodTrialStatus: vi.fn() },
      '@/lib/foodTrialUsage': { foodTrialUsageLine: vi.fn() },
      '@/lib/photoAnalysis': { getPhotoWorkerSettings: () => ({ ...settings }) },
      '@/lib/supabase': { supabase: {} },
      '~/components/BlancText': { BlancText: text },
      '~/components/Form': { FormNote: text },
      '~/components/Label': { Label: Wrap },
      '~/components/Row': { Hairline: () => null, Row: (props: RowProps) => { rows[props.title] = props; return null; } },
      '~/components/TabScroll': { TabScroll: Wrap },
      '~/lib/haptics': { haptics: { select: vi.fn() } },
      '~/lib/you': { chooseAnalysisMode: vi.fn(), useAnalysisModeStore: create(() => ({ mode: 'worker' })) },
      '~/theme/blanc': { space: { section: 32 }, useBlanc: () => ({ ink: '#000', pressed: '#eee' }) },
    }).default;
    await mount(createElement(Screen));
    expect(rows['Mac worker'].value).toBe('Not set');

    // Saved on the Mac worker screen, then Back.
    settings.url = 'https://studio.tail1234.ts.net';
    await act(async () => { focus?.(); });
    expect(rows['Mac worker'].value).toBe('studio.tail1234.ts.net');
  });
});

// The clock Body weight reads; a test moves it past midnight ('' is the real clock).
const clock = { key: '' };
const clockKey = () => clock.key || dateFns.format(new Date(), 'yyyy-MM-dd');

function loadWeightScreen(you: YouModule, seen: { charts?: Array<{ days: number }>; rows?: Array<{ title: string; detail?: string }> }, options: { compile?: boolean } = {}) {
  const text = ({ children }: PropsWithChildren) => createElement('span', null, children);
  return loadNativeModule<{ default: ComponentType }>('app/(tabs)/you/weight.tsx', {
    '@expo/ui/swift-ui': { Host: Wrap, Picker: Wrap, Text: Wrap },
    '@expo/ui/swift-ui/modifiers': { pickerStyle: () => null, tag: () => null },
    'date-fns': dateFns,
    'expo-router': { router: { push: vi.fn() }, Stack: { Screen: () => null } },
    'react-native': { ActionSheetIOS: {}, Alert: {}, Pressable: Wrap, RefreshControl: () => null, View: Wrap },
    'react-native-reanimated': { default: { View: Wrap } },
    '@/lib/bodyWeightSummary': bodyWeightSummary,
    '@/lib/weightDisplayCore': weightDisplayCore,
    '~/components/BlancText': { BlancText: text },
    '~/components/Capsule': { Capsule: () => null },
    '~/components/Label': { Label: Wrap },
    '~/components/Row': { Hairline: () => null, Row: (props: { title: string; detail?: string }) => { seen.rows?.push(props); return null; } },
    '~/components/Section': { Section: Wrap },
    '~/components/SwipeRow': { SwipeRow: Wrap },
    '~/components/TabScroll': { TabScroll: Wrap },
    '~/components/WeightChart': { WeightChart: (props: { days: number }) => { seen.charts?.push(props); return null; } },
    '~/lib/fuel': { dayKey: (date: Date) => dateFns.format(date, 'yyyy-MM-dd'), today: clockKey, useTodayKey: clockKey },
    '~/lib/haptics': { haptics: { tap: vi.fn(), select: vi.fn() } },
    '~/lib/motion': { rowEnter: null, rowExit: null, rowLayout: null },
    '~/lib/you': you,
    '~/theme/blanc': { space: { gutter: 20, section: 32 }, useBlanc: () => ({ label: '#fff' }) },
  }, options).default;
}

describe('Body weight chart', () => {
  it('reads every day the chart shows', async () => {
    const harness = youHarness();
    const you = loadNativeModule<YouModule>('lib/you.ts', { ...harness.imports, '@/lib/bodyWeightSummary': bodyWeightSummary });
    harness.getBodyWeightHistorySince.mockResolvedValue([
      { id: 'w2', kilograms: 81, measured_at: '2026-11-03T07:00:00Z', source: 'manual' },
      { id: 'w1', kilograms: 82, measured_at: '2026-10-01T07:00:00Z', source: 'manual' },
    ]);
    const charts: Array<{ days: number }> = [];
    const Screen = loadWeightScreen(you, { charts });
    await mount(createElement(Screen));

    const shown = charts.at(-1)?.days;
    expect(shown).toBeGreaterThan(0);
    expect(harness.getBodyWeightHistorySince).toHaveBeenCalled();
    for (const [, days] of harness.getBodyWeightHistorySince.mock.calls) expect(days).toBeGreaterThanOrEqual(shown!);
  });
});

describe("Body weight's recent weigh-ins, as the app compiles it", () => {
  afterEach(() => { clock.key = ''; });

  it("stop calling a weigh-in Today once midnight passes, though the weigh-ins did not change", async () => {
    const harness = youHarness();
    const you = loadNativeModule<YouModule>('lib/you.ts', { ...harness.imports, '@/lib/bodyWeightSummary': bodyWeightSummary });
    const weighedAt = new Date();
    weighedAt.setHours(7, 0, 0, 0);
    harness.getBodyWeightHistorySince.mockResolvedValue([{ id: 'w1', kilograms: 81, measured_at: weighedAt.toISOString(), source: 'manual' }]);
    clock.key = dateFns.format(weighedAt, 'yyyy-MM-dd');
    const rows: Array<{ title: string; detail?: string }> = [];
    const Screen = loadWeightScreen(you, { rows }, { compile: true });
    await mount(createElement(Screen));
    const weighIn = () => rows.filter((row) => row.detail?.includes('7:00 AM')).at(-1)?.detail;
    expect(weighIn()).toBe('Today, 7:00 AM');

    // left open overnight; the screen renders again with the same weigh-ins
    clock.key = dateFns.format(dateFns.addDays(weighedAt, 1), 'yyyy-MM-dd');
    await act(async () => { root!.render(createElement(Screen)); });
    expect(weighIn()).toBe(`${dateFns.format(weighedAt, 'MMM d')}, 7:00 AM`);
  });
});

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());
