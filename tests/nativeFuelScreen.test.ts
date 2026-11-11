// @vitest-environment happy-dom
import * as dates from 'date-fns';
import { act, createElement, Fragment, useEffect, type ComponentType, type PropsWithChildren, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as fuelSummary from '@/lib/fuelSummary';
import * as composition from '@/lib/mealComposition';
import * as calendar from '@/lib/nutritionCalendar';
import { captureAccountScope } from '@/lib/accountScope';
import * as groupsRules from '@/lib/nutritionGroups';
import * as ledger from '@/lib/nutritionLedger';
import * as logUtils from '@/lib/nutritionLogUtils';
import * as macros from '@/lib/nutritionMacros';
import * as repeated from '@/lib/repeatEntries';
import * as savedMealFromLog from '@/lib/savedMealFromLog';
import type { Food } from '@/types';
import { loadNativeModule } from './helpers/loadNativeModule';
import { silentAccessibility } from './helpers/silentAccessibility';
import * as meals from '../native/src/lib/meals';
import { create as zustandCreate } from 'zustand';
import { hintImports } from './helpers/hintStubs';

// Fuel's folds, on this test's React: the app's own copy of zustand would bring its own.
const mealFolds = loadNativeModule<typeof import('../native/src/lib/mealFolds')>('lib/mealFolds.ts', { zustand: { create: zustandCreate } });

// Fuel's screen: the date under the large title opens the month (the bar keeps
// + alone), and a day with food ends on a quiet Log food for that day. A new
// meal or snack is made in Log food's destination menu instead. The week strip
// runs Monday to Sunday and marks every day's food, the chosen day's too; the
// day's figure, its line and the macros are one card.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const Wrap = ({ children }: PropsWithChildren) => createElement(Fragment, null, children);
const Empty = () => null;
const noop = () => {};

type Press = { accessibilityRole?: string; accessibilityLabel?: string; accessibilityHint?: string; onPress?: () => void; children?: ReactNode };
type CapsuleProps = { title: string; variant?: 'primary' | 'quiet'; onPress: () => void };
type HeaderItem = { label: string; onPress: () => void };
type RowProps = { title: string; detail?: string | readonly string[]; value?: string; accessibilityLabel?: string; onPress?: () => void; menu?: { title: string; run?: () => void }[] };
type UndoBarProps = { label: string | null; busy?: boolean; onUndo: () => void };
type AlertButton = { text: string; style?: string; onPress?: () => void };
type MarkProps = { logged: boolean; kcal?: number; target?: number | null };
type SectionProps = PropsWithChildren<{ title: string; accessory?: ReactNode; fold?: { open: boolean; onToggle: () => void } }>;
type Target = { calories: number; protein: number; carbs: number; fat: number };

const oats: Food = {
  id: 'oats', user_id: null, name: 'Oats', calories: 150, protein: 5, carbs: 27, fat: 3,
  serving_size: 40, serving_unit: 'g', source: 'usda', fdc_id: '1',
};
const milkFood: Food = {
  id: 'milk', user_id: null, name: 'Milk', calories: 120, protein: 8, carbs: 12, fat: 5,
  serving_size: 240, serving_unit: 'ml', source: 'usda', fdc_id: '2',
};
const TODAY = '2026-11-05';
const noSavedFoods: Food[] = [];

const push = vi.fn();
const pressables: Record<string, Press> = {};
const capsules: Record<string, CapsuleProps> = {};
const rows: Record<string, RowProps> = {};
// Each meal's heading as last drawn, and the shown day's entries, to add to or take from.
const sections: Record<string, SectionProps> = {};
const shown: { logs: object[] } = { logs: [] };
const marks: MarkProps[] = [];
const undoBar: { props?: UndoBarProps } = {};
const alert = vi.fn();
const deleteEntry = vi.fn<(id: string) => Promise<boolean>>();
const restoreEntry = vi.fn<(log: object) => Promise<boolean>>();
const deleteGroup = vi.fn<(group: object) => Promise<boolean>>();
// iOS's action sheet: what it offered last, and its answer.
const actionSheet = vi.fn<(options: { options: string[] }, answer: (index: number) => void) => void>();
const screen: { options?: { unstable_headerRightItems?: () => HeaderItem[] } } = {};
let root: Root | undefined;
let host: HTMLDivElement;

async function renderFuel({ day = TODAY, logged = true, source, target = null, loaded = true, fontScale = 1, milk = false, copyAgain = false, meal = false, fuelModule, gapPicks = Empty }: {
  day?: string;
  logged?: boolean;
  source?: string;
  target?: Target | null;
  loaded?: boolean;
  fontScale?: number;
  /** A second entry, Milk, after the Oats. */
  milk?: boolean;
  /** Today's matching meal already has what Copy to today would copy. */
  copyAgain?: boolean;
  /** The Oats in a meal of the person's own (no named meal), with its options. */
  meal?: boolean;
  /** The real Fuel store (native/src/lib/fuel.ts) in place of the stand-in. */
  fuelModule?: object;
  gapPicks?: ComponentType<{ visible?: boolean }>;
} = {}) {
  const logs = logged ? [{ id: 'log-oats', date: day, food: oats, servings: 1, logged_at: `${day}T08:00:00Z`, group_id: null as string | null, sort_order: 0, source }] : [];
  if (logged && milk) logs.push({ id: 'log-milk', date: day, food: milkFood, servings: 1, logged_at: `${day}T09:00:00Z`, group_id: null, sort_order: 1, source });
  const ownMeal = { id: 'g-own', user_id: 'user-a', date: day, kind: 'meal', label: null, sort_order: 0 };
  if (meal) for (const entry of logs) entry.group_id = ownMeal.id;
  shown.logs = logs;
  const fuel = { selected: day, logs, groups: meal ? [ownMeal] : [], deleteEntry, restoreEntry, deleteGroup, copyToToday: vi.fn(async () => true) };
  const Fuel = loadNativeModule<{ default: ComponentType }>('app/(tabs)/fuel/index.tsx', {
    ...hintImports,
    'date-fns': dates,
    'expo-router': {
      router: { push },
      Stack: { Screen: (props: typeof screen) => { screen.options = props.options; return null; } },
    },
    'expo-symbols': { SymbolView: Empty },
    'react-native': {
      ActionSheetIOS: { showActionSheetWithOptions: actionSheet },
      Alert: { alert },
      Pressable: (props: Press) => {
        if (props.accessibilityLabel) pressables[props.accessibilityLabel] = props;
        return createElement('div', { 'data-press': props.accessibilityLabel, 'data-hint': props.accessibilityHint }, props.children);
      },
      RefreshControl: Empty,
      StyleSheet: { hairlineWidth: 0.33 },
      useWindowDimensions: () => ({ width: 402, height: 874, fontScale, scale: 3 }),
      View: Wrap,
    },
    'react-native-gesture-handler': {
      Gesture: { Pan: () => new Proxy({}, { get: (_target, _key, chain) => () => chain }) },
      GestureDetector: Wrap,
    },
    'react-native-reanimated': { default: { View: Wrap }, LayoutAnimationConfig: Wrap },
    '@/lib/nutritionLogUtils': logUtils,
    '@/lib/fuelSummary': fuelSummary,
    '@/lib/mealComposition': composition,
    '@/lib/nutritionCalendar': calendar,
    '@/lib/nutritionDay': { canReorderNutritionGroup: () => false, offersMoveToPreviousDay: () => false },
    '@/lib/nutritionGroups': groupsRules,
    '@/lib/nutritionLedger': ledger,
    '@/lib/nutritionMacros': macros,
    '@/lib/repeatEntries': { alreadyOnDay: () => copyAgain },
    '@/lib/savedFoodsCache': { readSavedFoodsCache: () => noSavedFoods, subscribeSavedFoodsCache: () => noop },
    '@/lib/savedMealFromLog': savedMealFromLog,
    '@/stores/appStore': {
      useAppStore: (select: (state: object) => unknown) => select({ macroTarget: target, macroTargetLoadedForUserId: 'user-a', nutritionProfile: null }),
    },
    '@/stores/authStore': { useAuthStore: (select: (state: object) => unknown) => select({ user: { id: 'user-a' } }) },
    '~/components/BlancText': { BlancText: Wrap },
    '~/components/Capsule': { Capsule: (props: CapsuleProps) => { capsules[props.title] = props; return null; } },
    '~/components/Label': { Label: ({ children }: PropsWithChildren) => createElement('section', null, children) },
    '~/components/HoldMenu': { showActionSheet: noop },
    '~/components/RollingText': { RollingText: Wrap },
    '~/components/Row': { Row: (props: RowProps) => { rows[props.title] = props; return null; }, Hairline: Empty },
    '~/components/Section': {
      Section: (props: SectionProps) => { sections[props.title] = props; return createElement('div', null, props.accessory, props.children); },
    },
    '~/components/SwipeRow': { SwipeRow: Wrap },
    '~/components/TabScroll': { TabScroll: Wrap, tabBarCover: () => 0 },
    '~/components/UndoBar': { UndoBar: (props: UndoBarProps) => { undoBar.props = props; return null; } },
    '~/lib/workoutBar': { useWorkoutBarShown: (select: (state: { shown: boolean }) => unknown) => select({ shown: false }) },
    zustand: { create: zustandCreate },
    '~/components/Track': { Track: ({ progress }: { progress: number }) => createElement('i', { 'data-track': String(progress) }) },
    '~/fuel/GapPicks': { GapPicks: gapPicks },
    '~/fuel/DayMark': { DayMark: (props: MarkProps) => { marks.push(props); return null; } },
    '~/lib/format': { formatWhole: String },
    '~/lib/fuel': fuelModule ?? {
      dayKey: (date: Date) => dates.format(date, 'yyyy-MM-dd'),
      useTodayKey: () => TODAY,
      todayLogsInMatchingMeal: () => (copyAgain ? [] : null),
      useFuelDay: () => ({ selected: day, loaded, status: loaded ? 'ready' : 'loading', logs: loaded ? fuel.logs : [], groups: fuel.groups }),
      useFuelStore: Object.assign((select: (state: typeof fuel) => unknown) => select(fuel), { getState: () => fuel }),
    },
    '~/lib/accessibility': silentAccessibility,
    '~/lib/haptics': { haptics: { tap: noop, select: noop, success: noop, error: noop } },
    '~/lib/mealFolds': mealFolds,
    '~/lib/motion': {},
    '~/lib/you': { useYouMealsStore: (select: (state: { meals: Food[] | null }) => unknown) => select({ meals: null }) },
    '~/theme/blanc': { useBlanc: () => ({}), space: { gutter: 16 }, figureLead: () => 0, restingFigure: {} },
  }).default;
  host = document.createElement('div');
  root = createRoot(host);
  await act(async () => { root!.render(createElement(Fuel)); });
  return async (nextDay: string) => {
    day = nextDay;
    await act(async () => { root!.render(createElement(Fuel)); });
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`${TODAY}T10:00:00`));
  push.mockClear();
  for (const record of [pressables, capsules, rows, sections]) for (const key of Object.keys(record)) delete record[key];
  marks.length = 0;
  undoBar.props = undefined;
  alert.mockClear();
  deleteEntry.mockReset().mockResolvedValue(true);
  restoreEntry.mockReset().mockResolvedValue(true);
  deleteGroup.mockReset().mockResolvedValue(true);
  actionSheet.mockReset();
  screen.options = undefined;
});
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  root = undefined;
  vi.useRealTimers();
});

