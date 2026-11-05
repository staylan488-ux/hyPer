// @vitest-environment happy-dom
// Writes that must never start from the phone's launch copy (launchCache):
// adaptive re-learning from Targets, and the schedule editor's default day.
import * as dateFns from 'date-fns';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';

import type { PlanSchedule } from '@/lib/planSchedule';
import * as settingsUx from '@/lib/settingsUx';
import type { HeroState } from '@/lib/todayModel';
import type { Split, SplitDay } from '@/types';
import { loadNativeModule } from './helpers/loadNativeModule';
import { silentAccessibility } from './helpers/silentAccessibility';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const USER = 'user-1';
type Children = { children?: ReactNode | ((state: { pressed: boolean }) => ReactNode) };
const box = ({ children }: Children) => createElement('div', null, typeof children === 'function' ? children({ pressed: false }) : children);
const text = ({ children }: Children) => createElement('span', null, children as ReactNode);
const none = () => null;
const Capsule = ({ title, onPress }: { title: string; onPress: () => void }) => createElement('button', { 'data-title': title, onClick: onPress }, title);
const haptics = { tap: vi.fn(), select: vi.fn(), success: vi.fn(), error: vi.fn() };
const auth = create<{ user: { id: string } | null }>(() => ({ user: { id: USER } }));

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  Object.values(haptics).forEach((fn) => fn.mockClear());
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
const press = async (title: string) => {
  const button = host.querySelector<HTMLButtonElement>(`button[data-title="${title}"]`);
  expect(button).not.toBeNull();
  await act(async () => { button!.click(); });
  await act(async () => { await Promise.resolve(); });
};

