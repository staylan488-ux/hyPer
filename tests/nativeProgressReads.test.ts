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
// Text and views keep what the checks read: whether text may shrink to fit,
// a box's height and place, its fill (a palette token's name, below) and
// what VoiceOver hears for it.
const Text = ({ children, adjustsFontSizeToFit }: PropsWithChildren<{ adjustsFontSizeToFit?: boolean }>) =>
  createElement('span', adjustsFontSizeToFit ? { 'data-shrinks': 'true' } : null, children);
const View = ({
  children,
  style,
  accessibilityLabel,
}: PropsWithChildren<{ style?: { height?: number | string; width?: number | string; bottom?: number | string; alignItems?: string; backgroundColor?: string }; accessibilityLabel?: string }>) =>
  createElement(
    'div',
    {
      ...(style?.height !== undefined ? { 'data-height': String(style.height) } : null),
      ...(style?.width !== undefined ? { 'data-width': String(style.width) } : null),
      ...(style?.bottom !== undefined ? { 'data-bottom': String(style.bottom) } : null),
      ...(style?.alignItems !== undefined ? { 'data-align': style.alignItems } : null),
      ...(style?.backgroundColor !== undefined ? { 'data-fill': style.backgroundColor } : null),
      ...(accessibilityLabel !== undefined ? { 'aria-label': accessibilityLabel } : null),
    },
    children,
  );
// The palette by token name, so a check reads which token a mark is drawn in.
const palette = { label: 'label', graphite: 'graphite', ink: 'ink', mark: 'mark', live: 'live', fill: 'fill', track: 'track', hairline: 'hairline', pressed: 'pressed' };

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

// The seven days of eating the screen reads; none by default. Each read's last day is kept.
type Day = { date: string; calories: number; protein: number };
let nutrition: Day[] = [];
let askedFor: Array<string | undefined> = [];
const averageLoggedDays = (days: Day[], key: 'calories' | 'protein') => {
  const logged = days.filter((day) => day[key] > 0);
  return logged.length ? logged.reduce((sum, day) => sum + day[key], 0) / logged.length : 0;
};
/** The seven days before `today` (by default the account's day), as the hook gives them: calories eaten so many days ago. */
const weekBefore = (eaten: Record<number, number>, today = accountDay.getState().dayKey): Day[] =>
  [7, 6, 5, 4, 3, 2, 1].map((ago) => ({ date: dates.format(dates.subDays(dates.parseISO(today), ago), 'yyyy-MM-dd'), calories: eaten[ago] ?? 0, protein: 0 }));

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
    '@/hooks/useWeeklyNutrition': {
      averageLoggedDays,
      useWeeklyNutrition: (lastDay?: string) => {
        askedFor.push(lastDay);
        return { weeklyNutrition: nutrition, loading: false, error: null };
      },
    },
    '@/lib/fuelSummary': fuelSummary,
    '@/lib/trainingHours': { fetchTrainingHours },
    '@/lib/volumeCoaching': volumeCoaching,
    '@/lib/volumeStatus': volumeStatus,
    '@/lib/workoutSessions': workoutSessions,
    '@/stores/appStore': { initialAppData, useAppStore: appStore },
    '@/types': types,
    '~/components/BlancText': { BlancText: Text },
    '~/components/Capsule': { Capsule: ({ title, onPress }: { title: string; onPress: () => void }) => createElement('button', { onClick: onPress }, title) },
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
    '~/theme/blanc': { space: { gutter: 20 }, useBlanc: () => palette },
    '~/theme/useMuscleTones': { useMuscleTones: () => ({}) },
  });
  await act(async () => { root.render(createElement(ProgressScreen)); });
}
const refresh = () => act(async () => { pull(); });