describe("Fuel's date under the title", () => {
  it('opens the month, as a button named by the date, and leaves + alone in the bar', async () => {
    await renderFuel();
    const date = pressables['Thursday, November 5'];
    expect(date).toMatchObject({ accessibilityRole: 'button', accessibilityHint: 'Opens the month' });
    await act(async () => { date.onPress!(); });
    expect(push).toHaveBeenCalledWith('/fuel-month');
    // the calendar glyph is gone: + opens Log food for the day shown
    const items = screen.options!.unstable_headerRightItems!();
    expect(items.map((item) => item.label)).toEqual(['Log food']);
    items[0].onPress();
    expect(push).toHaveBeenLastCalledWith({ pathname: '/log-food', params: { day: TODAY } });
  });

  it('names another day the way Today writes its date', async () => {
    await renderFuel({ day: '2026-11-03' });
    await act(async () => { pressables['Tuesday, November 3'].onPress!(); });
    expect(push).toHaveBeenCalledWith('/fuel-month');
  });
});

describe('Fuel gap-pick lifetime', () => {
  it('hides rather than unmounts retry state when browsing past days', async () => {
    const mount = vi.fn();
    const unmount = vi.fn();
    let visible: boolean | undefined;
    const selectDay = await renderFuel({ gapPicks: function GapPicksProbe(props) {
      visible = props.visible;
      useEffect(() => { mount(); return () => { unmount(); }; }, []);
      return null;
    } });
    await selectDay('2026-11-04');
    expect(unmount).not.toHaveBeenCalled();
    expect(visible).toBe(false);
    await selectDay(TODAY);
    expect(mount).toHaveBeenCalledTimes(1);
    expect(visible).toBe(true);
  });
});

