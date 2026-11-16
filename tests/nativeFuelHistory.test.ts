// @vitest-environment happy-dom
import * as dates from 'date-fns';
import { act, createElement, Fragment, type ComponentType, type PropsWithChildren, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DailyNutrition } from '@/hooks/useWeeklyNutrition';
import { averageLoggedDays } from '@/hooks/useWeeklyNutrition';
import * as fuelHistory from '../native/src/lib/fuelHistory';
import { loadNativeModule } from './helpers/loadNativeModule';
import { silentAccessibility } from './helpers/silentAccessibility';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Fuel's history (native/src/app/(tabs)/fuel/history.tsx): the logged days by
// week, newest first, each week headed by its averages; a day opens in Fuel.

type Read = { weeklyNutrition: DailyNutrition[]; loading: false; error: null } | null;

let root: Root | undefined;
afterEach(async () => {
  await act(async () => { root?.unmount(); root = undefined; });
});

const TODAY = '2026-11-14';

/** Days before today, oldest first: calories eaten so many days ago (0 for none), protein a twentieth of it. */
const daysBefore = (count: number, eaten: (ago: number) => number): DailyNutrition[] =>
  Array.from({ length: count }, (_, index) => count - index).map((ago) => ({
    date: dates.format(dates.subDays(dates.parseISO(TODAY), ago), 'yyyy-MM-dd'),
    calories: eaten(ago),
    protein: eaten(ago) / 20,
  }));

async function openHistory(reads: Read[], firstLogged: string | null | undefined = '2026-10-20') {
  // Each read is answered in turn; what it asked for is checked by its arguments.
  const fetchWeeklyNutrition = vi.fn<(last?: string, days?: number) => Promise<Read>>(async () => reads.shift() ?? null);
  const fuel = { select: vi.fn() };
  const back = vi.fn();
  const Box = ({ children }: PropsWithChildren) => createElement('div', null, children);
  const Screen = loadNativeModule<{ default: ComponentType }>('app/(tabs)/fuel/history.tsx', {
    'date-fns': dates,
    'expo-router': { router: { back }, Stack: { Screen: () => null } },
    'react-native': { ActivityIndicator: () => createElement('progress'), RefreshControl: () => null, View: Box },
    '@/hooks/useWeeklyNutrition': { averageLoggedDays, fetchWeeklyNutrition },
    '~/components/BlancText': { BlancText: ({ children }: PropsWithChildren) => createElement('span', null, children) },
    '~/components/Capsule': {
      Capsule: ({ title, onPress, disabled }: { title: string; onPress: () => void; disabled?: boolean }) => createElement('button', { onClick: onPress, disabled }, title),
    },
    '~/components/Label': { Label: Box },
    '~/components/Row': {
      Hairline: () => null,
      Row: ({ title, value, onPress }: { title: string; value: string; onPress: () => void }) => createElement('button', { 'data-row': title, onClick: onPress }, `${title} ${value}`),
    },
    '~/components/Section': {
      Section: ({ title, note, children }: PropsWithChildren<{ title: string; note?: string }>) =>
        createElement('section', null, createElement('h2', null, note ? `${title} ${note}` : title), children),
    },
    '~/components/TabScroll': { TabScroll: ({ children }: { children: ReactNode }) => createElement(Fragment, null, children) },
    '~/lib/accessibility': silentAccessibility,
    '~/lib/accountData': { useCurrentDayKey: () => TODAY },
    '~/lib/format': { formatWhole: (value: number) => Math.round(value).toLocaleString('en-US') },
    '~/lib/fuel': { useFuelStore: { getState: () => fuel } },
    '~/lib/fuelHistory': { ...fuelHistory, readFirstLoggedDay: async () => firstLogged },
    '~/theme/blanc': { space: { gutter: 16 }, useBlanc: () => ({ graphite: 'graphite' }) },
  }).default;
  const container = document.createElement('div');
  root = createRoot(container);
  await act(async () => { root!.render(createElement(Screen)); });
  await act(async () => { for (let tick = 0; tick < 5; tick += 1) await Promise.resolve(); });
  const headings = () => [...container.querySelectorAll('h2')].map((heading) => heading.textContent);
  const rows = () => [...container.querySelectorAll('[data-row]')].map((row) => row.textContent);
  const press = async (text: string) => {
    const button = [...container.querySelectorAll('button')].find((candidate) => candidate.getAttribute('data-row') === text || candidate.textContent === text);
    expect(button, text).toBeDefined();
    await act(async () => { button!.click(); });
    await act(async () => { for (let tick = 0; tick < 5; tick += 1) await Promise.resolve(); });
  };
  return { container, headings, rows, press, fetchWeeklyNutrition, fuel, back };
}

