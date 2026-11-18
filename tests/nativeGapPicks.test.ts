// @vitest-environment happy-dom
import * as dates from 'date-fns';
import { act, createElement, Fragment, useEffect, type ComponentType, type PropsWithChildren } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as zustand from 'zustand';

import * as fuelSummary from '@/lib/fuelSummary';
import * as ledger from '@/lib/nutritionLedger';
import * as macros from '@/lib/nutritionMacros';
import * as pendingIds from '@/lib/pendingEntryId';
import { recentFoodKey, type RecentLog } from '@/lib/recentFoods';
import * as recentFoods from '@/lib/recentFoods';
import type { Food, NutritionGroup } from '@/types';
import * as closeGap from '../native/src/lib/closeGap';
import * as format from '../native/src/lib/format';
import type * as GapSheetAsk from '../native/src/lib/gapSheetAsk';
import { mealForTime } from '../native/src/lib/meals';
import { loadNativeModule } from './helpers/loadNativeModule';

// Close the gap on Fuel (the owner's pick, 2026-11-17): one row under the
// day's figures, today, in the evening, when today is well short (the
// reminder's measure). It opens a sheet with where the usual foods would take
// the day, the foods and one button that logs them all. In the sheet, + logs
// one now at its usual amount into the meal that fits the time; the tick
// takes it back out; a tap reviews it in Log food; a swipe hides it. Touched,
// the sheet holds still until it is left, and an add that was not confirmed
// is still there to retry after the sheet was closed. Run as the app
// compiles it.

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
const totals = (calories: number, protein: number) => ({ calories, protein, carbs: 0, fat: 0 });
/** A day's food so far, as one entry with those totals. */
const eaten = (calories: number, protein: number, date = TODAY) => (calories > 0 || protein > 0 ? [{ id: 'eaten', date, servings: 1, food: usual('lunch', 'Lunch', calories, protein) }] : []);

type FoodRowProps = { food: Food; state?: string; detail?: string; servings?: number; onOpen: () => void; onAdd?: () => void; onTakeOut?: () => void };
type SwipeProps = PropsWithChildren<{ name: string; actions: { label: string; onPress: () => void }[] }>;
type RowProps = { title: string; detail?: string; chevron?: boolean; onPress?: () => void };
type CapsuleProps = { title: string; busy?: boolean; onPress: () => void };
const rows: Record<string, FoodRowProps> = {};
const swipes: Record<string, SwipeProps> = {};
const fuelRow: { props?: RowProps } = {};
const button: { props?: CapsuleProps } = {};
const push = vi.fn();
const back = vi.fn();
const offerReview = vi.fn();
const refreshAfterWrite = vi.fn(async () => {});
const deleteEntry = vi.fn(async (id: string) => Boolean(id));
const saveQuickAdd = vi.fn(async (food: Food, entry: { pending: { take: () => string } }) => Boolean(food) && Boolean(entry));
const hidden: Record<string, number> = {};
const hideRecentFood = vi.fn((userId: string, key: string) => {
  hidden[key] = Date.now();
  return { ...hidden };
});
let kept: RecentLog[] | null = usualWeek;
let snapshot: { userId: string; logs: RecentLog[]; at: number } | null = null;

// What the sheet reads from the app, as stores a test can change under it.
const settings = zustand.create(() => ({ settings: { enabled: false, minutes: 20 * 60 } }));
const auth = zustand.create<{ user: { id: string } | null }>(() => ({ user: { id: 'user-1' } }));
const app = zustand.create<{ macroTarget: { calories: number; protein: number } | null; nutritionProfile: { goal: string } | null }>(() => ({
  macroTarget: { calories: 2800, protein: 160 },
  nutritionProfile: { goal: 'bulk' },
}));
const fuelDay = zustand.create(() => ({ today: TODAY, selected: TODAY, loaded: true, logs: eaten(1950, 120) as ReturnType<typeof eaten> }));

