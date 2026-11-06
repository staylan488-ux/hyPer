// @vitest-environment happy-dom
import * as dates from 'date-fns';
import { act, createElement, Fragment, type PropsWithChildren, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';

import * as fuelSummary from '@/lib/fuelSummary';
import * as todayModel from '@/lib/todayModel';
import * as volumeCoaching from '@/lib/volumeCoaching';
import * as volumeStatus from '@/lib/volumeStatus';
import * as workoutSessions from '@/lib/workoutSessions';
import * as types from '@/types';
import type { MuscleVolume } from '@/types';
import { formatMinutes } from '../native/src/lib/format';
import { loadNativeModule } from './helpers/loadNativeModule';
import { silentAccessibility } from './helpers/silentAccessibility';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Progress (native/src/app/(tabs)/today/progress.tsx): a read that fails keeps
// what the screen shows, rather than reading as no training at all.

const Wrap = ({ children }: PropsWithChildren) => createElement(Fragment, null, children);
const Empty = () => null;
const noop = () => {};
// Text and views keep what the scale figures' checks read: whether text may
// shrink to fit, and a box's height.
const Text = ({ children, adjustsFontSizeToFit }: PropsWithChildren<{ adjustsFontSizeToFit?: boolean }>) =>
  createElement('span', adjustsFontSizeToFit ? { 'data-shrinks': 'true' } : null, children);
const View = ({ children, style }: PropsWithChildren<{ style?: { height?: number | string } }>) =>
  createElement('div', style?.height !== undefined ? { 'data-height': String(style.height) } : null, children);

let pull: () => void;
const fetchTrainingHours = vi.fn();
const calculateWeeklyVolume = vi.fn();
// The store's never-read list; resetAppData puts this same array back.
const initialAppData = { weeklyVolume: [] as MuscleVolume[] };
const appStore = create(() => ({
  weeklyVolume: initialAppData.weeklyVolume,
  macroTarget: null as { calories: number; protein: number } | null,
  nutritionProfile: null,
  calculateWeeklyVolume,
  fetchMacroTarget: async () => {},
}));

// The account's day, which the midnight refresh moves on.
const accountDay = create(() => ({ dayKey: dates.format(new Date(), 'yyyy-MM-dd') }));

// Eight weeks with 90 minutes this week.
const trained = () => workoutSessions.buildWeeklyTrainingHours([
  { date: dates.format(new Date(), 'yyyy-MM-dd'), completed: true, created_at: new Date(Date.now() - 90 * 60_000).toISOString(), completed_at: new Date().toISOString() },
]);

// The last seven days of eating the screen reads; none by default.
type Day = { date: string; calories: number; protein: number };
let nutrition: Day[] = [];
const averageLoggedDays = (days: Day[], key: 'calories' | 'protein') => {
  const logged = days.filter((day) => day[key] > 0);
  return logged.length ? logged.reduce((sum, day) => sum + day[key], 0) / logged.length : 0;
};
const lastWeek = (eaten: Record<number, number>): Day[] =>
  [6, 5, 4, 3, 2, 1, 0].map((ago) => ({ date: dates.format(dates.subDays(new Date(), ago), 'yyyy-MM-dd'), calories: eaten[ago] ?? 0, protein: 0 }));

let root: Root;
let host: HTMLDivElement;
const shown = () => host.textContent ?? '';

async function open() {
  const { default: ProgressScreen } = loadNativeModule<{ default: () => ReactNode }>('app/(tabs)/today/progress.tsx', {
    'date-fns': dates,
    'expo-router': { router: { navigate: noop }, Stack: { Screen: Empty } },
    'expo-symbols': { SymbolView: Empty },
    'react-native': {
      Pressable: Wrap,
      RefreshControl: ({ onRefresh }: { onRefresh: () => void }) => {
        pull = onRefresh;
        return null;
      },
      View,
    },
    'react-native-svg': { default: Wrap, Line: Empty },
    'react-native-reanimated': {
      default: { View: Wrap },
      FadeIn: { duration: () => undefined },
      LinearTransition: { duration: () => undefined },
      useAnimatedStyle: () => ({}),
      useSharedValue: (value: unknown) => ({ value }),
      withTiming: (value: unknown) => value,
    },
    '@/lib/todayModel': todayModel,
    '@/hooks/useWeeklyNutrition': { averageLoggedDays, useWeeklyNutrition: () => ({ weeklyNutrition: nutrition, loading: false, error: null }) },
    '@/lib/fuelSummary': fuelSummary,
    '@/lib/trainingHours': { fetchTrainingHours },
    '@/lib/volumeCoaching': volumeCoaching,
    '@/lib/volumeStatus': volumeStatus,
    '@/lib/workoutSessions': workoutSessions,
    '@/stores/appStore': { initialAppData, useAppStore: appStore },
    '@/types': types,
    '~/components/BlancText': { BlancText: Text },
    '~/components/Capsule': { Capsule: Empty },
    '~/components/Label': { Label: Wrap },
    '~/components/MuscleFigure': { MuscleFigure: Empty },
    '~/components/Row': { Hairline: Empty },
    // A section shows its title and the span it covers.
    '~/components/Section': {
      Section: ({ title, note, children }: PropsWithChildren<{ title: string; note?: string }>) => createElement(Fragment, null, createElement('h2', null, title, note ? ` ${note}` : ''), children),
    },
    '~/components/TabScroll': { TabScroll: ({ children, refreshControl }: { children: ReactNode; refreshControl: ReactNode }) => createElement(Fragment, null, refreshControl, children) },
    '~/lib/accountData': { useAccountDay: accountDay, useCurrentDayKey: () => accountDay.getState().dayKey },
    '~/lib/format': { formatMinutes, formatWhole: (value: number) => String(Math.round(value)) },
    '~/lib/accessibility': silentAccessibility,
    '~/lib/haptics': { haptics: { select: noop } },
    '~/theme/blanc': { space: { gutter: 20 }, useBlanc: () => ({ label: '#FFFFFF', graphite: '#66665F' }) },
    '~/theme/useMuscleTones': { useMuscleTones: () => ({}) },
  });
  await act(async () => { root.render(createElement(ProgressScreen)); });
}
const refresh = () => act(async () => { pull(); });

beforeEach(() => {
  nutrition = [];
  appStore.setState({ macroTarget: null });
  accountDay.setState({ dayKey: dates.format(new Date(), 'yyyy-MM-dd') });
  appStore.setState({ weeklyVolume: initialAppData.weeklyVolume });
  fetchTrainingHours.mockReset().mockResolvedValue(trained());
  // A read that worked writes a new list, even an empty one.
  calculateWeeklyVolume.mockReset().mockImplementation(async () => { appStore.setState({ weeklyVolume: [] }); });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('Progress after a failed read', () => {
  it('keeps the training time chart when a pull to refresh cannot read it', async () => {
    await open();
    expect(shown()).toContain('Week to date');
    expect(shown()).toContain('1 h 30 min');

    fetchTrainingHours.mockResolvedValueOnce(null);
    await refresh();
    expect(shown()).toContain('1 h 30 min');
    expect(shown()).not.toContain('Week to date0 min');
  });

  it('draws no chart of empty weeks when the first read fails', async () => {
    fetchTrainingHours.mockResolvedValueOnce(null);
    await open();
    expect(shown()).not.toContain('Week to date');
  });

  it('never says nothing was trained when this week’s volume could not be read', async () => {
    // A failed read leaves the store as it was.
    calculateWeeklyVolume.mockImplementation(async () => {});
    await open();
    expect(shown()).not.toContain('Nothing trained yet this week');

    calculateWeeklyVolume.mockImplementation(async () => { appStore.setState({ weeklyVolume: [] }); });
    await refresh();
    expect(shown()).toContain('Nothing trained yet this week');
  });

  it('says nothing was trained once another read finds an empty week after its own failed', async () => {
    calculateWeeklyVolume.mockImplementation(async () => {});
    await open();
    expect(shown()).not.toContain('Nothing trained yet this week');

    // Back online, the account load on foreground reads the week and finds nothing.
    await act(async () => { appStore.setState({ weeklyVolume: [] }); });
    expect(shown()).toContain('Nothing trained yet this week');
  });

  it('still says nothing was trained when an earlier read found an empty week', async () => {
    // The account load read the week and found nothing; Progress's own read fails.
    appStore.setState({ weeklyVolume: [] });
    let finishRead = noop;
    calculateWeeklyVolume.mockImplementation(() => new Promise<void>((resolve) => { finishRead = resolve; }));
    await open();
    expect(shown()).toContain('Nothing trained yet this week');

    await act(async () => { finishRead(); });
    expect(shown()).toContain('Nothing trained yet this week');
  });
});

describe("Progress's week", () => {
  it("is the account's day's week, and moves on with it while the screen stays open", async () => {
    accountDay.setState({ dayKey: '2026-11-04' });
    await open();
    expect(shown()).toContain('Week of November 2');
    // Monday's refresh, the screen still on top
    await act(async () => { accountDay.setState({ dayKey: '2026-11-09' }); });
    expect(shown()).toContain('Week of November 9');
  });
});

describe("Progress's nutrition header", () => {
  const count = (text: string) => shown().split(text).length - 1;

  it('averages the logged days before today, and says once in the note how many days are logged', async () => {
    nutrition = lastWeek({ 0: 800, 1: 2000, 3: 2400 });
    await open();
    expect(shown()).toContain('Avg 2200 kcal');
    expect(shown()).toContain('Nutrition Last 7 days · 3 days logged');
    expect(count('days logged')).toBe(1);
    expect(shown()).not.toContain('over 2 days');
    expect(shown()).not.toContain('today');
  });

  it("uses today's figure while today is the only day logged, the count said once for both charts", async () => {
    nutrition = lastWeek({ 0: 1342 });
    await open();
    expect(shown()).toContain('1342 kcal');
    expect(shown()).toContain('Last 7 days · 1 day logged');
    expect(count('1 day logged')).toBe(1);
    expect(shown()).not.toContain('Avg 1342');
  });

  it('says one logged day plainly rather than as an average', async () => {
    nutrition = lastWeek({ 0: 900, 2: 2100 });
    await open();
    expect(shown()).toContain('2100 kcal');
    expect(shown()).not.toContain('Avg 2100');
    expect(shown()).not.toContain('over 1 day');
  });

  it('names no count once every day is logged', async () => {
    nutrition = lastWeek({ 0: 500, 1: 2000, 2: 2000, 3: 2000, 4: 2000, 5: 2000, 6: 2000 }).map((day) => ({ ...day, protein: 150 }));
    await open();
    expect(shown()).toContain('Avg 2000 kcal');
    expect(shown()).toContain('Nutrition Last 7 days');
    expect(shown()).not.toMatch(/\d+ days? logged/);
    // Nothing is missing, so the key for the nothing-recorded mark is left out.
    expect(shown()).not.toContain('No entry');
  });

  it('keys the nothing-recorded mark once while a day is missing', async () => {
    nutrition = lastWeek({ 0: 1342 });
    await open();
    expect(count('No entry')).toBe(1);
  });
});

describe("Progress's muscle rows", () => {
  const landmark = { id: 'side', user_id: 'me', muscle_group: 'side_delts' as const, mv: 6, mev: 8, mav_low: 12, mav_high: 18, mrv: 22 };

  it('writes the quiet line as one fragment with no full stop', async () => {
    appStore.setState({ weeklyVolume: [{ muscle_group: 'side_delts', weekly_sets: 24, landmark, status: 'above_mrv' }] });
    calculateWeeklyVolume.mockImplementation(async () => {});
    await open();
    expect(shown()).toContain('Over its ceiling, pull back a little');
    expect(shown()).not.toContain('Over its ceiling.');
    expect(shown()).not.toContain('a little.');
  });

  it("keys the rails once, above the first muscle's row", async () => {
    appStore.setState({ weeklyVolume: [{ muscle_group: 'side_delts', weekly_sets: 24, landmark, status: 'above_mrv' }] });
    calculateWeeklyVolume.mockImplementation(async () => {});
    await open();
    const text = shown();
    expect(text.split('This week').length - 1).toBe(1);
    expect(text.indexOf('In range')).toBeGreaterThan(-1);
    expect(text.indexOf('In range')).toBeLessThan(text.indexOf('Side delts'));
  });

  it('keeps the shared coaching line as it is written', async () => {
    appStore.setState({ weeklyVolume: [{ muscle_group: 'side_delts', weekly_sets: 5, landmark, status: 'below_mev' }] });
    calculateWeeklyVolume.mockImplementation(async () => {});
    await open();
    expect(shown()).toContain('Add about 3 sets this week');
    expect(shown()).not.toContain('this week.');
  });
});

describe("Progress's scale and target figures", () => {
  /** The span showing exactly this text. */
  const figure = (text: string) => [...host.querySelectorAll('span')].find((span) => span.textContent === text);
  /** The height of the nearest box around an element that sets one. */
  const boxHeight = (element: Element | undefined) => {
    for (let at = element?.parentElement; at; at = at.parentElement) if (at.dataset.height !== undefined) return at.dataset.height;
    return undefined;
  };

  it("names the training chart's top and each nutrition target, in boxes with room for them", async () => {
    nutrition = lastWeek({ 0: 1342 }).map((day) => ({ ...day, protein: day.calories ? 130 : 0 }));
    appStore.setState({ macroTarget: { calories: 2600, protein: 190 } });
    await open();
    // 90 minutes this week puts the chart's top at 2 hours.
    for (const text of ['2 h', '2600 target', '190 target']) {
      const label = figure(text);
      expect(label, text).toBeDefined();
      // iOS shrank a figure that could shrink to fit a box of no height to nothing.
      expect(label?.dataset.shrinks, text).toBeUndefined();
      expect(Number(boxHeight(label)), text).toBeGreaterThan(0);
    }
  });

  it('names no target while none is set', async () => {
    nutrition = lastWeek({ 0: 1342 });
    await open();
    expect(shown()).not.toContain('target');
  });
});
