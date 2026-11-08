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
const returnToFuel = () => act(async () => { focus.cleanup = focus.effect?.(); });

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

  it('reuses an unconfirmed write after leaving Fuel, even when a fresh read closes the gap', async () => {
    const ids: string[] = [];
    const persisted = new Set<string>();
    saveQuickAdd.mockImplementation(async (_food, entry) => {
      const id = entry.pending.take();
      ids.push(id);
      persisted.add(id); // The server commits both attempts; the first response is lost.
      return ids.length > 1;
    });
    await show();
    await act(async () => { rows['Protein shake'].onAdd!(); });
    expect(rows['Protein shake'].state).toBe('error');

    await leaveFuel();
    vi.setSystemTime(new Date(`${TODAY}T20:00:00`));
    await show({ totals: totals(2700, 160) });
    await returnToFuel();
    expect(rows['Protein shake']?.state).toBe('error');
    await act(async () => { rows['Protein shake'].onAdd!(); });

    expect(ids).toHaveLength(2);
    expect(ids[1]).toBe(ids[0]);
    expect(persisted.size).toBe(1);
    expect(saveQuickAdd.mock.calls[1][1]).toEqual(saveQuickAdd.mock.calls[0][1]);
    expect(rows['Protein shake'].state).toBe('done');
    await leaveFuel();
    await returnToFuel();
    expect(shown()).toEqual([]);
  });

  it('keeps the retry id when a save fails after Fuel was left', async () => {
    let finish!: (saved: boolean) => void;
    const ids: string[] = [];
    saveQuickAdd.mockImplementation((_food, entry) => {
      ids.push(entry.pending.take());
      return new Promise<boolean>((resolve) => { finish = resolve; });
    });
    await show();
    await act(async () => { rows['Protein shake'].onAdd!(); });
    expect(rows['Protein shake'].state).toBe('saving');
    await leaveFuel();
    await act(async () => { finish(false); });
    await returnToFuel();
    await leaveFuel();
    await returnToFuel();
    await act(async () => { rows['Protein shake'].onAdd!(); });
    expect(ids).toHaveLength(2);
    expect(ids[1]).toBe(ids[0]);
    await act(async () => { finish(true); });
    expect(rows['Protein shake'].state).toBe('done');
  });

  it.each(['day', 'account'])('does not reuse another %s’s pending add', async (scope) => {
    const ids: string[] = [];
    saveQuickAdd.mockImplementation(async (_food, entry) => {
      ids.push(entry.pending.take());
      return false;
    });
    await show();
    await act(async () => { rows['Protein shake'].onAdd!(); });
    await leaveFuel();
    vi.setSystemTime(new Date('2026-11-09T19:30:00'));
    await show(scope === 'day' ? { day: '2026-11-09' } : { userId: 'user-2' });
    await returnToFuel();
    expect(rows['Protein shake'].state).toBeUndefined();
    await act(async () => { rows['Protein shake'].onAdd!(); });
    expect(ids).toHaveLength(2);
    expect(ids[1]).not.toBe(ids[0]);
  });

  it.each([false, true])('retains the attempt while another date hides the card (response delayed: %s)', async (delayed) => {
    const ids: string[] = [];
    const persisted = new Set<string>();
    let finish!: (saved: boolean) => void;
    saveQuickAdd.mockImplementation(async (_food, entry) => {
      const id = entry.pending.take();
      ids.push(id);
      persisted.add(id);
      return ids.length > 1 || (delayed ? new Promise<boolean>((resolve) => { finish = resolve; }) : false);
    });
    await show();
    await act(async () => { rows['Protein shake'].onAdd!(); });
    await show({ visible: false, totals: totals(0, 0) });
    expect(shown()).toEqual([]);
    if (delayed) await act(async () => { finish(false); });
    vi.setSystemTime(new Date(`${TODAY}T20:00:00`));
    await show({ visible: true, totals: totals(2700, 160) });
    expect(rows['Protein shake']?.state).toBe('error');
    await act(async () => { rows['Protein shake'].onAdd!(); });
    expect(ids).toHaveLength(2);
    expect(ids[1]).toBe(ids[0]);
    expect(persisted.size).toBe(1);
    expect(saveQuickAdd.mock.calls[1][1]).toEqual(saveQuickAdd.mock.calls[0][1]);
  });

  it.each(['blur', 'date'])('releases confirmed ticks independently of unresolved retries on %s', async (navigation) => {
    const ids: { food: string; id: string }[] = [];
    saveQuickAdd.mockImplementation(async (food, entry) => {
      ids.push({ food: food.id, id: entry.pending.take() });
      return food === toast;
    });
    await show();
    await act(async () => { rows['Peanut butter toast'].onAdd!(); });
    await act(async () => { rows['Protein shake'].onAdd!(); });
    expect(rows['Peanut butter toast'].state).toBe('done');
    expect(rows['Protein shake'].state).toBe('error');
    if (navigation === 'blur') await leaveFuel();
    else await show({ visible: false });
    // Log food removed the confirmed toast; the unconfirmed shake must still be retryable.
    await show({ dayLogs: [] });
    if (navigation === 'blur') await returnToFuel();
    expect(rows['Peanut butter toast'].state).toBeUndefined();
    expect(rows['Protein shake'].state).toBe('error');
    await act(async () => { rows['Peanut butter toast'].onAdd!(); });
    await act(async () => { rows['Protein shake'].onAdd!(); });
    expect(ids).toHaveLength(4);
    expect(ids[2].id).not.toBe(ids[0].id);
    expect(ids[3]).toEqual(ids[1]);
  });

  it('releases a confirmed tick on refocus even when its response arrived while away', async () => {
    let finish!: (saved: boolean) => void;
    saveQuickAdd.mockImplementation(async (food) => food === toast ? new Promise<boolean>((resolve) => { finish = resolve; }) : false);
    await show();
    await act(async () => { rows['Protein shake'].onAdd!(); });
    await act(async () => { rows['Peanut butter toast'].onAdd!(); });
    await leaveFuel();
    await act(async () => { finish(true); });
    await show({ dayLogs: [] });
    await returnToFuel();
    expect(rows['Peanut butter toast'].state).toBeUndefined();
    expect(rows['Protein shake'].state).toBe('error');
  });

  it('keeps every unresolved pick when another pick confirms', async () => {
    const ids: { food: string; id: string }[] = [];
    saveQuickAdd.mockImplementation(async (food, entry) => {
      ids.push({ food: food.id, id: entry.pending.take() });
      return false;
    });
    await show();
    await act(async () => { rows['Protein shake'].onAdd!(); });
    await act(async () => { rows['Peanut butter toast'].onAdd!(); });
    await leaveFuel();
    await returnToFuel();
    expect(rows['Protein shake'].state).toBe('error');
    expect(rows['Peanut butter toast'].state).toBe('error');
    saveQuickAdd.mockImplementation(async (food, entry) => {
      ids.push({ food: food.id, id: entry.pending.take() });
      return true;
    });
    await act(async () => { rows['Protein shake'].onAdd!(); });
    await show({ visible: false });
    await show();
    expect(rows['Protein shake'].state).toBeUndefined();
    expect(rows['Peanut butter toast'].state).toBe('error');
    await act(async () => { rows['Peanut butter toast'].onAdd!(); });
    expect(ids.slice(2)).toEqual(ids.slice(0, 2));
  });

  it('does not discard an undo still running when the card is left', async () => {
    let finish!: (removed: boolean) => void;
    deleteEntry.mockImplementation(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    await show();
    await act(async () => { rows['Peanut butter toast'].onAdd!(); });
    await act(async () => { rows['Peanut butter toast'].onTakeOut!(); });
    await leaveFuel();
    await returnToFuel();
    await show({ visible: false });
    await show();
    expect(rows['Peanut butter toast'].state).toBe('saving');
    await act(async () => { rows['Peanut butter toast'].onTakeOut!(); });
    expect(deleteEntry).toHaveBeenCalledTimes(1);
    await act(async () => { finish(true); });
    expect(rows['Peanut butter toast'].state).toBeUndefined();
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