describe('Resume adaptive targets', () => {
  type Target = { user_id: string; calories: number; protein: number; carbs: number; fat: number; source: 'manual' | 'calculated' };
  const copied: Target = { user_id: USER, calories: 2800, protein: 160, carbs: 350, fat: 80, source: 'manual' };
  const profile = { user_id: USER, adaptive_enabled: true, expenditure_kcal: null, expenditure_confidence: null };
  const updateMacroTarget = vi.fn<(target: unknown) => Promise<void>>(async () => {});
  const refreshAdaptiveTargets = vi.fn<(options?: unknown) => Promise<string>>(async () => 'updated');
  const app = create(() => ({
    macroTarget: copied as Target | null,
    nutritionProfile: profile as typeof profile | null,
    macroTargetLoadedForUserId: null as string | null,
    nutritionProfileLoadedForUserId: null as string | null,
    updateMacroTarget,
    refreshAdaptiveTargets,
  }));
  const targets = create<{ status: string; message: { text: string; alert?: boolean } | null }>(() => ({ status: 'idle', message: null }));
  const loadTargets = vi.fn(async () => { targets.setState({ status: 'error' }); });
  // This launch's read lands with what the account holds now.
  const readLands = (target: Target) => loadTargets.mockImplementation(async () => {
    app.setState({ macroTarget: target, nutritionProfile: profile, macroTargetLoadedForUserId: USER, nutritionProfileLoadedForUserId: USER });
    targets.setState({ status: 'ready' });
  });

  let TargetsScreen: () => ReactNode;
  beforeEach(() => {
    app.setState({ macroTarget: copied, nutritionProfile: profile, macroTargetLoadedForUserId: null, nutritionProfileLoadedForUserId: null });
    targets.setState({ status: 'idle', message: null });
    updateMacroTarget.mockClear();
    refreshAdaptiveTargets.mockClear();
    loadTargets.mockReset().mockImplementation(async () => { targets.setState({ status: 'error' }); });
    ({ default: TargetsScreen } = loadNativeModule<{ default: () => ReactNode }>('app/(tabs)/you/targets.tsx', {
      'expo-router': { router: { push: vi.fn() }, Stack: { Screen: none } },
      'react-native': { Pressable: box, RefreshControl: none, View: box },
      'react-native-reanimated': { default: { View: box } },
      '@/lib/photoAnalysis': { getPhotoWorkerSettings: () => ({ url: '' }) },
      '@/lib/settingsUx': settingsUx,
      '@/stores/appStore': { useAppStore: app },
      '@/stores/authStore': { useAuthStore: auth },
      '~/components/BlancText': { BlancText: text },
      '~/components/Capsule': { Capsule },
      '~/components/Form': { FormNote: ({ children }: Children) => createElement('p', { 'data-note': '' }, children as ReactNode) },
      '~/components/Label': { Label: box },
      '~/components/RollingText': { RollingText: text },
      '~/components/Row': { Hairline: none, Row: none },
      '~/components/Section': { Section: box },
      '~/components/TabScroll': { TabScroll: box },
      '~/lib/accessibility': silentAccessibility,
      '~/lib/format': { formatWhole: (value: number) => String(Math.round(value)) },
      '~/lib/haptics': { haptics },
      '~/lib/motion': { figureLayout: undefined },
      '~/platform/previewFlag': { isPreviewActive: () => false },
      '~/lib/you': {
        loadTargets,
        useAnalysisModeStore: create(() => ({ mode: 'gemini' })),
        usePullRefresh: () => ({ refreshing: false, refresh: async () => {} }),
        useTargetsStore: targets,
      },
      '~/theme/blanc': { space: { gutter: 20, inset: 16, section: 28 } },
    }));
  });
  const open = async () => {
    await act(async () => { root.render(createElement(TargetsScreen)); });
    await act(async () => { await Promise.resolve(); });
  };
  const note = () => host.querySelector('[data-note]:last-of-type')?.textContent;

  it('never re-learns from the copy while this launch’s reads fail', async () => {
    await open();
    expect(loadTargets).toHaveBeenCalledTimes(1);
    await press('Resume adaptive targets');
    expect(loadTargets).toHaveBeenCalledTimes(2);
    expect(updateMacroTarget).not.toHaveBeenCalled();
    expect(refreshAdaptiveTargets).not.toHaveBeenCalled();
    expect(haptics.error).toHaveBeenCalledTimes(1);
    expect(targets.getState().message).toEqual({ text: 'Could not resume adaptive targets. Please try again.', alert: true });
  });

  it('reads first, then resumes from what the read found', async () => {
    await open();
    readLands({ ...copied, calories: 2900, protein: 170 });
    await press('Resume adaptive targets');
    expect(updateMacroTarget).toHaveBeenCalledWith({ calories: 2900, protein: 170, carbs: 350, fat: 80, source: 'calculated' });
    expect(refreshAdaptiveTargets).toHaveBeenCalledWith({ force: true });
    expect(haptics.success).toHaveBeenCalledTimes(1);
    expect(note()).toBeTruthy();
  });

  it('writes nothing when the read finds the targets adapting already', async () => {
    await open();
    readLands({ ...copied, source: 'calculated' });
    await press('Resume adaptive targets');
    expect(updateMacroTarget).not.toHaveBeenCalled();
    expect(refreshAdaptiveTargets).not.toHaveBeenCalled();
    expect(haptics.error).not.toHaveBeenCalled();
  });

  it('resumes at once from this launch’s own reads, as before', async () => {
    app.setState({ macroTargetLoadedForUserId: USER, nutritionProfileLoadedForUserId: USER });
    await open();
    await press('Resume adaptive targets');
    expect(loadTargets).toHaveBeenCalledTimes(1);
    expect(updateMacroTarget).toHaveBeenCalledWith({ calories: 2800, protein: 160, carbs: 350, fat: 80, source: 'calculated' });
    expect(refreshAdaptiveTargets).toHaveBeenCalledWith({ force: true });
  });
});