// The screen's focus: every focus effect runs as it comes to the front, and its cleanup as it is left.
const focused = new Set<{ effect: () => void | (() => void); cleanup?: void | (() => void) }>();
const leave = () => act(async () => {
  for (const entry of focused) {
    entry.cleanup?.();
    entry.cleanup = undefined;
  }
});
const comeBack = () => act(async () => {
  for (const entry of focused) entry.cleanup = entry.effect();
});

const gapSheetAsk = loadNativeModule<typeof GapSheetAsk>('lib/gapSheetAsk.ts', { zustand });
const tones: Record<string, string> = { ink: 'ink', mark: 'mark', track: 'track', ground: 'ground' };

const { GapRow, GapSheet, forgetGapSessions } = loadNativeModule<{
  GapRow: ComponentType<Record<string, unknown>>;
  GapSheet: ComponentType;
  forgetGapSessions: () => void;
}>('fuel/GapPicks.tsx', {
  'date-fns': dates,
  'expo-router': {
    router: { push, back },
    useFocusEffect: (effect: () => void | (() => void)) => {
      useEffect(() => {
        const entry: { effect: typeof effect; cleanup?: void | (() => void) } = { effect, cleanup: effect() };
        focused.add(entry);
        return () => {
          entry.cleanup?.();
          focused.delete(entry);
        };
      }, [effect]);
    },
  },
  // Views keep what the line is drawn with: each length's colour and width.
  'react-native': {
    ScrollView: Wrap,
    View: ({ children, style }: PropsWithChildren<{ style?: { backgroundColor?: string; width?: string } }>) =>
      createElement('div', { 'data-tone': style?.backgroundColor, 'data-width': style?.width }, children),
  },
  'react-native-reanimated': { default: { View: Wrap } },
  zustand,
  '@/lib/appVisibility': { onAppVisible: () => noop },
  '@/lib/fuelSummary': fuelSummary,
  '@/lib/nutritionLedger': ledger,
  '@/lib/nutritionMacros': macros,
  '@/lib/pendingEntryId': pendingIds,
  '@/lib/recentFoods': recentFoods,
  '@/stores/appStore': { useAppStore: app },
  '@/stores/authStore': { useAuthStore: auth },
  '~/components/BlancText': { BlancText: ({ children }: PropsWithChildren) => createElement('span', null, children) },
  '~/components/Capsule': { Capsule: (props: CapsuleProps) => { button.props = props; return null; } },
  '~/components/GlassButton': { GlassButton: Empty },
  '~/components/Label': { Label: Wrap },
  '~/components/RollingText': { RollingText: ({ children }: PropsWithChildren) => createElement('b', null, children) },
  '~/components/Row': {
    Hairline: Empty,
    Row: (props: RowProps) => {
      fuelRow.props = props;
      useEffect(() => () => {
        fuelRow.props = undefined;
      }, []);
      return null;
    },
  },
  '~/components/SwipeRow': {
    SwipeRow: (props: SwipeProps) => {
      swipes[props.name] = props;
      return createElement(Fragment, null, props.children);
    },
  },
  '~/lib/accessibility': { announce: noop, speak: (text: string) => text, useLargeText: () => false },
  '~/lib/closeGap': closeGap,
  '~/lib/format': format,
  '~/lib/fuel': {
    loadDayGroups: async () => [dinner],
    suggestedGroup: (groups: NutritionGroup[], at: Date) => groups.find((group) => group.label === mealForTime(at)) ?? null,
    useFuelStore: { getState: () => ({ refreshAfterWrite, deleteEntry }) },
    useFuelDay: () => {
      const { selected, loaded, logs } = fuelDay();
      return { selected, loaded, logs };
    },
    useTodayKey: () => fuelDay((state) => state.today),
  },
  '~/lib/fuelReminder': { useFuelReminderStore: settings },
  '~/lib/gapSheetAsk': gapSheetAsk,
  '~/lib/haptics': { haptics: { tap: noop, select: noop, success: noop, error: noop } },
  '~/lib/motion': {},
  '~/theme/blanc': { figureLead: () => 0, restingFigure: {}, space: { gutter: 16, inset: 16, labelPad: 18 }, useBlanc: () => tones },
  './context': { offerReview },
  './FoodLists': {
    // Rows on screen: drawn rows update their props, removed rows leave.
    FoodRow: (props: FoodRowProps) => {
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
}, { compile: true });

const target = { calories: 2800, protein: 160 };
let root: Root | undefined;
let host: HTMLElement | undefined;

/** Fuel's row, with the day's figures Fuel hands it. */
async function showRow(overrides: Record<string, unknown> = {}) {
  const props = { userId: 'user-1', day: TODAY, active: true, totals: totals(1950, 120), target, goal: 'bulk', dayLogs: [], ...overrides };
  if (!root) root = createRoot((host = document.createElement('div')));
  await act(async () => { root!.render(createElement(GapRow, props)); });
}
/** The sheet, opened. */
async function openSheet() {
  if (!root) root = createRoot((host = document.createElement('div')));
  await act(async () => { root!.render(createElement(GapSheet)); });
}
/** The sheet, closed: it is gone from the screen, as after its X or a swipe down. */
async function closeSheet() {
  await act(async () => { root?.unmount(); });
  root = undefined;
}
const eat = (calories: number, protein: number) => act(async () => { fuelDay.setState({ logs: eaten(calories, protein) }); });
const shown = () => Object.keys(rows);
const figure = () => host?.querySelector('b')?.textContent ?? null;
const against = () => [...(host?.querySelectorAll('span') ?? [])].map((node) => node.textContent ?? '').find((text) => text.startsWith('of ')) ?? null;
/** The plan's line: its lengths after what was eaten, by colour. */
const line = () => [...(host?.querySelectorAll('[data-tone="ink"], [data-tone="mark"]') ?? [])].slice(1).map((node) => node.getAttribute('data-tone'));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`${TODAY}T19:30:00`));
  forgetGapSessions();
  gapSheetAsk.useGapSheetAsk.setState({ askedAt: null });
  for (const key of Object.keys(rows)) delete rows[key];
  for (const key of Object.keys(hidden)) delete hidden[key];
  for (const key of Object.keys(swipes)) delete swipes[key];
  fuelRow.props = undefined;
  button.props = undefined;
  kept = usualWeek;
  settings.setState({ settings: { enabled: false, minutes: 20 * 60 } });
  auth.setState({ user: { id: 'user-1' } });
  app.setState({ macroTarget: target, nutritionProfile: { goal: 'bulk' } });
  fuelDay.setState({ today: TODAY, selected: TODAY, loaded: true, logs: eaten(1950, 120) });
  for (const mock of [push, back, offerReview, refreshAfterWrite, deleteEntry, saveQuickAdd, hideRecentFood]) mock.mockClear();
  saveQuickAdd.mockImplementation(async () => true);
  deleteEntry.mockImplementation(async () => true);
});
afterEach(async () => {
  await closeSheet();
  vi.useRealTimers();
});

