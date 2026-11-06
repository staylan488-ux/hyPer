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
const Text = ({ children }: PropsWithChildren) => createElement('span', null, children);

let pull: () => void;
const fetchTrainingHours = vi.fn();
const calculateWeeklyVolume = vi.fn();
// The store's never-read list; resetAppData puts this same array back.
const initialAppData = { weeklyVolume: [] as MuscleVolume[] };
const appStore = create(() => ({
  weeklyVolume: initialAppData.weeklyVolume,
  macroTarget: null,
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
      View: Wrap,
    },
    'react-native-reanimated': {
      default: { View: Wrap },
      FadeIn: { duration: () => undefined },
      LinearTransition: { duration: () => undefined },
      useAnimatedStyle: () => ({}),
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
    '~/theme/blanc': { space: { gutter: 20 }, useBlanc: () => ({}) },
  });
  await act(async () => { root.render(createElement(ProgressScreen)); });
}
const refresh = () => act(async () => { pull(); });

beforeEach(() => {
  nutrition = [];
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
  it('averages the logged days before today and says how many while some are missing', async () => {
    nutrition = lastWeek({ 0: 800, 1: 2000, 3: 2400 });
    await open();
    expect(shown()).toContain('Avg 2200 kcal over 2 days');
    expect(shown()).not.toContain('today');
  });

  it("uses today's figure while today is the only day logged", async () => {
    nutrition = lastWeek({ 0: 1342 });
    await open();
    expect(shown()).toContain('Avg 1342 kcal over 1 day');
  });

  it('names no count once every earlier day is logged', async () => {
    nutrition = lastWeek({ 0: 500, 1: 2000, 2: 2000, 3: 2000, 4: 2000, 5: 2000, 6: 2000 });
    await open();
    expect(shown()).toContain('Avg 2000 kcal');
    expect(shown()).not.toContain('kcal over');
  });
});