describe('Fuel on a day with nothing logged', () => {
  it('shows no zero figures, only Nothing logged and Log food', async () => {
    await renderFuel({ day: '2026-11-03', logged: false });
    const figure = Object.values(pressables).find((press) => press.accessibilityHint === 'Edits your calorie target' || press.accessibilityHint === 'Sets your calorie target');
    expect(figure).toBeUndefined();
    expect(capsules['Log food']).toBeDefined();
  });
});

describe("Fuel's last action", () => {
  it('ends a day with food on a quiet Log food for that day, where Add meal or snack was', async () => {
    await renderFuel({ day: '2026-11-03' });
    expect(capsules['Add meal or snack']).toBeUndefined();
    expect(capsules['Log food'].variant).toBe('quiet');
    await act(async () => { capsules['Log food'].onPress(); });
    expect(push).toHaveBeenCalledWith({ pathname: '/log-food', params: { day: '2026-11-03' } });
  });

  it('leaves an empty day to its own Log food', async () => {
    await renderFuel({ logged: false });
    expect(capsules['Log food'].variant).toBeUndefined();
    await act(async () => { capsules['Log food'].onPress(); });
    expect(push).toHaveBeenCalledWith({ pathname: '/log-food', params: { day: TODAY } });
  });
});

describe("Fuel's day rows", () => {
  // The time the oats were logged, as the row shows it on this machine's clock.
  const time = () => dates.format(new Date(`${TODAY}T08:00:00Z`), 'h:mm a');

  it('lead with what was eaten: the amount and protein, then the time', async () => {
    await renderFuel();
    const row = rows.Oats;
    // In parts: the amount first, the one part a narrow line cuts short.
    expect(row.detail).toEqual(['40 g', '5 g protein', time()]);
    expect(row.value).toBe('150');
    // VoiceOver hears the same line in the same order.
    expect(row.accessibilityLabel).toBe(`Oats, 40 g · 5 g protein · ${time()}, 150 kcal`);
    // A tap still opens the entry, where its time is changed.
    await act(async () => { row.onPress!(); });
    expect(push).toHaveBeenCalledWith({ pathname: '/log-food', params: { entry: 'log-oats' } });
  });

  it('keep the time and Estimate whole: only the amount gives way on a narrow line', async () => {
    await renderFuel({ source: 'gemini_estimate' });
    expect(rows.Oats.detail).toEqual(['40 g', '5 g protein', time(), 'Estimate']);
    // VoiceOver still hears the whole line.
    expect(rows.Oats.accessibilityLabel).toBe(`Oats, 40 g · 5 g protein · ${time()} · Estimate, 150 kcal`);
  });
});