describe('Fuel’s Close the gap row', () => {
  it('in the evening, well short: one row saying where the usual foods would take the day', async () => {
    await showRow();
    // 1,950 eaten and 900 in the three usual foods: where they lead, never the 900 alone.
    expect(fuelRow.props).toMatchObject({ title: 'Close the gap', detail: '3 of your usuals reach 2,850 kcal', chevron: true });
    await act(async () => { fuelRow.props!.onPress!(); });
    expect(push).toHaveBeenCalledWith('/close-gap');
  });

  it('not before 6 PM, unless the reminder is set earlier', async () => {
    vi.setSystemTime(new Date(`${TODAY}T17:15:00`));
    await showRow();
    expect(fuelRow.props).toBeUndefined();
    await act(async () => { settings.setState({ settings: { enabled: true, minutes: 17 * 60 } }); });
    expect(fuelRow.props?.title).toBe('Close the gap');
  });

  it('not once the target is near, with nothing logged, without usual foods, or on another day', async () => {
    await showRow({ totals: totals(2500, 150) });
    expect(fuelRow.props).toBeUndefined();
    await showRow({ totals: totals(0, 0) });
    expect(fuelRow.props).toBeUndefined();
    await showRow({ active: false });
    expect(fuelRow.props).toBeUndefined();
    kept = [ate(shake, '2026-11-07')];
    await showRow();
    expect(fuelRow.props).toBeUndefined();
  });

  it('on a cut, for protein only, within the calories left', async () => {
    await showRow({ goal: 'cut', totals: totals(2300, 110) });
    expect(fuelRow.props?.detail).toBe('One of your usuals reaches 150 g protein');
  });

  it('opens the sheet for the reminder’s tap, once, when there are picks', async () => {
    await act(async () => { gapSheetAsk.askGapSheet(); });
    await showRow();
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith('/close-gap');
    await showRow({ totals: totals(1900, 120) });
    expect(push).toHaveBeenCalledTimes(1);
  });

  it('lets the reminder’s tap go when today has no picks, or when it is old', async () => {
    await showRow({ totals: totals(2700, 160) });
    await act(async () => { gapSheetAsk.askGapSheet(); });
    // Short again later: the tap is long over.
    await showRow();
    expect(push).not.toHaveBeenCalled();

    // Asked while the day was still loading, and answered too late.
    await showRow({ active: false });
    await act(async () => { gapSheetAsk.askGapSheet(); });
    vi.setSystemTime(new Date(`${TODAY}T19:31:00`));
    await showRow();
    expect(fuelRow.props?.title).toBe('Close the gap');
    expect(push).not.toHaveBeenCalled();
  });
});

