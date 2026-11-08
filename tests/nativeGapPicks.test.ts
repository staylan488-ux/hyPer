// @vitest-environment happy-dom
import * as dates from 'date-fns';
import { act, createElement, Fragment, useEffect, type ComponentType, type PropsWithChildren } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as ledger from '@/lib/nutritionLedger';
import * as pendingIds from '@/lib/pendingEntryId';
import { recentFoodKey, type RecentLog } from '@/lib/recentFoods';
import * as recentFoods from '@/lib/recentFoods';
import type { Food, NutritionGroup } from '@/types';
import * as closeGap from '../native/src/lib/closeGap';
import * as format from '../native/src/lib/format';
import { mealForTime } from '../native/src/lib/meals';
import { loadNativeModule } from './helpers/loadNativeModule';

// Fuel's Close the gap card: today, in the evening, when today is well short
// (the reminder's measure), the usual foods that cover what's left. + logs one
// now at its usual amount into the meal that fits the time; the tick takes it
// back out; a tap reviews it in Log food; a swipe hides it. Touched, the card
// holds still until Fuel is left. Run as the app compiles it.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TODAY = '2026-11-08';
const Wrap = ({ children }: PropsWithChildren) => createElement(Fragment, null, children);
const Empty = () => null;
const noop = () => {};

const usual = (id: string, name: string, calories: number, protein: number): Food => ({
  id, user_id: 'user-1', name, calories, protein, carbs: 0, fat: 0, serving_size: 1, serving_unit: 'serving', source: 'custom', fdc_id: null,
});
const shake = usual('shake', 'Protein shake', 400, 40);
const toast = usual('toast', 'Peanut butter toast', 350, 12);
const yogurt = usual('yogurt', 'Greek yogurt', 150, 15);
const ate = (food: Food, date: string): RecentLog => ({ food_id: food.id, servings: 1, source: 'manual', date, logged_at: `${date}T12:00:00Z`, food });
const usualWeek = [
  ate(shake, '2026-11-05'), ate(shake, '2026-11-06'), ate(shake, '2026-11-07'),
  ate(toast, '2026-11-06'), ate(toast, '2026-11-07'),
  ate(yogurt, '2026-11-05'), ate(yogurt, '2026-11-07'),
];
const dinner: NutritionGroup = { id: 'g-dinner', user_id: 'user-1', date: TODAY, kind: 'meal', label: 'dinner', sort_order: 2 };

type RowProps = { food: Food; state?: string; detail?: string; servings?: number; onOpen: () => void; onAdd?: () => void; onTakeOut?: () => void };
type SwipeProps = PropsWithChildren<{ name: string; actions: { label: string; onPress: () => void }[] }>;
const rows: Record<string, RowProps> = {};
const swipes: Record<string, SwipeProps> = {};
const section: { title?: string; note?: string } = {};
const push = vi.fn();
const offerReview = vi.fn();
const refreshAfterWrite = vi.fn(async () => {});
const deleteEntry = vi.fn(async (id: string) => Boolean(id));
const saveQuickAdd = vi.fn(async (food: Food, entry: { pending: { take: () => string } }) => Boolean(food) && Boolean(entry));
const hidden: Record<string, number> = {};
const hideRecentFood = vi.fn((userId: string, key: string) => {
  hidden[key] = Date.now();
  return { ...hidden };
});
let settings = { enabled: false, minutes: 20 * 60 };
let kept: RecentLog[] | null = usualWeek;
let snapshot: { userId: string; logs: RecentLog[]; at: number } | null = null;
// Fuel's focus: the card's cleanup runs as Fuel is left.
const focus: { effect?: () => void | (() => void); cleanup?: void | (() => void) } = {};
const leaveFuel = () => act(async () => { focus.cleanup?.(); focus.cleanup = undefined; });

