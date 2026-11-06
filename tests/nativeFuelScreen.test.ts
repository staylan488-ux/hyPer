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

// Fuel's screen: the date under the large title opens the month (the bar keeps
// + alone), and a day with food ends on a quiet Log food for that day. A new
// meal or snack is made in Log food's destination menu instead.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const Wrap = ({ children }: PropsWithChildren) => createElement(Fragment, null, children);
const Empty = () => null;
const noop = () => {};

type Press = { accessibilityRole?: string; accessibilityLabel?: string; accessibilityHint?: string; onPress?: () => void; children?: ReactNode };
type CapsuleProps = { title: string; variant?: 'primary' | 'quiet'; onPress: () => void };
type HeaderItem = { label: string; onPress: () => void };

const oats: Food = {
  id: 'oats', user_id: null, name: 'Oats', calories: 150, protein: 5, carbs: 27, fat: 3,
  serving_size: 40, serving_unit: 'g', source: 'usda', fdc_id: '1',
};
const TODAY = '2026-11-05';
const noSavedFoods: Food[] = [];

const push = vi.fn();
const pressables: Record<string, Press> = {};
const capsules: Record<string, CapsuleProps> = {};
const screen: { options?: { unstable_headerRightItems?: () => HeaderItem[] } } = {};
let root: Root | undefined;

async function renderFuel({ day = TODAY, logged = true } = {}) {
  const logs = logged ? [{ id: 'log-oats', date: day, food: oats, servings: 1, logged_at: `${day}T08:00:00Z`, group_id: null, sort_order: 0 }] : [];
  const fuel = { selected: day, logs, groups: [] };
  const Fuel = loadNativeModule<{ default: ComponentType }>('app/(tabs)/fuel/index.tsx', {
    'date-fns': dates,
    'expo-router': {
      router: { push },
      Stack: { Screen: (props: typeof screen) => { screen.options = props.options; return null; } },
    },
    'expo-symbols': { SymbolView: Empty },
    'react-native': {
      ActionSheetIOS: {},
      Alert: {},
      Pressable: (props: Press) => {
        if (props.accessibilityLabel) pressables[props.accessibilityLabel] = props;
        return Wrap(props);
      },
      RefreshControl: Empty,
      useWindowDimensions: () => ({ width: 402, height: 874, fontScale: 1, scale: 3 }),
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
    '@/stores/appStore': { useAppStore: (select: (state: object) => unknown) => select({ macroTarget: null, nutritionProfile: null }) },
    '@/stores/authStore': { useAuthStore: (select: (state: object) => unknown) => select({ user: { id: 'user-a' } }) },
    '~/components/BlancText': { BlancText: Wrap },
    '~/components/Capsule': { Capsule: (props: CapsuleProps) => { capsules[props.title] = props; return null; } },
    '~/components/Label': { Label: Wrap },
    '~/components/HoldMenu': { showActionSheet: noop },
    '~/components/RollingText': { RollingText: Wrap },
    '~/components/Row': { Row: Empty, Hairline: Empty },
    '~/components/Section': { Section: Wrap },
    '~/components/SwipeRow': { SwipeRow: Wrap },
    '~/components/TabScroll': { TabScroll: Wrap },
    '~/components/Track': { Track: Empty },
    '~/fuel/DayMark': { DayMark: Empty },
    '~/lib/format': { formatWhole: String },
    '~/lib/fuel': {
      dayKey: (date: Date) => dates.format(date, 'yyyy-MM-dd'),
      useTodayKey: () => TODAY,
      todayLogsInMatchingMeal: () => null,
      useFuelDay: () => ({ selected: day, loaded: true, status: 'ready', logs: fuel.logs, groups: fuel.groups }),
      useFuelStore: Object.assign((select: (state: typeof fuel) => unknown) => select(fuel), { getState: () => fuel }),
    },
    '~/lib/accessibility': silentAccessibility,
    '~/lib/haptics': { haptics: { tap: noop, select: noop, success: noop, error: noop } },
    '~/lib/motion': {},
    '~/lib/you': { useYouMealsStore: (select: (state: { meals: Food[] | null }) => unknown) => select({ meals: null }) },
    '~/theme/blanc': { useBlanc: () => ({}), space: { gutter: 16 }, figureLead: () => 0 },
  }).default;
  root = createRoot(document.createElement('div'));
  await act(async () => { root!.render(createElement(Fuel)); });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`${TODAY}T10:00:00`));
  push.mockClear();
  for (const record of [pressables, capsules]) for (const key of Object.keys(record)) delete record[key];
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

  it('names another day as Fuel titles it', async () => {
    await renderFuel({ day: '2026-11-03' });
    await act(async () => { pressables['Tuesday, Nov 3'].onPress!(); });
    expect(push).toHaveBeenCalledWith('/fuel-month');
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