describe('the Close the gap sheet', () => {
  it('shows where the usual foods take the day, the foods, and one button for them all', async () => {
    await openSheet();
    expect(figure()).toBe('2,850');
    expect(against()).toBe('of 2,800 kcal with all three');
    expect(shown()).toEqual(['Protein shake', 'Peanut butter toast', 'Greek yogurt']);
    expect(rows['Protein shake']).toMatchObject({ servings: 1, detail: '1 serving' });
    expect(line()).toEqual(['mark', 'mark', 'mark']);
    expect(button.props?.title).toBe('Log all three');
  });

  it('measures protein on a cut', async () => {
    await act(async () => { app.setState({ nutritionProfile: { goal: 'cut' } }); });
    await eat(2300, 110);
    await openSheet();
    expect(figure()).toBe('150');
    expect(against()).toBe('of 160 g protein with this');
    expect(shown()).toEqual(['Protein shake']);
    expect(button.props?.title).toBe('Log it');
  });

  it('says so when there is nothing to offer, with Done to close', async () => {
    await eat(2700, 160);
    await openSheet();
    expect(shown()).toEqual([]);
    expect(host?.textContent).toContain('Nothing more to suggest today.');
    await act(async () => { button.props!.onPress(); });
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('has no picks for another day on Fuel', async () => {
    await act(async () => { fuelDay.setState({ selected: '2026-11-04', logs: eaten(1000, 50, '2026-11-04') }); });
    await openSheet();
    expect(shown()).toEqual([]);
  });
});

describe('logging a pick', () => {
  it('+ logs it now at its usual amount into the meal that fits the time, and the tick takes it back out', async () => {
    await openSheet();
    await act(async () => { rows['Protein shake'].onAdd!(); });
    expect(saveQuickAdd).toHaveBeenCalledTimes(1);
    const [food, entry] = saveQuickAdd.mock.calls[0] as unknown as [Food, { servings: number; source: string; when: { time: string; groupId: string | null }; groups: NutritionGroup[] }];
    expect(food).toBe(shake);
    expect(entry).toMatchObject({ servings: 1, source: 'manual', when: { time: '19:30', groupId: 'g-dinner' }, groups: [dinner] });
    expect(rows['Protein shake'].state).toBe('done');
    expect(refreshAfterWrite).toHaveBeenCalledTimes(1);
    // Its length on the line turns to ink, and the button counts what is left.
    expect(line()).toEqual(['ink', 'mark', 'mark']);
    expect(against()).toBe('of 2,800 kcal with the rest');
    expect(button.props?.title).toBe('Log the other two');

    await act(async () => { rows['Protein shake'].onTakeOut!(); });
    expect(deleteEntry).toHaveBeenCalledTimes(1);
    expect(rows['Protein shake'].state).toBeUndefined();
    expect(line()).toEqual(['mark', 'mark', 'mark']);
  });

  it('keeps its figure while the foods are ticked off and the day’s food catches up', async () => {
    await openSheet();
    await act(async () => { rows['Protein shake'].onAdd!(); });
    expect(figure()).toBe('2,850');
    // Fuel has read the day again: the shake is in it now.
    await eat(2350, 160);
    expect(figure()).toBe('2,850');
    expect(shown()).toEqual(['Protein shake', 'Peanut butter toast', 'Greek yogurt']);
  });

  it('never logs a pick twice from two quick taps', async () => {
    await openSheet();
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
    await openSheet();
    await act(async () => { rows['Protein shake'].onAdd!(); });
    expect(rows['Protein shake'].state).toBe('error');
    await act(async () => { rows['Protein shake'].onAdd!(); });
    expect(rows['Protein shake'].state).toBe('done');
    expect(ids[0]).toBe(ids[1]);
  });

  it('holds still once touched, then lets go as the sheet is left', async () => {
    await openSheet();
    await act(async () => { rows['Protein shake'].onAdd!(); });
    // The day's food now reaches the target: the sheet stays, with its tick.
    await eat(2700, 160);
    expect(shown()).toEqual(['Protein shake', 'Peanut butter toast', 'Greek yogurt']);
    expect(rows['Protein shake'].state).toBe('done');
    // Log food over the sheet, and back.
    await leave();
    await comeBack();
    expect(shown()).toEqual([]);
    expect(host?.textContent).toContain('Nothing more to suggest today.');
  });

  it('starts again from the day as it stands when opened again', async () => {
    await openSheet();
    await act(async () => { rows['Protein shake'].onAdd!(); });
    await closeSheet();
    await eat(2350, 160);
    await openSheet();
    // 450 kcal still to go is not well short of 2,800: nothing to offer, and no tick left over.
    expect(shown()).toEqual([]);
  });

  it('reuses an unconfirmed write after the sheet was closed, even when a fresh read closes the gap', async () => {
    const ids: string[] = [];
    const persisted = new Set<string>();
    saveQuickAdd.mockImplementation(async (_food, entry) => {
      const id = entry.pending.take();
      ids.push(id);
      persisted.add(id); // The server commits both attempts; the first response is lost.
      return ids.length > 1;
    });
    await openSheet();
    await act(async () => { rows['Protein shake'].onAdd!(); });
    expect(rows['Protein shake'].state).toBe('error');

    await closeSheet();
    vi.setSystemTime(new Date(`${TODAY}T20:00:00`));
    await eat(2700, 160);
    await openSheet();
    expect(rows['Protein shake']?.state).toBe('error');
    await act(async () => { rows['Protein shake'].onAdd!(); });

    expect(ids).toHaveLength(2);
    expect(ids[1]).toBe(ids[0]);
    expect(persisted.size).toBe(1);
    expect(saveQuickAdd.mock.calls[1][1]).toEqual(saveQuickAdd.mock.calls[0][1]);
    expect(rows['Protein shake'].state).toBe('done');
    await closeSheet();
    await openSheet();
    expect(shown()).toEqual([]);
  });

  it('keeps the retry id when a save fails after the sheet was closed', async () => {
    let finish!: (saved: boolean) => void;
    const ids: string[] = [];
    saveQuickAdd.mockImplementation((_food, entry) => {
      ids.push(entry.pending.take());
      return new Promise<boolean>((resolve) => { finish = resolve; });
    });
    await openSheet();
    await act(async () => { rows['Protein shake'].onAdd!(); });
    expect(rows['Protein shake'].state).toBe('saving');
    await closeSheet();
    await act(async () => { finish(false); });
    await openSheet();
    await closeSheet();
    await openSheet();
    expect(rows['Protein shake'].state).toBe('error');
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
    await openSheet();
    await act(async () => { rows['Protein shake'].onAdd!(); });
    await closeSheet();
    vi.setSystemTime(new Date('2026-11-09T19:30:00'));
    if (scope === 'day') await act(async () => { fuelDay.setState({ today: '2026-11-09', selected: '2026-11-09', logs: eaten(1950, 120, '2026-11-09') }); });
    else await act(async () => { auth.setState({ user: { id: 'user-2' } }); });
    await openSheet();
    expect(rows['Protein shake'].state).toBeUndefined();
    await act(async () => { rows['Protein shake'].onAdd!(); });
    expect(ids).toHaveLength(2);
    expect(ids[1]).not.toBe(ids[0]);
  });

  it.each(['left', 'closed'])('releases confirmed ticks independently of unresolved retries when %s', async (how) => {
    const ids: { food: string; id: string }[] = [];
    saveQuickAdd.mockImplementation(async (food, entry) => {
      ids.push({ food: food.id, id: entry.pending.take() });
      return food === toast;
    });
    await openSheet();
    await act(async () => { rows['Peanut butter toast'].onAdd!(); });
    await act(async () => { rows['Protein shake'].onAdd!(); });
    expect(rows['Peanut butter toast'].state).toBe('done');
    expect(rows['Protein shake'].state).toBe('error');
    if (how === 'left') {
      await leave();
      await comeBack();
    } else {
      await closeSheet();
      await openSheet();
    }
    // The confirmed toast is free to be logged again; the unconfirmed shake must still be retryable.
    expect(rows['Peanut butter toast'].state).toBeUndefined();
    expect(rows['Protein shake'].state).toBe('error');
    await act(async () => { rows['Peanut butter toast'].onAdd!(); });
    await act(async () => { rows['Protein shake'].onAdd!(); });
    expect(ids).toHaveLength(4);
    expect(ids[2].id).not.toBe(ids[0].id);
    expect(ids[3]).toEqual(ids[1]);
  });

  it('releases a confirmed tick when opened again, even when its response arrived while closed', async () => {
    let finish!: (saved: boolean) => void;
    saveQuickAdd.mockImplementation(async (food) => food === toast ? new Promise<boolean>((resolve) => { finish = resolve; }) : false);
    await openSheet();
    await act(async () => { rows['Protein shake'].onAdd!(); });
    await act(async () => { rows['Peanut butter toast'].onAdd!(); });
    await closeSheet();
    await act(async () => { finish(true); });
    await openSheet();
    expect(rows['Peanut butter toast'].state).toBeUndefined();
    expect(rows['Protein shake'].state).toBe('error');
  });

  it('keeps every unresolved pick when another pick confirms', async () => {
    const ids: { food: string; id: string }[] = [];
    saveQuickAdd.mockImplementation(async (food, entry) => {
      ids.push({ food: food.id, id: entry.pending.take() });
      return false;
    });
    await openSheet();
    await act(async () => { rows['Protein shake'].onAdd!(); });
    await act(async () => { rows['Peanut butter toast'].onAdd!(); });
    await leave();
    await comeBack();
    expect(rows['Protein shake'].state).toBe('error');
    expect(rows['Peanut butter toast'].state).toBe('error');
    saveQuickAdd.mockImplementation(async (food, entry) => {
      ids.push({ food: food.id, id: entry.pending.take() });
      return true;
    });
    await act(async () => { rows['Protein shake'].onAdd!(); });
    await closeSheet();
    await openSheet();
    expect(rows['Protein shake'].state).toBeUndefined();
    expect(rows['Peanut butter toast'].state).toBe('error');
    await act(async () => { rows['Peanut butter toast'].onAdd!(); });
    expect(ids.slice(2)).toEqual(ids.slice(0, 2));
  });

  it('does not discard an undo still running when the sheet is closed', async () => {
    let finish!: (removed: boolean) => void;
    deleteEntry.mockImplementation(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    await openSheet();
    await act(async () => { rows['Peanut butter toast'].onAdd!(); });
    await act(async () => { rows['Peanut butter toast'].onTakeOut!(); });
    await leave();
    await comeBack();
    await closeSheet();
    await openSheet();
    expect(rows['Peanut butter toast'].state).toBe('saving');
    await act(async () => { rows['Peanut butter toast'].onTakeOut!(); });
    expect(deleteEntry).toHaveBeenCalledTimes(1);
    await act(async () => { finish(true); });
    expect(rows['Peanut butter toast'].state).toBeUndefined();
  });
});

describe('the sheet’s one button', () => {
  it('logs every pick, in order, and closes the sheet', async () => {
    await openSheet();
    await act(async () => { button.props!.onPress(); });
    expect(saveQuickAdd.mock.calls.map(([food]) => food.name)).toEqual(['Protein shake', 'Peanut butter toast', 'Greek yogurt']);
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('logs only what is left after some were logged one by one', async () => {
    await openSheet();
    await act(async () => { rows['Peanut butter toast'].onAdd!(); });
    expect(button.props?.title).toBe('Log the other two');
    await act(async () => { button.props!.onPress(); });
    expect(saveQuickAdd.mock.calls.map(([food]) => food.name)).toEqual(['Peanut butter toast', 'Protein shake', 'Greek yogurt']);
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('stays open when one could not be confirmed, and its next press retries that entry alone', async () => {
    const ids: { food: string; id: string }[] = [];
    saveQuickAdd.mockImplementation(async (food, entry) => {
      ids.push({ food: food.id, id: entry.pending.take() });
      return food !== toast || ids.length > 3;
    });
    await openSheet();
    await act(async () => { button.props!.onPress(); });
    expect(back).not.toHaveBeenCalled();
    expect(rows['Protein shake'].state).toBe('done');
    expect(rows['Peanut butter toast'].state).toBe('error');
    expect(rows['Greek yogurt'].state).toBe('done');
    expect(button.props?.title).toBe('Log the other one');

    await act(async () => { button.props!.onPress(); });
    expect(ids).toHaveLength(4);
    expect(ids[3]).toEqual(ids[1]);
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('reads Done once every pick is ticked, and closes the sheet', async () => {
    await openSheet();
    for (const name of ['Protein shake', 'Peanut butter toast', 'Greek yogurt']) await act(async () => { rows[name].onAdd!(); });
    expect(button.props?.title).toBe('Done');
    expect(against()).toBe('of 2,800 kcal');
    await act(async () => { button.props!.onPress(); });
    expect(saveQuickAdd).toHaveBeenCalledTimes(3);
    expect(back).toHaveBeenCalledTimes(1);
  });
});

describe('a pick’s other actions', () => {
  it('a tap reviews it in Log food at the usual amount', async () => {
    await openSheet();
    await act(async () => { rows['Peanut butter toast'].onOpen(); });
    expect(offerReview).toHaveBeenCalledWith(toast, 1);
    expect(push).toHaveBeenCalledWith({ pathname: '/log-food', params: { day: TODAY, review: '1' } });
  });

  it('a swipe hides it here and in Recent; the others stay where they are', async () => {
    await openSheet();
    await act(async () => { swipes['Peanut butter toast'].actions[0].onPress(); });
    expect(hideRecentFood).toHaveBeenCalledWith('user-1', recentFoodKey(toast));
    expect(shown()).toEqual(['Protein shake', 'Greek yogurt']);
    // The figure is of the foods still listed.
    expect(figure()).toBe(format.formatWhole(1950 + 900 - toast.calories));
    expect(button.props?.title).toBe('Log both');
  });
});