describe("Fuel's history", () => {
  it('reads twelve whole weeks ending yesterday, and lists only logged days, newest first, by week', async () => {
    // Nov 9 to 13 (this week) and Nov 2 to 8, with Nov 11 and Nov 5 unlogged; one day in the week of Oct 26.
    const history = await openHistory([{ weeklyNutrition: daysBefore(82, (ago) => (ago === 3 || ago === 9 ? 0 : ago <= 12 ? 2600 + ago * 10 : ago === 15 ? 2000 : 0)), loading: false, error: null }]);
    expect(history.fetchWeeklyNutrition).toHaveBeenCalledWith('2026-11-13', 82);
    expect(history.headings()).toEqual([
      // (2610 + 2620 + 2640 + 2650) / 4 and (2660 + 2670 + 2680 + 2700 + 2710 + 2720) / 6
      'This week Avg 2,630 kcal · 132 g',
      'Last week Avg 2,690 kcal · 135 g',
      // One day: its row says it, so no average.
      'Oct 26–Nov 1',
    ]);
    expect(history.rows().slice(0, 4)).toEqual(['Fri, Nov 13 2,610 kcal · 131 g', 'Thu, Nov 12 2,620 kcal · 131 g', 'Tue, Nov 10 2,640 kcal · 132 g', 'Mon, Nov 9 2,650 kcal · 133 g']);
    expect(history.container.textContent).not.toContain('Wed, Nov 11');
    expect(history.container.textContent).not.toContain('Today');
  });

  it('opens a day in Fuel', async () => {
    const history = await openHistory([{ weeklyNutrition: daysBefore(82, (ago) => (ago === 2 ? 2400 : 0)), loading: false, error: null }]);
    await history.press('Thu, Nov 12');
    expect(history.fuel.select).toHaveBeenCalledWith('2026-11-12');
    expect(history.back).toHaveBeenCalled();
  });

  it('offers earlier weeks until the first day ever logged is shown', async () => {
    const reads: Read[] = [
      { weeklyNutrition: daysBefore(82, (ago) => (ago === 2 ? 2400 : 0)), loading: false, error: null },
      { weeklyNutrition: daysBefore(166, (ago) => (ago === 2 || ago === 120 ? 2400 : 0)), loading: false, error: null },
    ];
    const history = await openHistory(reads, '2026-07-17');
    await history.press('Show earlier weeks');
    expect(history.fetchWeeklyNutrition).toHaveBeenLastCalledWith('2026-11-13', 166);
    expect(history.rows()).toEqual(['Thu, Nov 12 2,400 kcal · 120 g', 'Fri, Jul 17 2,400 kcal · 120 g']);
    expect(history.container.textContent).not.toContain('Show earlier weeks');
  });

  it('says when nothing is logged yet, and when the days could not load', async () => {
    const empty = await openHistory([{ weeklyNutrition: [], loading: false, error: null }], null);
    expect(empty.container.textContent).toContain('Days you log show here once they’re over.');
    expect(empty.container.textContent).not.toContain('Show earlier weeks');
    await act(async () => { root?.unmount(); root = undefined; });
    const failed = await openHistory([null]);
    expect(failed.container.textContent).toContain('Couldn’t load your history. Pull down to try again.');
  });
});