describe("Fuel's meals fold", () => {
  const milk = { id: 'log-milk', date: TODAY, food: milkFood, servings: 1, logged_at: `${TODAY}T09:00:00Z`, group_id: null, sort_order: 1 };
  const meal = () => sections[groupsRules.NO_MEAL];
  const toggle = async () => {
    for (const key of Object.keys(rows)) delete rows[key];
    await act(async () => { meal().fold!.onToggle(); });
  };

  afterEach(() => {
    mealFolds.unfoldMeal('user-a', mealFolds.mealFoldKey(TODAY));
  });

  it('down to the heading on a tap, and open again on the next', async () => {
    await renderFuel();
    expect(meal().fold!.open).toBe(true);
    expect(rows.Oats).toBeDefined();
    await toggle();
    expect(meal().fold!.open).toBe(false);
    expect(rows.Oats).toBeUndefined();
    await toggle();
    expect(meal().fold!.open).toBe(true);
    expect(rows.Oats).toBeDefined();
  });

  it('opens when food is logged into it, and stays open if that food is deleted', async () => {
    const draw = await renderFuel();
    await toggle();
    shown.logs.push(milk);
    await draw(TODAY);
    expect(meal().fold!.open).toBe(true);
    expect(rows.Milk).toBeDefined();
    expect(rows.Oats).toBeDefined();
    shown.logs.pop();
    await draw(TODAY);
    expect(meal().fold!.open).toBe(true);
  });

  it('stays folded when one of its foods goes', async () => {
    const draw = await renderFuel({ milk: true });
    await toggle();
    shown.logs.pop();
    await draw(TODAY);
    expect(meal().fold!.open).toBe(false);
  });

  it('is not offered by a meal with nothing in it', async () => {
    const draw = await renderFuel({ meal: true });
    shown.logs.length = 0;
    await draw(TODAY);
    const headings = Object.values(sections);
    expect(headings).toHaveLength(1);
    expect(headings[0].fold).toBeUndefined();
    expect(rows['Nothing here yet']).toBeDefined();
  });
});

describe("Fuel's week strip", () => {
  it('runs Monday to Sunday, as the training week does', async () => {
    await renderFuel();
    // Thursday, November 5: the week is Monday 2 to Sunday 8, not Sunday 1 to Saturday 7.
    expect(pressables['Monday, November 2']).toBeDefined();
    expect(pressables['Sunday, November 8']).toBeDefined();
    expect(pressables['Sunday, November 1']).toBeUndefined();
    const labels = Object.keys(pressables).filter((label) => /day, November \d+$/.test(label) && label !== 'Thursday, November 5');
    expect(labels[0]).toBe('Monday, November 2');
    expect(labels.at(-1)).toBe('Sunday, November 8');
  });

  it('marks the chosen day’s food as it marks the others', async () => {
    await renderFuel({ target: { calories: 2000, protein: 150, carbs: 200, fat: 60 } });
    // Monday first: the chosen Thursday is the fourth day, and its food shows under it.
    expect(marks).toHaveLength(7);
    expect(marks[3]).toMatchObject({ logged: true, kcal: 150, target: 2000 });
    expect(marks.filter((mark) => mark.logged)).toHaveLength(1);
  });
});

