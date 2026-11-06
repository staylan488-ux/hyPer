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
import * as weightHistory from '@/lib/weightHistory';
import * as weightTrend from '@/lib/weightTrend';
import * as weightRate from '../native/src/lib/weightRate';
import * as weightTrendLine from '../native/src/lib/weightTrendLine';
import { loadNativeModule } from './helpers/loadNativeModule';
import { silentAccessibility } from './helpers/silentAccessibility';

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
  const deleteManualBodyWeight = vi.fn<(userId: string, id: string) => Promise<void>>(async () => {});
  const getNutritionProfile = vi.fn<(userId: string) => Promise<NutritionProfile | null>>(async () => null);
  const getBodyWeightHistorySince = vi.fn<(userId: string, days: number) => Promise<unknown[]>>(async () => []);
  const getAllBodyWeights = vi.fn<(userId: string) => Promise<unknown[]>>(async () => []);
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
      bodyWeightWindowStart: (days: number, now = new Date()) => new Date(now.getTime() - days * 86_400_000).toISOString(),
      connectOrSyncHealthWeights: health.connectOrSyncHealthWeights,
      deleteManualBodyWeight,
      getAllBodyWeights,
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
    '@/lib/weightHistory': weightHistory,
    '@/lib/whoopStatus': {
      whoopCallbackStatus: (url: string) => (url.includes('whoop=connected') ? 'connected' : 'error'),
    },
    '@/stores/appStore': { useAppStore },
    '@/stores/authStore': { useAuthStore },
    '~/platform/previewFlag': { isPreviewActive: () => preview.active },
  };
  const you = loadNativeModule<YouModule>('lib/you.ts', imports);
  return { you, reads, health, preview, useAppStore, useAuthStore, openAuthSessionAsync, imports, getNutritionProfile, getBodyWeightHistorySince, getAllBodyWeights, deleteManualBodyWeight };
}

