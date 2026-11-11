// @vitest-environment happy-dom
import { act, createElement, Fragment, type PropsWithChildren, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';

import type { WeekCheckIn } from '@/lib/weekCheckIn';
import { loadNativeModule } from './helpers/loadNativeModule';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Monday's look back on Today (native/src/components/WeekCheckInRow.tsx) is
// one row under Progress: the first thing the week holds, opening Last week,
// where the rest is. A swipe puts it away until next Monday (a hold lifts
// the whole group, to move it).

type Line = { label: string; value: string; after: string };
type RowProps = { title: string; value?: string; chevron?: boolean; onPress?: () => void; menu?: unknown };
type SwipeProps = PropsWithChildren<{ name: string; actions: { label: string; destructive?: boolean; onPress: () => void }[] }>;

const rows: RowProps[] = [];
const Row = (props: RowProps) => {
  rows.push(props);
  return createElement('span', { 'data-row': '' }, props.title);
};
const swipes: SwipeProps[] = [];
const SwipeRow = (props: SwipeProps) => {
  swipes.push(props);
  return createElement(Fragment, null, props.children);
};
const Wrap = ({ children }: PropsWithChildren) => createElement(Fragment, null, children);
const router = { push: vi.fn() };
const hideWeekCheckIn = vi.fn();
let lines: Line[] = [];
let holds = true;

const CHECK_IN = { week: { start: '2026-11-02', end: '2026-11-08' } } as unknown as WeekCheckIn;

let root: Root;
let host: HTMLDivElement;

async function show() {
  const { WeekCheckInRow } = loadNativeModule<{ WeekCheckInRow: (props: { checkIn: WeekCheckIn; todayKey: string }) => ReactNode }>('components/WeekCheckInRow.tsx', {
    'expo-router': { router },
    'react-native-reanimated': { default: { View: Wrap } },
    '@/lib/weekCheckIn': { goalPaceKg: () => null, hasCheckIn: () => holds },
    '@/stores/appStore': { useAppStore: create(() => ({ macroTarget: null, nutritionProfile: null })) },
    '~/lib/motion': { rowEnter: undefined },
    '~/lib/weekCheckIn': { checkInLines: () => lines, hideWeekCheckIn },
    '~/lib/you': { useWeightStore: create(() => ({ unit: 'lb' })) },
    './Row': { Hairline: () => createElement('hr'), Row },
    './SwipeRow': { SwipeRow },
  });
  await act(async () => { root.render(createElement(WeekCheckInRow, { checkIn: CHECK_IN, todayKey: '2026-11-09' })); });
}

beforeEach(() => {
  rows.length = 0;
  swipes.length = 0;
  lines = [];
  holds = true;
  router.push.mockClear();
  hideWeekCheckIn.mockClear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('Today’s Last week row', () => {
  it('is one row with the week’s weight alone, under a rule, and opens Last week', async () => {
    lines = [
      { label: 'Weight', value: '+1.5 lb', after: ' · ahead of pace' },
      { label: 'Calories a day', value: '2,918', after: ' of 2,800 kcal' },
    ];
    await show();

    expect(rows).toHaveLength(1);
    expect(host.querySelectorAll('hr')).toHaveLength(1);
    // "Last week" already names it: the weight needs no label of its own, and the other figures wait in Last week.
    expect(rows[0]).toMatchObject({ title: 'Last week', value: '+1.5 lb · ahead of pace', chevron: true });
    await act(async () => { rows[0].onPress!(); });
    expect(router.push).toHaveBeenCalledWith('/today/week');
  });

  it('names any other figure it leads with', async () => {
    lines = [{ label: 'Sets', value: '24', after: ' · 6 of 9 muscles in range' }];
    await show();
    expect(rows[0].value).toBe('Sets 24 · 6 of 9 muscles in range');
  });

  it('is put away until next Monday with a swipe, and has no hold menu of its own', async () => {
    lines = [{ label: 'Weight', value: '+0.3 lb', after: '' }];
    await show();
    // A hold belongs to the group, which lifts to be moved.
    expect(rows[0].menu).toBeUndefined();
    expect(swipes.at(-1)!.name).toBe('Last week');
    const hide = swipes.at(-1)!.actions.find((action) => action.label === 'Hide')!;
    await act(async () => { hide.onPress(); });
    expect(hideWeekCheckIn).toHaveBeenCalledWith('2026-11-09');
  });

  it('shows nothing for a week that holds nothing', async () => {
    holds = false;
    await show();
    expect(rows).toHaveLength(0);
    expect(host.textContent).toBe('');

    holds = true;
    lines = [];
    await show();
    expect(rows).toHaveLength(0);
  });
});