describe("Fuel's day card", () => {
  const target = { calories: 2000, protein: 150, carbs: 200, fat: 60 };
  const card = (hint: string) => host.querySelector(`[data-hint="${hint}"]`)?.closest('section');

  it('holds the figure, its line and the three macros in one card, every line inside it', async () => {
    await renderFuel({ target });
    const figure = card('Edits your calorie target');
    expect(figure).toBeTruthy();
    for (const macro of ['protein', 'carbs', 'fat']) expect(card(`Edits your ${macro} target`)).toBe(figure);
    // The calorie line and the three macro lines all sit in the card, so they share its inset.
    expect([...figure!.querySelectorAll('[data-track]')].map((track) => Number(track.getAttribute('data-track')))).toEqual([150 / 2000, 5 / 150, 27 / 200, 3 / 60]);
    // Nothing of the day's figures sits outside it on the ground.
    expect(host.querySelectorAll('[data-track]')).toHaveLength(4);
    // The figure still opens the targets, at calories.
    await act(async () => { pressables[Object.keys(pressables).find((label) => pressables[label].accessibilityHint === 'Edits your calorie target')!].onPress!(); });
    expect(push).toHaveBeenCalledWith({ pathname: '/targets-edit', params: { focus: 'calories' } });
  });

  it('keeps one card at the large text sizes, with the macros as rows', async () => {
    await renderFuel({ target, fontScale: 1.6 });
    const figure = card('Edits your calorie target');
    for (const macro of ['protein', 'carbs', 'fat']) expect(card(`Edits your ${macro} target`)).toBe(figure);
    expect(figure!.querySelectorAll('[data-track]')).toHaveLength(4);
  });

  it('shows its lines only once the day has loaded, so none fills from a 0 it never was', async () => {
    await renderFuel({ target, loaded: false });
    expect(card('Edits your calorie target')).toBeTruthy();
    expect(host.querySelectorAll('[data-track]')).toHaveLength(0);
  });

  it('is not there on a day with nothing logged', async () => {
    await renderFuel({ target, logged: false });
    expect(host.querySelector('section [data-hint="Edits your calorie target"]')).toBeNull();
    expect(host.querySelectorAll('[data-track]')).toHaveLength(0);
  });
});

describe("Fuel's Undo after a delete", () => {
  it('stays, busy, until the entry is back, and is there to try again after a failure', async () => {
    let answer!: (ok: boolean) => void;
    restoreEntry.mockReturnValueOnce(new Promise<boolean>((resolve) => { answer = resolve; }));
    await renderFuel();
    await act(async () => { rows.Oats.menu!.find((item) => item.title === 'Delete')!.run!(); });
    expect(deleteEntry).toHaveBeenCalledWith('log-oats');
    expect(undoBar.props?.label).toBe('Oats deleted');

    await act(async () => { undoBar.props!.onUndo(); });
    expect(restoreEntry).toHaveBeenCalledWith(expect.objectContaining({ id: 'log-oats' }));
    expect(undoBar.props).toMatchObject({ label: 'Oats deleted', busy: true });
    // A second tap meanwhile writes nothing more.
    await act(async () => { undoBar.props!.onUndo(); });
    expect(restoreEntry).toHaveBeenCalledOnce();

    await act(async () => { answer(false); });
    expect(alert).toHaveBeenCalledWith('Not put back', 'Check your connection and try again.', expect.any(Array), expect.anything());
    expect(undoBar.props).toMatchObject({ label: 'Oats deleted', busy: false });

    await act(async () => { undoBar.props!.onUndo(); });
    expect(restoreEntry).toHaveBeenCalledTimes(2);
    expect(undoBar.props?.label).toBeNull();
  });

  it('keeps a failed Undo past its time while the failure shows, until Try again puts the entry back', async () => {
    // The bar's countdown runs on these timers (only Date is faked for the rest of the file).
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(new Date(`${TODAY}T10:00:00`));
    restoreEntry.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await renderFuel();
    await act(async () => { rows.Oats.menu!.find((item) => item.title === 'Delete')!.run!(); });
    await act(async () => { undoBar.props!.onUndo(); });
    expect(alert).toHaveBeenCalledOnce();
    // The alert stays up well past the bar's time (VoiceOver's 20 seconds too).
    await act(async () => { vi.advanceTimersByTime(30_000); });
    expect(undoBar.props?.label).toBe('Oats deleted');

    const [title, message, buttons] = alert.mock.calls[0] as [string, string, AlertButton[]];
    expect([title, message]).toEqual(['Not put back', 'Check your connection and try again.']);

    await act(async () => { buttons.find((button) => button.text === 'Try again')!.onPress!(); });
    expect(restoreEntry).toHaveBeenCalledTimes(2);
    expect(undoBar.props?.label).toBeNull();
  });

  it('gives the bar its full time again once a failure is dismissed', async () => {
    // The bar's countdown runs on these timers (only Date is faked for the rest of the file).
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(new Date(`${TODAY}T10:00:00`));
    restoreEntry.mockResolvedValueOnce(false);
    await renderFuel();
    await act(async () => { rows.Oats.menu!.find((item) => item.title === 'Delete')!.run!(); });
    await act(async () => { undoBar.props!.onUndo(); });
    const buttons = alert.mock.calls[0][2] as AlertButton[];
    await act(async () => { vi.advanceTimersByTime(30_000); });
    await act(async () => { buttons.find((button) => button.text === 'Cancel')!.onPress!(); });
    await act(async () => { vi.advanceTimersByTime(4_000); });
    expect(undoBar.props?.label).toBe('Oats deleted');
    await act(async () => { vi.advanceTimersByTime(1_500); });
    expect(undoBar.props?.label).toBeNull();
    expect(restoreEntry).toHaveBeenCalledOnce();
  });
});