let root: Root | null = null;
async function mount(element: ReturnType<typeof createElement>) {
  const container = document.createElement('div');
  root = createRoot(container);
  await act(async () => { root!.render(element); });
  return container;
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
      '~/lib/accessibility': silentAccessibility,
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
      '@expo/ui/swift-ui/modifiers': { accessibilityLabel: () => null, pickerStyle: () => null, tag: () => null },
      'expo-router': { router: { back: vi.fn(), replace: vi.fn() } },
      'react-native': {
        ActivityIndicator: () => { spinner(); return null; },
        Keyboard: { dismiss: vi.fn() },
        Pressable: Wrap,
        ScrollView: Wrap,
        TextInput: () => null,
        View: Wrap,
      },
      'react-native-reanimated': { default: { View: Wrap } },
      '@/lib/healthWeights': { recordManualBodyWeight },
      '@/lib/nutritionCalculator': nutritionCalculator,
      '@/lib/nutritionWizard': nutritionWizard,
      '@/stores/appStore': { useAppStore: harness.useAppStore },
      '@/stores/authStore': { useAuthStore: harness.useAuthStore },
      '~/components/BlancText': { BlancText: text },
      '~/components/Capsule': { Capsule: (props: ButtonProps) => { buttons[props.title] = props; return null; } },
      '~/components/Form': { ChoiceRow: () => null, FieldRow: (props: FieldProps) => { fields[props.label] = props; return null; }, FormNote: text },
      '~/components/GlassButton': { GlassButton: () => null },
      '~/components/Label': { Label: Wrap },
      '~/components/RollingText': { RollingText: text },
      '~/components/Row': { Hairline: () => null, Row: () => null },
      '~/components/Section': { Section: Wrap },
      '~/components/Stepper': { Stepper: () => null },
      '~/lib/format': { formatWhole: (value: number) => String(Math.round(value)) },
      '~/lib/accessibility': silentAccessibility,
      '~/lib/haptics': { haptics: { success: vi.fn(), error: vi.fn(), select: vi.fn() } },
      '~/lib/leaveGuard': { useLeaveGuard: vi.fn() },
      '~/lib/motion': { figureLayout: null },
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
      'react-native': { View: Wrap },
      '@/lib/foodTrial': { getFoodTrialStatus: vi.fn() },
      '@/lib/foodTrialUsage': { foodTrialUsageLine: vi.fn() },
      '@/lib/photoAnalysis': { getPhotoWorkerSettings: () => ({ ...settings }) },
      '@/lib/supabase': { supabase: {} },
      '~/components/Form': { ChoiceRow: () => null, FormNote: text },
      '~/components/Label': { Label: Wrap },
      '~/components/Row': { Hairline: () => null, Row: (props: RowProps) => { rows[props.title] = props; return null; } },
      '~/components/TabScroll': { TabScroll: Wrap },
      '~/lib/accessibility': silentAccessibility,
      '~/lib/you': { chooseAnalysisMode: vi.fn(), useAnalysisModeStore: create(() => ({ mode: 'worker' })) },
      '~/theme/blanc': { space: { section: 32 } },
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

type ChartProps = { calendar?: weightHistory.WeightChartWindow; summary?: string; span?: string };
type RowSeen = { title: string; detail?: string; value?: string; quiet?: boolean; accessibilityLabel?: string; onPress?: () => void };
type Seen = {
  charts?: ChartProps[];
  rows?: RowSeen[];
  pickers?: Array<{ selection: string; onSelectionChange: (next: string) => void }>;
  sections?: Array<{ title: string; note?: string }>;
  scrolls?: Array<((event: unknown) => void) | undefined>;
};
type YouWeights = YouModule & {
  loadWeights: (options?: { all?: boolean }) => Promise<void>;
  logWeighIn: (kilograms: number) => Promise<string | null>;
  deleteWeighIn: (entry: unknown) => Promise<boolean>;
  useWeightStore: { getState: () => { history: Array<{ id: string }>; all: Array<{ id: string }> | null; allFailed: boolean; failed: boolean; loading: boolean } };
};

function weightScreenImports(you: YouModule, seen: Seen) {
  const text = ({ children }: PropsWithChildren) => createElement('span', null, children);
  const rowMock = { Hairline: () => null, Row: (props: RowSeen) => { seen.rows?.push(props); return null; } };
  const motion = { blockExit: null, figureLayout: null, rowEnter: null, rowExit: null, rowLayout: null };
  const weighInRows = loadNativeModule('components/WeighInRows.tsx', {
    'date-fns': dateFns,
    'react-native': { ActionSheetIOS: {}, Alert: {}, View: Wrap },
    'react-native-reanimated': { default: { View: Wrap } },
    '@/lib/weightDisplayCore': weightDisplayCore,
    '~/lib/accessibility': silentAccessibility,
    '~/lib/fuel': { dayKey: (date: Date) => dateFns.format(date, 'yyyy-MM-dd') },
    '~/lib/haptics': { haptics: { success: vi.fn(), error: vi.fn() } },
    '~/lib/motion': motion,
    '~/lib/you': you,
    '~/theme/blanc': { useBlanc: () => ({ label: '#fff' }) },
    './BlancText': { BlancText: text },
    './Label': { Label: Wrap },
    './Row': rowMock,
    './SwipeRow': { SwipeRow: Wrap },
  });
  return {
    '@expo/ui/swift-ui': {
      Host: Wrap,
      Picker: (props: PropsWithChildren<{ selection: string; onSelectionChange: (next: string) => void }>) => {
        seen.pickers?.push(props);
        return createElement(Fragment, null, props.children);
      },
      Text: Wrap,
    },
    '@expo/ui/swift-ui/modifiers': { accessibilityLabel: () => null, pickerStyle: () => null, tag: () => null },
    'date-fns': dateFns,
    'expo-router': { router: { push: vi.fn() }, Stack: { Screen: () => null } },
    'react-native': { ActivityIndicator: () => null, Pressable: Wrap, RefreshControl: () => null, View: Wrap },
    'react-native-reanimated': { default: { View: Wrap }, LayoutAnimationConfig: Wrap },
    '@/lib/bodyWeightSummary': bodyWeightSummary,
    '@/lib/weightDisplayCore': weightDisplayCore,
    '@/lib/weightHistory': weightHistory,
    '@/lib/weightTrend': weightTrend,
    '~/components/BlancText': { BlancText: text },
    '~/components/Capsule': { Capsule: () => null },
    '~/components/Label': { Label: Wrap },
    '~/components/RollingText': { RollingText: text },
    '~/components/Row': rowMock,
    '~/components/Section': {
      Section: (props: PropsWithChildren<{ title: string; note?: string }>) => {
        seen.sections?.push(props);
        return createElement(Fragment, null, props.children);
      },
    },
    '~/components/TabScroll': {
      TabScroll: (props: PropsWithChildren<{ onScroll?: (event: unknown) => void }>) => {
        seen.scrolls?.push(props.onScroll);
        return createElement(Fragment, null, props.children);
      },
    },
    '~/components/WeighInRows': weighInRows,
    '~/components/WeightChart': { WeightChart: (props: ChartProps) => { seen.charts?.push(props); return null; } },
    '~/lib/accountData': { useCurrentDayKey: clockKey },
    '~/lib/accessibility': silentAccessibility,
    '~/lib/haptics': { haptics: { tap: vi.fn(), select: vi.fn() } },
    '~/lib/motion': motion,
    '~/lib/weightRate': weightRate,
    '~/lib/weightTrendLine': weightTrendLine,
    '~/lib/you': you,
    '~/theme/blanc': { space: { gutter: 20, inset: 16, section: 32 }, useBlanc: () => ({ label: '#fff' }), figureLead: () => 0, restingFigure: {} },
  };
}

function loadWeightScreen(you: YouModule, seen: Seen, options: { compile?: boolean } = {}) {
  return loadNativeModule<{ default: ComponentType }>('app/(tabs)/you/weight.tsx', weightScreenImports(you, seen), options).default;
}

function loadWeighInsScreen(you: YouModule, seen: Seen) {
  return loadNativeModule<{ default: ComponentType }>('app/(tabs)/you/weigh-ins.tsx', weightScreenImports(you, seen)).default;
}

// The chart's range picker (Units is the other one on the page).
const rangePicker = (pickers: NonNullable<Seen['pickers']>) => pickers.filter((picker) => picker.selection !== 'lb' && picker.selection !== 'kg').at(-1)!;

const weighIn = (id: string, kilograms: number, measuredAt: string, source = 'manual') => ({
  id, user_id: 'user-1', source, external_id: id, measured_at: measuredAt, kilograms, source_bundle: 'app.hyper', source_name: 'hyPer',
});

function youWeights() {
  const harness = youHarness();
  const you = loadNativeModule<YouWeights>('lib/you.ts', { ...harness.imports, '@/lib/bodyWeightSummary': bodyWeightSummary });
  return { harness, you };
}

describe('Body weight chart', () => {
  afterEach(() => { clock.key = ''; });

  it('reads every weigh-in and draws the days the chosen range covers', async () => {
    clock.key = '2026-11-05';
    const { harness, you } = youWeights();
    harness.getAllBodyWeights.mockResolvedValue([
      weighIn('w3', 79.5, '2026-11-03T15:00:00Z'),
      weighIn('w2', 79, '2026-10-01T15:00:00Z'),
      weighIn('w1', 78, '2026-05-01T15:00:00Z'),
    ]);
    const charts: ChartProps[] = [];
    const pickers: NonNullable<Seen['pickers']> = [];
    const Screen = loadWeightScreen(you, { charts, pickers });
    await mount(createElement(Screen));

    expect(harness.getAllBodyWeights).toHaveBeenCalledWith('user-1');
    // Three months to start, ending today.
    const threeMonths = charts.at(-1)!.calendar!;
    expect(threeMonths).toMatchObject({ endDay: '2026-11-05', slots: 90 });
    expect(threeMonths.series[0].date).toBe('2026-08-08');
    expect(charts.at(-1)!.span).toBe('last 3 months');

    // All goes back to the first weigh-in, six months ago.
    await act(async () => { rangePicker(pickers).onSelectionChange('all'); });
    const everything = charts.at(-1)!.calendar!;
    expect(everything.startDay).toBe(dateFns.format(new Date('2026-05-01T15:00:00Z'), 'yyyy-MM-dd'));
    expect(everything.series.at(-1)!.date).toBe(dateFns.format(new Date('2026-11-03T15:00:00Z'), 'yyyy-MM-dd'));
    // The rate beside the change is the same days' average, at a summary's one decimal.
    expect(charts.at(-1)!.summary).toMatch(/^\+\d+\.\d lb since May\u00a0[0-9]+\u00a0· \+\d+\.\d lb\/wk$/);
  });

  it('draws the chart for someone back after months away', async () => {
    clock.key = '2026-11-05';
    const { harness, you } = youWeights();
    harness.getAllBodyWeights.mockResolvedValue([
      ...Array.from({ length: 3 }, (_, index) => weighIn(`n${index}`, 70, `2026-11-0${3 - index}T15:00:00Z`)),
      weighIn('old', 90, '2025-01-10T15:00:00Z'),
    ]);
    const charts: ChartProps[] = [];
    const pickers: NonNullable<Seen['pickers']> = [];
    await mount(createElement(loadWeightScreen(you, { charts, pickers })));
    expect(charts.length).toBeGreaterThan(0);
    await act(async () => { rangePicker(pickers).onSelectionChange('all'); });
    // The trend starts again at the first weigh-in back.
    expect(charts.at(-1)!.calendar!.series.at(-1)!.ewmaKg).toBeCloseTo(70, 6);
  });

  it('says when older weigh-ins could not be read, rather than calling the recent ones all of them', async () => {
    clock.key = '2026-11-05';
    const { harness, you } = youWeights();
    harness.getBodyWeightHistorySince.mockResolvedValue([
      weighIn('w2', 80, '2026-11-03T15:00:00Z'),
      weighIn('w1', 80.4, '2026-10-20T15:00:00Z'),
    ]);
    await you.loadWeights();
    harness.getAllBodyWeights.mockRejectedValue(new Error('offline'));
    const charts: ChartProps[] = [];
    const pickers: NonNullable<Seen['pickers']> = [];
    const page = await mount(createElement(loadWeightScreen(you, { charts, pickers })));
    await act(async () => {});
    expect(page.textContent).toContain('Couldn’t load your older weigh-ins. Pull down to try again.');
    await act(async () => { rangePicker(pickers).onSelectionChange('all'); });
    expect(charts.at(-1)!.span).toBe('recent weigh-ins only');
  });

  it('says when the chosen range has no weigh-ins', async () => {
    clock.key = '2026-11-05';
    const { harness, you } = youWeights();
    harness.getAllBodyWeights.mockResolvedValue([
      weighIn('w2', 80, '2026-08-01T15:00:00Z'),
      weighIn('w1', 79, '2026-07-20T15:00:00Z'),
    ]);
    const charts: ChartProps[] = [];
    const pickers: NonNullable<Seen['pickers']> = [];
    await mount(createElement(loadWeightScreen(you, { charts, pickers })));
    await act(async () => { rangePicker(pickers).onSelectionChange('1m'); });
    expect(charts.at(-1)!.calendar!.series).toHaveLength(0);
    expect(charts.at(-1)!.summary).toBe('No weigh-ins in the last month');
  });
});

describe('All weigh-ins', () => {
  afterEach(() => { clock.key = ''; });

  it('leads from Recent once there are more weigh-ins than it lists', async () => {
    clock.key = '2026-11-05';
    const { harness, you } = youWeights();
    harness.getAllBodyWeights.mockResolvedValue(
      Array.from({ length: 9 }, (_, index) => weighIn(`w${index}`, 80 - index * 0.1, `2026-11-0${5 - Math.min(index, 4)}T1${index}:00:00Z`)),
    );
    const rows: RowSeen[] = [];
    await mount(createElement(loadWeightScreen(you, { rows })));
    const all = rows.filter((row) => row.title === 'All weigh-ins').at(-1);
    // The row leads on; its count would only repeat the list it opens.
    expect(all).toBeDefined();
    expect(all?.value).toBeUndefined();
    expect(rows.filter((row) => row.accessibilityLabel?.includes(' lb, ')).length).toBeGreaterThan(0);
  });

  it('lists every weigh-in by month, newest first, with each month’s average', async () => {
    clock.key = '2026-11-05';
    const { harness, you } = youWeights();
    harness.getAllBodyWeights.mockResolvedValue([
      weighIn('n1', 81, '2026-11-02T15:00:00Z'),
      weighIn('o2', 80.5, '2026-10-20T15:00:00Z'),
      weighIn('o1', 79.5, '2026-10-10T15:00:00Z'),
      weighIn('d1', 75, '2025-12-15T15:00:00Z'),
    ]);
    const sections: NonNullable<Seen['sections']> = [];
    const rows: RowSeen[] = [];
    await mount(createElement(loadWeighInsScreen(you, { sections, rows })));
    const months = sections.slice(-3);
    expect(months.map((month) => month.title)).toEqual(['November', 'October', 'December 2025']);
    // Kept on one line at the largest text sizes.
    expect(months[1].note).toBe(`avg\u00a0${weightDisplayCore.formatWeight(80, 'lb')}\u00a0lb`);
    expect(new Set(rows.map((row) => row.title)).size).toBe(4);
  });
});

describe('Weigh-in rows', () => {
  afterEach(() => { clock.key = ''; });

  it('read on one line: when leads, quiet, and VoiceOver hears the weight first', async () => {
    clock.key = '2026-11-05';
    const { harness, you } = youWeights();
    harness.getAllBodyWeights.mockResolvedValue([weighIn('w1', 80, '2026-11-02T15:00:00Z')]);
    const rows: RowSeen[] = [];
    await mount(createElement(loadWeighInsScreen(you, { rows })));
    const row = rows.at(-1)!;
    const when = dateFns.format(new Date('2026-11-02T15:00:00Z'), 'MMM d, h:mm a');
    expect(row).toMatchObject({ title: when, quiet: true });
    expect(row.detail).toBeUndefined();
    expect(row.accessibilityLabel).toBe(`${weightDisplayCore.formatWeight(80, 'lb')} lb, ${when}`);
  });
});

describe('All weigh-ins with a long history', () => {
  afterEach(() => { clock.key = ''; });

  it('opens with about a screenful of rows and adds more as the end comes near', async () => {
    clock.key = '2026-11-05';
    const { harness, you } = youWeights();
    harness.getAllBodyWeights.mockResolvedValue(
      Array.from({ length: 200 }, (_, index) => weighIn(`w${index}`, 80, dateFns.subDays(new Date(2026, 10, 5, 8), index).toISOString())),
    );
    const rows: RowSeen[] = [];
    const scrolls: NonNullable<Seen['scrolls']> = [];
    await mount(createElement(loadWeighInsScreen(you, { rows, scrolls })));
    const drawn = () => new Set(rows.slice(-400).map((row) => row.title)).size;
    rows.length = 0;
    await act(async () => { root!.render(createElement(loadWeighInsScreen(you, { rows, scrolls }))); });
    expect(drawn()).toBe(16);

    // Scrolled to within the last screen or so of what is drawn.
    const nearEnd = { nativeEvent: { contentOffset: { y: 400 }, contentSize: { height: 1_500 }, layoutMeasurement: { height: 800 } } };
    rows.length = 0;
    await act(async () => { scrolls.at(-1)!(nearEnd); });
    expect(drawn()).toBe(36);
  });
});

describe('Reading every weigh-in', () => {
  it('keeps a weigh-in just logged when an older full read lands after it', async () => {
    const { harness, you } = youWeights();
    const slow = deferred<unknown[]>();
    harness.getAllBodyWeights.mockReturnValueOnce(slow.promise);
    const full = you.loadWeights({ all: true });
    // A weigh-in is logged while the full read is out; its own read lands first.
    harness.getBodyWeightHistorySince.mockResolvedValue([weighIn('new', 82, new Date().toISOString())]);
    expect(await you.logWeighIn(82)).toBeNull();
    slow.resolve([weighIn('old', 79, '2026-01-01T15:00:00Z')]);
    await full;

    const state = you.useWeightStore.getState();
    expect(state.history.map((entry) => entry.id)).toEqual(['new']);
    expect(state.all?.map((entry) => entry.id)).toEqual(['old']);
    expect(state.loading).toBe(false);
  });

  it('says a failed full read failed, even when a recent read lands after it started', async () => {
    const { harness, you } = youWeights();
    const slow = deferred<unknown[]>();
    harness.getAllBodyWeights.mockReturnValueOnce(slow.promise.then(() => { throw new Error('offline'); }));
    const full = you.loadWeights({ all: true });
    await you.loadWeights();
    slow.resolve([]);
    await full;
    const state = you.useWeightStore.getState();
    expect(state.allFailed).toBe(true);
    // The recent read worked, so the screen isn't told the weigh-ins failed.
    expect(state.failed).toBe(false);
  });

  it('keeps a deleted weigh-in deleted when a full read that started before the delete lands after it', async () => {
    const { harness, you } = youWeights();
    const recent = weighIn('recent', 81, new Date().toISOString());
    const old = weighIn('old', 78, '2026-01-01T15:00:00Z');
    harness.getAllBodyWeights.mockResolvedValue([recent, old]);
    await you.loadWeights({ all: true });

    const slow = deferred<unknown[]>();
    harness.getAllBodyWeights.mockReturnValueOnce(slow.promise);
    const full = you.loadWeights({ all: true });
    expect(await you.deleteWeighIn(old)).toBe(true);
    // The read was answered before the delete reached the server.
    slow.resolve([recent, old]);
    await full;
    expect(you.useWeightStore.getState().all?.map((entry) => entry.id)).toEqual(['recent']);
  });

  it('takes a deleted weigh-in out of every list and puts it back where it was if the delete fails', async () => {
    const { harness, you } = youWeights();
    const recent = weighIn('recent', 81, new Date().toISOString());
    const old = weighIn('old', 78, '2026-01-01T15:00:00Z');
    harness.getAllBodyWeights.mockResolvedValue([recent, old]);
    await you.loadWeights({ all: true });

    harness.deleteManualBodyWeight.mockRejectedValueOnce(new Error('offline'));
    const pending = you.deleteWeighIn(old);
    expect(you.useWeightStore.getState().all?.map((entry) => entry.id)).toEqual(['recent']);
    expect(await pending).toBe(false);
    expect(you.useWeightStore.getState().all?.map((entry) => entry.id)).toEqual(['recent', 'old']);
    // It was never among the recent ones, so it doesn't land there.
    expect(you.useWeightStore.getState().history.map((entry) => entry.id)).toEqual(['recent']);

    expect(await you.deleteWeighIn(recent)).toBe(true);
    expect(you.useWeightStore.getState().history).toEqual([]);
    expect(you.useWeightStore.getState().all?.map((entry) => entry.id)).toEqual(['old']);
  });
});

describe("Body weight's recent weigh-ins, as the app compiles it", () => {
  afterEach(() => { clock.key = ''; });

  it("stop calling a weigh-in Today once midnight passes, though the weigh-ins did not change", async () => {
    const harness = youHarness();
    const you = loadNativeModule<YouModule>('lib/you.ts', { ...harness.imports, '@/lib/bodyWeightSummary': bodyWeightSummary });
    const weighedAt = new Date();
    weighedAt.setHours(7, 0, 0, 0);
    harness.getAllBodyWeights.mockResolvedValue([{ id: 'w1', kilograms: 81, measured_at: weighedAt.toISOString(), source: 'manual' }]);
    clock.key = dateFns.format(weighedAt, 'yyyy-MM-dd');
    const rows: RowSeen[] = [];
    const Screen = loadWeightScreen(you, { rows }, { compile: true });
    await mount(createElement(Screen));
    const weighIn = () => rows.filter((row) => row.title.includes('7:00 AM')).at(-1)?.title;
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