beforeEach(() => {
  nutrition = [];
  askedFor = [];
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
    // the chart stays, and says it is not fresh
    expect(shown()).toContain('Couldn’t refresh. Pull down to try again.');
  });

  it('draws no chart of empty weeks when the first read fails, says so, and offers Retry', async () => {
    fetchTrainingHours.mockResolvedValueOnce(null);
    await open();
    expect(shown()).not.toContain('Week to date');
    expect(shown()).toContain('Training time couldn’t load.');
    const retry = [...host.querySelectorAll('button')].find((button) => button.textContent === 'Retry');
    expect(retry).toBeDefined();
    await act(async () => { retry!.click(); });
    await act(async () => { for (let tick = 0; tick < 10; tick += 1) await Promise.resolve(); });
    expect(shown()).toContain('Week to date');
    expect(shown()).not.toContain('Training time couldn’t load.');
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

describe("Progress's nutrition window", () => {
  const count = (text: string) => shown().split(text).length - 1;
  /** What VoiceOver hears for a macro's chart. */
  const spoken = (macro: string) => [...host.querySelectorAll('[aria-label]')].map((el) => el.getAttribute('aria-label') ?? '').find((label) => label.startsWith(`${macro}, `));

  it('reads the seven days ending yesterday, and moves on with the day while the screen stays open', async () => {
    accountDay.setState({ dayKey: '2026-11-05' });
    await open();
    expect(askedFor.at(-1)).toBe('2026-11-04');
    // Past midnight, the screen still on top
    await act(async () => { accountDay.setState({ dayKey: '2026-11-06' }); });
    expect(askedFor.at(-1)).toBe('2026-11-05');
    expect(shown()).toContain('Nutrition Oct 30–Nov 5');
  });

  it('names its dates across two months, and says once how many days are logged', async () => {
    accountDay.setState({ dayKey: '2026-11-05' });
    nutrition = weekBefore({ 1: 2000, 3: 2400 });
    await open();
    expect(shown()).toContain('Nutrition Oct 29–Nov 4 · 2 days logged');
    expect(count('days logged')).toBe(1);
    expect(shown()).not.toContain('Last 7 days');
  });

  it('names one month once when the seven days are within it', async () => {
    accountDay.setState({ dayKey: '2026-11-08' });
    nutrition = weekBefore({ 1: 2000, 2: 2000, 3: 2000, 4: 2000, 5: 2000, 6: 2000, 7: 2000 });
    await open();
    expect(shown()).toContain('Nutrition Nov 1–7');
    // Every day is logged, so no count.
    expect(shown()).not.toMatch(/\d+ days? logged/);
  });

  it('heads each chart with the daily average of the logged days, and says so to VoiceOver', async () => {
    accountDay.setState({ dayKey: '2026-11-05' });
    nutrition = weekBefore({ 1: 2000, 3: 2400 });
    await open();
    expect(shown()).toContain('Avg 2200 kcal');
    expect(spoken('Calories')).toContain('Calories, 2200 calories, the daily average of the logged days, October 29 to November 4');
    expect(shown()).not.toContain('Today');
  });

  it('gives one logged day as its figure, named by its date', async () => {
    accountDay.setState({ dayKey: '2026-11-05' });
    nutrition = weekBefore({ 2: 1342 });
    await open();
    expect(shown()).toContain('Nov 3 1342 kcal');
    expect(shown()).not.toContain('Avg 1342');
    expect(shown()).not.toContain('Today');
    expect(shown()).toContain('Oct 29–Nov 4 · 1 day logged');
    expect(count('1 day logged')).toBe(1);
    expect(spoken('Calories')).toContain('Calories, 1342 calories on November 3, the only day logged');
  });

  it('says none logged for a macro with nothing in the seven days', async () => {
    accountDay.setState({ dayKey: '2026-11-05' });
    nutrition = weekBefore({ 1: 2000, 3: 2400 });
    await open();
    // Calories are logged; protein is not.
    expect(count('None logged')).toBe(1);
    expect(spoken('Protein')).toContain('Protein, none logged, October 29 to November 4');
  });

  it('still names its dates with nothing logged in them, and says when a day shows here', async () => {
    accountDay.setState({ dayKey: '2026-11-05' });
    await open();
    expect(shown()).toContain('Nutrition Oct 29–Nov 4');
    expect(shown()).toContain('Days you log in Fuel show here once they’re over.');
  });

  it('keys the nothing-recorded mark once while a day is missing, and not when none is', async () => {
    nutrition = weekBefore({ 1: 1342 });
    await open();
    expect(count('No entry')).toBe(1);
    act(() => root.unmount());
    root = createRoot(host);
    nutrition = weekBefore({ 1: 500, 2: 2000, 3: 2000, 4: 2000, 5: 2000, 6: 2000, 7: 2000 }).map((day) => ({ ...day, protein: 150 }));
    await open();
    expect(shown()).not.toContain('No entry');
  });
});

describe("Progress's chart marks", () => {
  const fills = (token: string) => host.querySelectorAll(`[data-fill="${token}"]`).length;

  it("draws past weeks in mark and this week in ink, with no faded bars", async () => {
    const today = new Date();
    const session = (daysAgo: number) => {
      const day = dates.subDays(today, daysAgo);
      return { date: dates.format(day, 'yyyy-MM-dd'), completed: true, created_at: new Date(day.getTime() - 60 * 60_000).toISOString(), completed_at: day.toISOString() };
    };
    fetchTrainingHours.mockResolvedValue(workoutSessions.buildWeeklyTrainingHours([session(0), session(14), session(21)]));
    await open();
    // This week's bar is the one ink mark; the two past weeks are mark.
    expect(fills('ink')).toBe(1);
    expect(fills('mark')).toBe(2);
    expect(fills('graphite')).toBe(0);
  });

  it('draws every one of the seven days in mark, red only past target where that warns', async () => {
    fetchTrainingHours.mockResolvedValue(null);
    nutrition = weekBefore({ 1: 2000, 3: 2400, 5: 3400 });
    appStore.setState({ macroTarget: { calories: 2600, protein: 190 } });
    await open();
    expect(fills('mark')).toBe(2);
    expect(fills('live')).toBe(1);
    expect(fills('ink')).toBe(0);
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

  it("draws the rail's band in mark, the figure's in-range tone, on a fill track", async () => {
    appStore.setState({ weeklyVolume: [{ muscle_group: 'side_delts', weekly_sets: 14, landmark, status: 'mav' }] });
    calculateWeeklyVolume.mockImplementation(async () => {});
    await open();
    // The key's band and the row's band.
    expect(host.querySelectorAll('[data-fill="mark"]').length).toBe(2);
    expect(host.querySelectorAll('[data-fill="fill"]').length).toBe(1);
    expect(host.querySelectorAll('[data-fill="track"]').length).toBe(0);
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
    nutrition = weekBefore({ 1: 1342 }).map((day) => ({ ...day, protein: day.calories ? 130 : 0 }));
    appStore.setState({ macroTarget: { calories: 2600, protein: 190 } });
    await open();
    // 90 minutes this week puts the chart's top at 2 hours.
    for (const text of ['2 h', '2600', '190']) {
      const label = figure(text);
      expect(label, text).toBeDefined();
      // iOS shrank a figure that could shrink to fit a box of no height to nothing.
      expect(label?.dataset.shrinks, text).toBeUndefined();
      expect(Number(boxHeight(label)), text).toBeGreaterThan(0);
    }
  });

  it('keeps a target figure at its line, in a column of its own beside the bars, when days run past it', async () => {
    // Days at both ends well past 2,600, so no end of the line is clear.
    nutrition = weekBefore({ 1: 3400, 2: 3300, 7: 3200, 6: 3100 }).map((day) => ({ ...day, protein: 0 }));
    appStore.setState({ macroTarget: { calories: 2600, protein: 190 } });
    await open();
    const label = figure('2600');
    expect(label).toBeDefined();
    // the box that places it: at the target's own height...
    let box = label?.parentElement;
    while (box && box.dataset.bottom === undefined) box = box.parentElement;
    const max = Math.max(1, 2600 * 1.3, 3400);
    expect(box?.dataset.bottom).toBe(`${(2600 / max) * 100}%`);
    // ...inside the figure column, which holds no bars.
    let column = box?.parentElement;
    while (column && column.dataset.width === undefined) column = column.parentElement;
    expect(Number(column?.dataset.width)).toBeGreaterThanOrEqual(50);
    expect(column?.querySelector('[data-fill="mark"], [data-fill="live"]')).toBeNull();
    // The dashed line is named once, in the key under both charts.
    expect(shown()).toContain('Target');
  });

  it('names no target while none is set', async () => {
    nutrition = weekBefore({ 1: 1342 });
    await open();
    expect(shown()).not.toContain('target');
  });
});