describe("Fuel's Undo with deletes and Undos overlapping", () => {
  // The bar's countdown runs on these timers (only Date is faked for the rest of the file).
  const fakeTimers = () => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(new Date(`${TODAY}T10:00:00`));
  };
  const remove = (name: string) => act(async () => { rows[name].menu!.find((item) => item.title === 'Delete')!.run!(); });
  const undo = () => act(async () => { undoBar.props!.onUndo(); });
  const wait = (ms: number) => act(async () => { vi.advanceTimersByTime(ms); });
  const buttons = (call: number) => alert.mock.calls[call][2] as AlertButton[];
  function later<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => { resolve = done; });
    return { promise, resolve };
  }

  it('holds a newer delete’s Undo behind an older Undo’s failure, then gives it its full time', async () => {
    fakeTimers();
    const oats = later<boolean>();
    restoreEntry.mockReturnValueOnce(oats.promise);
    await renderFuel({ milk: true });
    await remove('Oats');
    await undo();
    await remove('Milk');
    expect(undoBar.props).toMatchObject({ label: 'Milk deleted', busy: false });

    await act(async () => { oats.resolve(false); });
    expect(alert).toHaveBeenCalledOnce();
    await wait(30_000);
    expect(undoBar.props?.label).toBe('Milk deleted');
    expect(alert.mock.calls[0].slice(0, 2)).toEqual(['Not put back', "Oats couldn't be put back. Check your connection."]);
    // The old failure can't retry anything: its Undo is gone, and Milk's is not its own.
    expect(buttons(0).map((button) => button.text)).toEqual(['OK']);

    await act(async () => { buttons(0)[0].onPress!(); });
    await wait(4_000);
    expect(undoBar.props?.label).toBe('Milk deleted');
    await wait(1_500);
    expect(undoBar.props?.label).toBeNull();
    expect(restoreEntry).toHaveBeenCalledOnce();
  });

  it('leaves a newer delete’s Undo to its own time when an older Undo succeeds meanwhile', async () => {
    fakeTimers();
    const oats = later<boolean>();
    restoreEntry.mockReturnValueOnce(oats.promise);
    await renderFuel({ milk: true });
    await remove('Oats');
    await undo();
    await remove('Milk');
    await wait(3_000);
    await act(async () => { oats.resolve(true); });
    expect(alert).not.toHaveBeenCalled();
    expect(undoBar.props?.label).toBe('Milk deleted');
    await wait(2_100);
    expect(undoBar.props?.label).toBeNull();
  });

  it('keeps a newer Undo running while an older Undo fails, and puts back only what each was for', async () => {
    fakeTimers();
    const oats = later<boolean>();
    const milk = later<boolean>();
    restoreEntry.mockReturnValueOnce(oats.promise).mockReturnValueOnce(milk.promise);
    await renderFuel({ milk: true });
    await remove('Oats');
    await undo();
    await remove('Milk');
    await undo();
    expect(undoBar.props).toMatchObject({ label: 'Milk deleted', busy: true });

    await act(async () => { oats.resolve(false); });
    expect(buttons(0).map((button) => button.text)).toEqual(['OK']);
    expect(undoBar.props).toMatchObject({ label: 'Milk deleted', busy: true });
    await act(async () => { buttons(0)[0].onPress!(); });
    await act(async () => { milk.resolve(true); });
    expect(undoBar.props?.label).toBeNull();
    expect(restoreEntry.mock.calls.map(([log]) => (log as { id: string }).id)).toEqual(['log-oats', 'log-milk']);
  });

  it('keeps the Undo of a delete that answered with a failure, held behind its alert', async () => {
    // The answer can be lost after the row went: Undo writes it back either way.
    fakeTimers();
    deleteEntry.mockResolvedValueOnce(false);
    await renderFuel();
    await remove('Oats');
    expect(alert.mock.calls[0].slice(0, 2)).toEqual(["Couldn't confirm the delete", 'It may have gone through. Fuel shows what is saved once it reads the day again; check your connection.']);
    await wait(30_000);
    expect(undoBar.props?.label).toBe('Oats deleted');
    await act(async () => { buttons(0)[0].onPress!(); });
    await undo();
    expect(restoreEntry).toHaveBeenCalledWith(expect.objectContaining({ id: 'log-oats' }));
    expect(undoBar.props?.label).toBeNull();
  });

  it('holds the Undo behind Copy again’s question, then gives it its full time', async () => {
    fakeTimers();
    await renderFuel({ day: '2026-11-04', milk: true, copyAgain: true });
    await remove('Milk');
    await act(async () => { rows.Oats.menu!.find((item) => item.title === 'Copy to today')!.run!(); });
    expect(alert.mock.calls[0][0]).toBe('Copy again?');
    await wait(30_000);
    expect(undoBar.props?.label).toBe('Milk deleted');
    await act(async () => { buttons(0).find((button) => button.text === 'Cancel')!.onPress!(); });
    await wait(4_000);
    expect(undoBar.props?.label).toBe('Milk deleted');
    await wait(1_500);
    expect(undoBar.props?.label).toBeNull();
  });

  it('holds a newer delete’s Undo behind an older delete’s failure, then gives it its full time', async () => {
    fakeTimers();
    const oats = later<boolean>();
    deleteEntry.mockReturnValueOnce(oats.promise);
    await renderFuel({ milk: true });
    await remove('Oats');
    await remove('Milk');
    await act(async () => { oats.resolve(false); });
    expect(alert.mock.calls[0].slice(0, 2)).toEqual(["Couldn't confirm the delete", 'It may have gone through. Fuel shows what is saved once it reads the day again; check your connection.']);
    await wait(30_000);
    expect(undoBar.props?.label).toBe('Milk deleted');
    await act(async () => { buttons(0)[0].onPress!(); });
    await wait(4_000);
    expect(undoBar.props?.label).toBe('Milk deleted');
    await wait(1_500);
    expect(undoBar.props?.label).toBeNull();
  });
});