const GapPicks = loadNativeModule<{ GapPicks: ComponentType<Record<string, unknown>> }>('fuel/GapPicks.tsx', {
  'date-fns': dates,
  'expo-router': {
    router: { push },
    useFocusEffect: (effect: () => void | (() => void)) => {
      useEffect(() => {
        focus.effect = effect;
        focus.cleanup = effect();
        return () => {
          focus.cleanup?.();
          focus.cleanup = undefined;
        };
      }, [effect]);
    },
  },
  'react-native-reanimated': { default: { View: Wrap } },
  '@/lib/appVisibility': { onAppVisible: () => noop },
  '@/lib/nutritionLedger': ledger,
  '@/lib/pendingEntryId': pendingIds,
  '@/lib/recentFoods': recentFoods,
  '~/components/Label': { Label: Wrap },
  '~/components/Row': { Hairline: Empty },
  '~/components/Section': {
    Section: ({ title, note, children }: PropsWithChildren<{ title: string; note?: string }>) => {
      section.title = title;
      section.note = note;
      useEffect(() => () => {
        section.title = undefined;
        section.note = undefined;
      }, []);
      return createElement('section', null, children);
    },
  },
  '~/components/SwipeRow': {
    SwipeRow: (props: SwipeProps) => {
      swipes[props.name] = props;
      return createElement(Fragment, null, props.children);
    },
  },
  '~/lib/accessibility': { announce: noop },
  '~/lib/closeGap': closeGap,
  '~/lib/format': format,
  '~/lib/fuel': {
    loadDayGroups: async () => [dinner],
    suggestedGroup: (groups: NutritionGroup[], at: Date) => groups.find((group) => group.label === mealForTime(at)) ?? null,
    useFuelStore: { getState: () => ({ refreshAfterWrite, deleteEntry }) },
  },
  '~/lib/fuelReminder': { useFuelReminderStore: (select: (state: { settings: typeof settings }) => unknown) => select({ settings }) },
  '~/lib/haptics': { haptics: { tap: noop, select: noop, success: noop, error: noop } },
  '~/lib/motion': {},
  './context': { offerReview },
  './FoodLists': {
    // Rows on screen: drawn rows update their props, removed rows leave.
    FoodRow: (props: RowProps) => {
      rows[props.food.name] = props;
      const name = props.food.name;
      useEffect(() => () => {
        delete rows[name];
      }, [name]);
      return null;
    },
    foodLine: (_food: Food, _servings: number, amount: string) => amount,
    quickAddMenu: () => [],
    saveQuickAdd,
  },
  './recent': {
    hideRecentFood,
    loadRecentCache: async () => {},
    readHidden: () => ({ ...hidden }),
    // The same object until the logs change, as the real cache keeps it.
    readRecentCache: (userId: string) => {
      if (!kept) return null;
      if (snapshot?.logs !== kept) snapshot = { userId, logs: kept, at: 0 };
      return snapshot;
    },
    subscribeRecentCache: () => noop,
  },
}, { compile: true }).GapPicks;

const totals = (calories: number, protein: number) => ({ calories, protein, carbs: 0, fat: 0 });
const target = { calories: 2800, protein: 160 };
let root: Root | undefined;
let props: Record<string, unknown>;

async function show(overrides: Record<string, unknown> = {}) {
  props = { userId: 'user-1', day: TODAY, totals: totals(1950, 120), target, goal: 'bulk', dayLogs: [], ...overrides };
  if (!root) root = createRoot(document.createElement('div'));
  await act(async () => { root!.render(createElement(GapPicks, props)); });
}
const shown = () => Object.keys(rows);
const clearRows = () => {
  for (const key of Object.keys(rows)) delete rows[key];
  section.title = undefined;
  section.note = undefined;
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`${TODAY}T19:30:00`));
  clearRows();
  for (const key of Object.keys(hidden)) delete hidden[key];
  for (const key of Object.keys(swipes)) delete swipes[key];
  kept = usualWeek;
  settings = { enabled: false, minutes: 20 * 60 };
  for (const mock of [push, offerReview, refreshAfterWrite, deleteEntry, saveQuickAdd, hideRecentFood]) mock.mockClear();
  saveQuickAdd.mockImplementation(async () => true);
  deleteEntry.mockImplementation(async () => true);
});
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  root = undefined;
  vi.useRealTimers();
});

