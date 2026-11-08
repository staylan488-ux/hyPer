// @vitest-environment happy-dom
import * as dates from 'date-fns';
import { act, createElement, Fragment, type ComponentType, type PropsWithChildren, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as fuelSummary from '@/lib/fuelSummary';
import * as composition from '@/lib/mealComposition';
import * as calendar from '@/lib/nutritionCalendar';
import * as groupsRules from '@/lib/nutritionGroups';
import * as ledger from '@/lib/nutritionLedger';
import * as logUtils from '@/lib/nutritionLogUtils';
import * as macros from '@/lib/nutritionMacros';
import * as savedMealFromLog from '@/lib/savedMealFromLog';
import type { Food } from '@/types';
import { loadNativeModule } from './helpers/loadNativeModule';
import { silentAccessibility } from './helpers/silentAccessibility';
import { create as zustandCreate } from 'zustand';

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
type Target = { calories: number; protein: number; carbs: number; fat: number };

const oats: Food = {
  id: 'oats', user_id: null, name: 'Oats', calories: 150, protein: 5, carbs: 27, fat: 3,
  serving_size: 40, serving_unit: 'g', source: 'usda', fdc_id: '1',
};
const TODAY = '2026-11-05';
const noSavedFoods: Food[] = [];

const push = vi.fn();
const pressables: Record<string, Press> = {};
const capsules: Record<string, CapsuleProps> = {};
const rows: Record<string, RowProps> = {};
const marks: MarkProps[] = [];
const undoBar: { props?: UndoBarProps } = {};
const alert = vi.fn();
const deleteEntry = vi.fn<(id: string) => Promise<boolean>>();
const restoreEntry = vi.fn<(log: object) => Promise<boolean>>();
const screen: { options?: { unstable_headerRightItems?: () => HeaderItem[] } } = {};
let root: Root | undefined;
let host: HTMLDivElement;

async function renderFuel({ day = TODAY, logged = true, source, target = null, loaded = true, fontScale = 1 }: {
  day?: string;
  logged?: boolean;
  source?: string;
  target?: Target | null;
  loaded?: boolean;
  fontScale?: number;
} = {}) {
  const logs = logged ? [{ id: 'log-oats', date: day, food: oats, servings: 1, logged_at: `${day}T08:00:00Z`, group_id: null, sort_order: 0, source }] : [];
  const fuel = { selected: day, logs, groups: [], deleteEntry, restoreEntry };
  const Fuel = loadNativeModule<{ default: ComponentType }>('app/(tabs)/fuel/index.tsx', {
    'date-fns': dates,
    'expo-router': {
      router: { push },
      Stack: { Screen: (props: typeof screen) => { screen.options = props.options; return null; } },
    },
    'expo-symbols': { SymbolView: Empty },
    'react-native': {
      ActionSheetIOS: {},
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
    '@/lib/repeatEntries': { alreadyOnDay: () => false },
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
    '~/components/Section': { Section: Wrap },
    '~/components/SwipeRow': { SwipeRow: Wrap },
    '~/components/TabScroll': { TabScroll: Wrap, tabBarCover: () => 0 },
    '~/components/UndoBar': { UndoBar: (props: UndoBarProps) => { undoBar.props = props; return null; } },
    '~/lib/workoutBar': { useWorkoutBarShown: (select: (state: { shown: boolean }) => unknown) => select({ shown: false }) },
    zustand: { create: zustandCreate },
    '~/components/Track': { Track: ({ progress }: { progress: number }) => createElement('i', { 'data-track': String(progress) }) },
    '~/fuel/DayMark': { DayMark: (props: MarkProps) => { marks.push(props); return null; } },
    '~/lib/format': { formatWhole: String },
    '~/lib/fuel': {
      dayKey: (date: Date) => dates.format(date, 'yyyy-MM-dd'),
      useTodayKey: () => TODAY,
      todayLogsInMatchingMeal: () => null,
      useFuelDay: () => ({ selected: day, loaded, status: loaded ? 'ready' : 'loading', logs: loaded ? fuel.logs : [], groups: fuel.groups }),
      useFuelStore: Object.assign((select: (state: typeof fuel) => unknown) => select(fuel), { getState: () => fuel }),
    },
    '~/lib/accessibility': silentAccessibility,
    '~/lib/haptics': { haptics: { tap: noop, select: noop, success: noop, error: noop } },
    '~/lib/motion': {},
    '~/lib/you': { useYouMealsStore: (select: (state: { meals: Food[] | null }) => unknown) => select({ meals: null }) },
    '~/theme/blanc': { useBlanc: () => ({}), space: { gutter: 16 }, figureLead: () => 0, restingFigure: {} },
  }).default;
  host = document.createElement('div');
  root = createRoot(host);
  await act(async () => { root!.render(createElement(Fuel)); });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`${TODAY}T10:00:00`));
  push.mockClear();
  for (const record of [pressables, capsules, rows]) for (const key of Object.keys(record)) delete record[key];
  marks.length = 0;
  undoBar.props = undefined;
  alert.mockClear();
  deleteEntry.mockReset().mockResolvedValue(true);
  restoreEntry.mockReset().mockResolvedValue(true);
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