describe("Fuel's Undo against the real store and a simulated server", () => {
  const press = (title: string, text: string) => {
    const call = alert.mock.calls.find(([shown]) => shown === title)!;
    return act(async () => { (call[2] as AlertButton[]).find((button) => button.text === text)!.onPress!(); });
  };

  /** The real Fuel store (native/src/lib/fuel.ts) on a simulated server: its rows, and its delete and restore. */
  function serverStore() {
    const rows = new Map<string, { id: string; date: string }>();
    const deleteEntry = vi.fn<(id: string) => Promise<boolean>>();
    const restoreEntry = vi.fn<(log: { id: string; date: string }) => Promise<boolean>>();
    const query = { select: () => query, eq: () => query, gte: () => query, lte: () => query, order: async () => ({ data: [], error: null }) };
    const fuel = loadNativeModule<typeof import('../native/src/lib/fuel')>('lib/fuel.ts', {
      'date-fns': dates,
      zustand: { create: zustandCreate },
      '@/lib/accountScope': { captureAccountScope },
      '@/lib/nutritionLogQueries': {
        fetchNutritionLogsWithFoods: async (_user: string, range: { from: string; to: string }) => ({
          data: [...rows.values()].filter((row) => row.date >= range.from && row.date <= range.to),
          error: null,
        }),
      },
      '@/lib/nutritionDay': { ensureDefaultGroups: async () => null, deleteNutritionEntry: deleteEntry, restoreNutritionEntry: restoreEntry },
      '@/lib/nutritionGroups': groupsRules,
      '@/lib/nutritionMacros': macros,
      '@/lib/repeatEntries': repeated,
      '@/lib/sessionUser': { getSessionUserId: async () => 'user-a' },
      '@/lib/supabase': { supabase: { from: () => query } },
      './meals': meals,
    });
    return { fuel, server: { rows, deleteEntry, restoreEntry } };
  }

  it('keeps Undo and its Try again when a delete’s answer is lost after the row went', async () => {
    const { fuel, server } = serverStore();
    server.rows.set('log-oats', { id: 'log-oats', user_id: 'user-a', date: TODAY, logged_at: `${TODAY}T08:00:00Z`, food_id: 'oats', servings: 1, group_id: null, sort_order: 0, food: oats } as never);
    let answerDelete!: () => void;
    server.deleteEntry.mockImplementationOnce((id) => new Promise<boolean>((resolve) => {
      // The server deletes the row; its answer is lost on the way back.
      answerDelete = () => { server.rows.delete(id); resolve(false); };
    }));
    server.restoreEntry
      .mockResolvedValueOnce(false)
      .mockImplementationOnce(async (log) => { server.rows.set(log.id, log); return true; });
    await fuel.useFuelStore.getState().loadToday(TODAY);
    await renderFuel({ fuelModule: fuel });

    await act(async () => { rows.Oats.menu!.find((item) => item.title === 'Delete')!.run!(); });
    // Undo is asked for before the delete's answer comes back.
    await act(async () => { undoBar.props!.onUndo(); });
    await act(async () => { answerDelete(); });
    await vi.waitFor(() => expect(alert.mock.calls.map(([title]) => title)).toContain('Not put back'));
    expect(server.rows.has('log-oats')).toBe(false);
    expect(undoBar.props?.label).toBe('Oats deleted');

    await press('Not put back', 'Try again');
    await vi.waitFor(() => expect(undoBar.props?.label).toBeNull());
    expect(server.restoreEntry).toHaveBeenCalledTimes(2);
    expect(server.rows.has('log-oats')).toBe(true);
    await vi.waitFor(() => expect(fuel.useFuelStore.getState().logs.map((log) => log.id)).toContain('log-oats'));
  });
  // Every delete answer, with Undo asked for never, before the answer or after it, and each restore answer.
  const deletes = ['ok', 'failed', 'lost'] as const;
  const restores = ['ok', 'failed', 'lost'] as const;
  const cases = deletes.flatMap((deleted) => [
    [deleted, 'none', 'ok'] as const,
    ...(['before', 'after'] as const).flatMap((timing) => restores.map((restored) => [deleted, timing, restored] as const)),
  ]);
  it.each(cases)('delete %s, Undo %s, restore %s: Undo stays until the entry is back, with Try again after any failure', async (deleted, timing, restored) => {
    const { fuel, server } = serverStore();
    const row = { id: 'log-oats', user_id: 'user-a', date: TODAY, logged_at: `${TODAY}T08:00:00Z`, food_id: 'oats', servings: 1, group_id: null, sort_order: 0, food: oats };
    server.rows.set(row.id, row as never);
    let answerDelete!: () => void;
    server.deleteEntry.mockImplementationOnce((id) => new Promise<boolean>((resolve) => {
      answerDelete = () => {
        if (deleted !== 'failed') server.rows.delete(id);
        resolve(deleted === 'ok');
      };
    }));
    server.restoreEntry
      .mockImplementationOnce(async (log) => {
        if (restored !== 'failed') server.rows.set(log.id, log);
        return restored === 'ok';
      })
      .mockImplementation(async (log) => { server.rows.set(log.id, log); return true; });
    await fuel.useFuelStore.getState().loadToday(TODAY);
    await renderFuel({ fuelModule: fuel });
    const settle = () => act(async () => { for (let tick = 0; tick < 30; tick += 1) await Promise.resolve(); });

    await act(async () => { rows.Oats.menu!.find((item) => item.title === 'Delete')!.run!(); });
    if (timing === 'before') await act(async () => { undoBar.props!.onUndo(); });
    await act(async () => { answerDelete(); });
    await settle();
    // A failed answer says only what is known: never "Not deleted".
    expect(alert.mock.calls.map(([title]) => title)).not.toContain('Not deleted');
    expect(alert.mock.calls.some(([title]) => title === "Couldn't confirm the delete")).toBe(deleted !== 'ok');
    if (deleted !== 'ok') await press("Couldn't confirm the delete", 'OK');

    if (timing !== 'before') {
      // Before any Undo, the day shows what the server has: read again after a failed answer.
      const saved = server.rows.has(row.id);
      expect(saved).toBe(deleted === 'failed');
      await vi.waitFor(() => expect(fuel.useFuelStore.getState().totalsNeedRefresh).toBe(false));
      expect(fuel.useFuelStore.getState().logs.filter((log) => log.id === row.id)).toHaveLength(saved ? 1 : 0);
      expect(fuel.useFuelStore.getState().todayTotals.calories).toBe(saved ? 150 : 0);
    }
    if (timing === 'none') {
      // A failed answer keeps the offer: the row may be gone.
      expect(undoBar.props?.label).toBe('Oats deleted');
      return;
    }
    if (timing === 'after') await act(async () => { undoBar.props!.onUndo(); });
    await settle();
    if (restored !== 'ok') {
      await vi.waitFor(() => expect(alert.mock.calls.map(([title]) => title)).toContain('Not put back'));
      expect(undoBar.props?.label).toBe('Oats deleted');
      await press('Not put back', 'Try again');
    }
    await vi.waitFor(() => expect(undoBar.props?.label).toBeNull());
    expect(server.rows.has(row.id)).toBe(true);
    await vi.waitFor(() => expect(fuel.useFuelStore.getState().todayLoadedForUserId).toBe('user-a'));
    await vi.waitFor(() => expect(fuel.useFuelStore.getState().logs.filter((log) => log.id === row.id)).toHaveLength(1));
  });
});

describe('deleting a meal of your own', () => {
  async function deleteOwnMeal() {
    await renderFuel({ meal: true });
    const options = Object.keys(pressables).find((label) => label.endsWith(' options'))!;
    await act(async () => { pressables[options].onPress!(); });
    const [{ options: offered }, answer] = actionSheet.mock.calls[0];
    await act(async () => { answer(offered.findIndex((option) => option.startsWith('Delete '))); });
    await act(async () => { for (let tick = 0; tick < 10; tick += 1) await Promise.resolve(); });
  }

  it("says it couldn't confirm a delete whose answer failed, never \"Not deleted\"", async () => {
    deleteGroup.mockResolvedValueOnce(false);
    await deleteOwnMeal();
    expect(deleteGroup).toHaveBeenCalledOnce();
    expect(alert.mock.calls.map(([title]) => title)).toEqual(["Couldn't confirm the delete"]);
    expect(alert.mock.calls[0][1]).toContain('It may have gone through');
  });

  it('says nothing more once the delete is confirmed', async () => {
    await deleteOwnMeal();
    expect(deleteGroup).toHaveBeenCalledOnce();
    expect(alert).not.toHaveBeenCalled();
  });
});