describe('the schedule editor’s default day', () => {
  const ppl: Split = {
    id: 'ppl', user_id: USER, name: 'PPL', description: null, days_per_week: 3, is_active: true,
    days: [
      { id: 'push', split_id: 'ppl', day_name: 'Push', day_order: 0, exercises: [] },
      { id: 'legs', split_id: 'ppl', day_name: 'Legs', day_order: 1, exercises: [] },
    ],
  };
  const saved: PlanSchedule = { splitId: 'ppl', startDate: '2026-11-01', mode: 'flex', weekdays: [], anchorDay: 0, flexAnchorIndex: 0, updatedAt: '2026-11-01T08:00:00.000Z' };
  // The copy's plan names Legs up next; Save must never write it from the copy.
  const plan = create<{ schedule: PlanSchedule | null; hero: HeroState; upNext: SplitDay | null | undefined; seeded: boolean }>(() => ({
    schedule: saved, hero: { kind: 'planned', day: ppl.days[1] }, upNext: ppl.days[1], seeded: true,
  }));
  const savePlanSchedule = vi.fn();
  const buildPlanSchedule = vi.fn((_split: Split, choices: { flexDayIndex: number }) => ({ ...saved, flexAnchorIndex: choices.flexDayIndex }));

  let ScheduleSheet: () => ReactNode;
  beforeEach(() => {
    buildPlanSchedule.mockClear();
    savePlanSchedule.mockClear();
    ({ default: ScheduleSheet } = loadNativeModule<{ default: () => ReactNode }>('app/schedule.tsx', {
      '@expo/ui/swift-ui': { DatePicker: none, Host: box, Picker: box, Text: text },
      '@expo/ui/swift-ui/modifiers': { datePickerStyle: () => ({}), pickerStyle: () => ({}), tag: () => ({}) },
      'date-fns': dateFns,
      'expo-router': { router: { back: vi.fn() } },
      'expo-symbols': { SymbolView: none },
      'react-native': { Pressable: box, ScrollView: box, View: box },
      '@/lib/planSchedule': { buildFixedWeekdays: () => [1, 3, 5], buildPlanSchedule, defaultWeekdays: () => [1, 3, 5], savePlanSchedule },
      '@/stores/appStore': { useAppStore: create(() => ({ activeSplit: ppl })) },
      '@/stores/authStore': { useAuthStore: auth },
      '~/components/BlancText': { BlancText: text },
      '~/components/Capsule': { Capsule },
      '~/components/Form': { ChoiceRow: none, FormNote: ({ children }: Children) => createElement('p', null, children as ReactNode) },
      '~/components/GlassButton': { GlassButton: none },
      '~/components/Label': { Label: box },
      '~/components/Row': { Hairline: none },
      '~/components/Section': { Section: box },
      '~/lib/accessibility': silentAccessibility,
      '~/lib/haptics': { haptics },
      '~/lib/leaveGuard': { useLeaveGuard: () => {} },
      '~/lib/today': { useScheduleRevision: create(() => ({ revision: 0, bump: vi.fn() })), useTodayPlan: () => plan() },
      '~/theme/blanc': { space: { gutter: 20, inset: 16, section: 28 }, useBlanc: () => ({ ground: '#f4f3ef', capsule: '#000', pressed: '#ddd', label: '#fff', ink: '#000' }) },
    }));
  });
  const saveUnchanged = async () => {
    await act(async () => { root.render(createElement(ScheduleSheet)); });
    await press('Save');
    return buildPlanSchedule.mock.calls[0]?.[1].flexDayIndex;
  };

  // With #178, Save waits while the session up next is unknown (it can be
  // ahead of the saved day), and a plan from the copy never makes it known.
  it('never writes the copy’s day: Save waits while today’s plan is shown from the phone’s copy', async () => {
    plan.setState({ seeded: true });
    expect(await saveUnchanged()).toBeUndefined();
    expect(savePlanSchedule).not.toHaveBeenCalled();
    // The reads land and decide the same day: now Save writes it.
    await act(async () => { plan.setState({ seeded: false }); });
    await press('Save');
    expect(buildPlanSchedule.mock.calls[0]?.[1].flexDayIndex).toBe(1);
    expect(savePlanSchedule).toHaveBeenCalledTimes(1);
  });

  it('takes today’s planned day once it is decided from this launch’s reads', async () => {
    plan.setState({ seeded: false });
    expect(await saveUnchanged()).toBe(1);
  });
});