describe('when Close the gap shows', () => {
  it('in the evening, well short: the usual foods that cover it, with their total', async () => {
    await show();
    expect(section).toEqual({ title: 'Close the gap', note: '900 kcal' });
    expect(shown()).toEqual(['Protein shake', 'Peanut butter toast', 'Greek yogurt']);
    expect(rows['Protein shake']).toMatchObject({ servings: 1, detail: '1 serving' });
  });

  it('not before 6 PM, unless the reminder is set earlier', async () => {
    vi.setSystemTime(new Date(`${TODAY}T17:15:00`));
    await show();
    expect(shown()).toEqual([]);
    settings = { enabled: true, minutes: 17 * 60 };
    await show();
    expect(section.title).toBe('Close the gap');
  });

  it('not once the target is near, with nothing logged, or without usual foods', async () => {
    await show({ totals: totals(2500, 150) });
    expect(shown()).toEqual([]);
    await show({ totals: totals(0, 0) });
    expect(shown()).toEqual([]);
    kept = [ate(shake, '2026-11-07')];
    await show();
    expect(shown()).toEqual([]);
  });

  it('on a cut, for protein only, within the calories left', async () => {
    await show({ goal: 'cut', totals: totals(2300, 110) });
    expect(section.note).toBe('40 g protein');
    expect(shown()).toEqual(['Protein shake']);
  });
});

describe('logging a pick', () => {
  it('+ logs it now at its usual amount into the meal that fits the time, and the tick takes it back out', async () => {
    await show();
    await act(async () => { rows['Protein shake'].onAdd!(); });
    expect(saveQuickAdd).toHaveBeenCalledTimes(1);
    const [food, entry] = saveQuickAdd.mock.calls[0] as unknown as [Food, { servings: number; source: string; when: { time: string; groupId: string | null }; groups: NutritionGroup[] }];
    expect(food).toBe(shake);
    expect(entry).toMatchObject({ servings: 1, source: 'manual', when: { time: '19:30', groupId: 'g-dinner' }, groups: [dinner] });
    expect(rows['Protein shake'].state).toBe('done');
    expect(refreshAfterWrite).toHaveBeenCalledTimes(1);

    await act(async () => { rows['Protein shake'].onTakeOut!(); });
    expect(deleteEntry).toHaveBeenCalledTimes(1);
    expect(rows['Protein shake'].state).toBeUndefined();
  });

  it('never logs a pick twice from two quick taps', async () => {
    await show();
    await act(async () => {
      rows['Protein shake'].onAdd!();
      rows['Protein shake'].onAdd!();
    });
    expect(saveQuickAdd).toHaveBeenCalledTimes(1);
  });

  it('retries an unconfirmed add under the same entry id', async () => {
    const ids: string[] = [];
    saveQuickAdd.mockImplementation(async (_food, entry) => {
      ids.push(entry.pending.take());
      return ids.length > 1;
    });
    await show();
    await act(async () => { rows['Protein shake'].onAdd!(); });
    expect(rows['Protein shake'].state).toBe('error');
    await act(async () => { rows['Protein shake'].onAdd!(); });
    expect(rows['Protein shake'].state).toBe('done');
    expect(ids[0]).toBe(ids[1]);
  });

  it('holds the card still once touched, then lets it go as Fuel is left', async () => {
    await show();
    await act(async () => { rows['Protein shake'].onAdd!(); });
    // The day's food now reaches the target: the card stays, with its tick.
    await show({ totals: totals(2700, 160) });
    expect(shown()).toEqual(['Protein shake', 'Peanut butter toast', 'Greek yogurt']);
    expect(rows['Protein shake'].state).toBe('done');
    await leaveFuel();
    await show({ totals: totals(2700, 160) });
    expect(shown()).toEqual([]);
  });
});

describe('a pick’s other actions', () => {
  it('a tap reviews it in Log food at the usual amount', async () => {
    await show();
    await act(async () => { rows['Peanut butter toast'].onOpen(); });
    expect(offerReview).toHaveBeenCalledWith(toast, 1);
    expect(push).toHaveBeenCalledWith({ pathname: '/log-food', params: { day: TODAY, review: '1' } });
  });

  it('a swipe hides it here and in Recent; the others stay where they are', async () => {
    await show();
    await act(async () => { swipes['Peanut butter toast'].actions[0].onPress(); });
    expect(hideRecentFood).toHaveBeenCalledWith('user-1', recentFoodKey(toast));
    expect(shown()).toEqual(['Protein shake', 'Greek yogurt']);
  });
});
