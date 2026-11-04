// @vitest-environment happy-dom
import * as dates from 'date-fns';
import { act, createElement, Fragment, type ComponentType, type PropsWithChildren } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';

import * as fuelSummary from '@/lib/fuelSummary';
import * as composition from '@/lib/mealComposition';
import * as calendar from '@/lib/nutritionCalendar';
import * as groupsRules from '@/lib/nutritionGroups';
import * as ledger from '@/lib/nutritionLedger';
import * as logUtils from '@/lib/nutritionLogUtils';
import * as macros from '@/lib/nutritionMacros';
import { clearSavedFoodsCache, readSavedFoodsCache, subscribeSavedFoodsCache, writeSavedFoodsCache } from '@/lib/savedFoodsCache';
import * as savedMealFromLog from '@/lib/savedMealFromLog';
import type { Food } from '@/types';
import { loadNativeModule } from './helpers/loadNativeModule';

// the real saved-foods cache runs over this account store
const auth = vi.hoisted(() => ({ state: { user: { id: 'user-a' } } }));
vi.mock('@/stores/authStore', () => ({
  useAuthStore: Object.assign((select: (state: typeof auth.state) => unknown) => select(auth.state), {
    getState: () => auth.state,
    subscribe: () => () => {},
  }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type MenuAction = { title: string };
const Wrap = ({ children }: PropsWithChildren) => createElement(Fragment, null, children);
const Empty = () => null;
const noop = () => {};

const today = dates.format(new Date(), 'yyyy-MM-dd');
const tomorrow = dates.format(dates.addDays(new Date(), 1), 'yyyy-MM-dd');
// the clock Fuel reads; a test moves it past midnight
const clock = { today };
const oats: Food = {
  id: 'oats', user_id: null, name: 'Oats', calories: 150, protein: 5, carbs: 27, fat: 3,
  serving_size: 40, serving_unit: 'g', source: 'usda', fdc_id: '1',
};
const log = { id: 'log-oats', date: today, food: oats, servings: 2, logged_at: `${today}T08:00:00Z`, group_id: null, sort_order: 0 };
// Oats at the amount eaten, as Save as meal keeps it
const savedOats: Food = { ...oats, id: 'saved-oats', calories: 300, protein: 10, carbs: 54, fat: 6, serving_size: 1, serving_unit: 'meal', source: 'saved_meal' };

let root: Root | undefined;
const rows: Record<string, { menu?: MenuAction[] }> = {};
const useYouMealsStore = create<{ meals: Food[] | null }>(() => ({ meals: null }));

async function renderFuel({ compile = false } = {}) {
  // the same lists on every render, as the store keeps them while nothing changes
  const fuel = { logs: [log], groups: [] };
  const Fuel = loadNativeModule<{ default: ComponentType }>('app/(tabs)/fuel/index.tsx', {
    'date-fns': dates,
    'expo-router': { router: { push: noop }, Stack: { Screen: Empty } },
    'expo-symbols': { SymbolView: Empty },
    'react-native': { ActionSheetIOS: {}, Alert: {}, Pressable: Wrap, RefreshControl: Empty, View: Wrap },
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
    '@/lib/savedFoodsCache': { readSavedFoodsCache, subscribeSavedFoodsCache },
    '@/lib/savedMealFromLog': savedMealFromLog,
    '@/stores/appStore': { useAppStore: (select: (state: object) => unknown) => select({ macroTarget: null, nutritionProfile: null }) },
    '@/stores/authStore': { useAuthStore: Object.assign((select: (state: typeof auth.state) => unknown) => select(auth.state), { getState: () => auth.state }) },
    '~/components/BlancText': { BlancText: Wrap },
    '~/components/Capsule': { Capsule: Empty },
    '~/components/Label': { Label: Wrap },
    '~/components/HoldMenu': { showActionSheet: noop },
    '~/components/RollingText': { RollingText: Wrap },
    '~/components/Row': { Row: (props: { title: string; menu?: MenuAction[] }) => { rows[props.title] = props; return null; }, Hairline: Empty },
    '~/components/Section': { Section: Wrap },
    '~/components/SwipeRow': { SwipeRow: Wrap },
    '~/components/TabScroll': { TabScroll: Wrap },
    '~/components/Track': { Track: Empty },
    '~/lib/format': { formatWhole: String },
    '~/lib/fuel': {
      dayKey: (date: Date) => dates.format(date, 'yyyy-MM-dd'),
      today: () => clock.today,
      useTodayKey: () => clock.today,
      todayLogsInMatchingMeal: () => null,
      useFuelDay: () => ({ selected: today, loaded: true, status: 'ready', logs: fuel.logs, groups: fuel.groups }),
      useFuelStore: Object.assign((select: (state: typeof fuel) => unknown) => select(fuel), { getState: () => fuel }),
    },
    '~/lib/haptics': { haptics: { tap: noop, select: noop, success: noop, error: noop } },
    '~/lib/motion': {},
    '~/lib/you': { useYouMealsStore },
    '~/theme/blanc': { useBlanc: () => ({}), space: { gutter: 20 } },
  }, { compile }).default;
  root = createRoot(document.createElement('div'));
  const render = () => act(async () => { root!.render(createElement(Fuel)); });
  await render();
  return render;
}

const offersSaveAsMeal = () => rows.Oats.menu!.some((action) => action.title === 'Save as meal');
const offersCopyToToday = () => rows.Oats.menu!.some((action) => action.title === 'Copy to today');

describe("Fuel's Save as meal offer", () => {
  beforeEach(() => {
    clock.today = today;
    clearSavedFoodsCache();
    useYouMealsStore.setState({ meals: null });
  });
  afterEach(async () => {
    await act(async () => { root?.unmount(); });
    root = undefined;
  });

  it('goes once the meal is saved, though Save as meal closes without refreshing Fuel', async () => {
    writeSavedFoodsCache('user-a', []);
    await renderFuel();
    expect(offersSaveAsMeal()).toBe(true);
    // the sheet reloads the saved meals as it closes
    await act(async () => { writeSavedFoodsCache('user-a', [savedOats]); });
    expect(offersSaveAsMeal()).toBe(false);
  });

  it("follows You's saved meals when Log food has not read them", async () => {
    await renderFuel();
    expect(offersSaveAsMeal()).toBe(true);
    await act(async () => { useYouMealsStore.setState({ meals: [savedOats] }); });
    expect(offersSaveAsMeal()).toBe(false);
  });
});

describe("Fuel's Copy to today, as the app compiles it", () => {
  beforeEach(() => {
    clock.today = today;
    clearSavedFoodsCache();
    writeSavedFoodsCache('user-a', []);
  });
  afterEach(async () => {
    await act(async () => { root?.unmount(); });
    root = undefined;
  });

  it("is offered on the day just gone once midnight passes, though the day's entries did not change", async () => {
    const render = await renderFuel({ compile: true });
    expect(offersCopyToToday()).toBe(false);
    // Fuel left open overnight; the screen renders again with the same entries
    clock.today = tomorrow;
    await render();
    expect(offersCopyToToday()).toBe(true);
  });
});
