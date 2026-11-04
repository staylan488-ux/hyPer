// @vitest-environment happy-dom
import { act, createElement, Fragment, type ComponentType, type PropsWithChildren } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Food } from '@/types';
import { loadNativeModule } from './helpers/loadNativeModule';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Snap a meal refuses while a lookup runs (log-food.tsx's sheetSnap). Opening a
// USDA result reads its portion first, so Search claims the sheet until the
// review opens (a read claim: closing loses nothing, so the leave guard stays
// out of it); a press meanwhile can't hide the review behind the camera.

const Wrap = ({ children }: PropsWithChildren) => createElement(Fragment, null, children);
const Empty = () => null;
const noop = () => {};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// Search keeps results and portions for the session, so each case looks up a food of its own.
let serial = 0;
let milk: Food;

type Press = { accessibilityLabel?: string; onPress?: () => void };
type Input = { accessibilityLabel?: string; onChangeText: (text: string) => void };
const pressables: Press[] = [];
const inputs: Record<string, Input> = {};
let detail = deferred<Food>();
const release = vi.fn();
const beginRead = vi.fn(() => release);
const beginBusy = vi.fn(() => release);
const chooseFood = vi.fn();
const logger = { purpose: 'log', editing: null, beginBusy, beginRead, chooseFood, addIngredients: noop, groups: [], when: {} };

const { SearchTab } = loadNativeModule<{ SearchTab: ComponentType }>('fuel/FoodLists.tsx', {
  'expo-symbols': { SymbolView: Empty },
  'react-native': {
    ActivityIndicator: Empty,
    Alert: { alert: vi.fn() },
    Pressable: (props: PropsWithChildren<Press>) => {
      pressables.push(props);
      return Wrap(props);
    },
    TextInput: (props: Input) => {
      if (props.accessibilityLabel) inputs[props.accessibilityLabel] = props;
      return null;
    },
    View: Wrap,
  },
  'react-native-reanimated': { default: { View: Wrap }, LayoutAnimationConfig: Wrap },
  '@/lib/foodPersistence': { ensureFoodRow: vi.fn() },
  '@/lib/foodUnits': { foodMacroLine: () => '', formatMeasurementAmount: String },
  '@/lib/mealComposition': { createMealIngredient: noop, decodeMealComposition: () => null },
  '@/lib/pendingEntryId': { createPendingEntryId: noop },
  '@/lib/saveNutritionEntry': { chosenFoodLogSource: noop },
  '@/lib/savedMeals': { filterSavedMeals: () => [], retireSavedMeal: vi.fn() },
  '@/lib/sessionUser': { getSessionUserId: async () => 'user-a' },
  '@/lib/usdaClient': { searchUsdaFoodsSecureStrict: async () => [milk], withUsdaPortion: () => detail.promise },
  '~/components/BlancText': { BlancText: Wrap },
  '~/components/Capsule': { Capsule: Empty },
  '~/components/HoldMenu': { HoldMenu: Wrap, hasHoldMenu: true, menuAccessibility: () => null, showActionSheet: noop },
  '~/components/Row': { Hairline: Empty },
  '~/components/SwipeRow': { closeOpenSwipeRow: () => false, SwipeRow: Wrap, useSwipeActions: () => null },
  '~/lib/foodLogger': { saveFoodEntry: vi.fn() },
  '~/lib/fuel': { useFuelStore: { getState: () => ({ refresh: noop }) } },
  '~/lib/haptics': { haptics: { tap: noop, select: noop, success: noop, error: noop } },
  '~/lib/motion': { rowEnter: {}, rowExit: {}, rowLayout: {} },
  '~/theme/blanc': { type: { field: {} }, useBlanc: () => ({}) },
  './context': { useLogger: () => logger },
});

let root: Root;
beforeEach(() => {
  vi.useFakeTimers();
  serial += 1;
  milk = {
    id: `usda-${serial}`, user_id: null, name: `Milk ${serial}`, calories: 120, protein: 8, carbs: 12, fat: 5,
    serving_size: 240, serving_unit: 'ml', source: 'usda', fdc_id: `${1000 + serial}`,
  };
  pressables.length = 0;
  detail = deferred();
  release.mockClear();
  chooseFood.mockClear();
  root = createRoot(document.createElement('div'));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
});

/** Searches for milk and taps its result, whose portion read then waits on `detail`. */
async function openResult() {
  await act(async () => { root.render(createElement(SearchTab)); });
  await act(async () => { inputs['Search USDA foods'].onChangeText(milk.name); });
  await act(async () => { await vi.advanceTimersByTimeAsync(350); });
  const row = [...pressables].reverse().find((props) => props.accessibilityLabel?.startsWith(`${milk.name}, `));
  expect(row).toBeDefined();
  await act(async () => { row!.onPress!(); });
}

describe('Search: a result being opened claims the sheet', () => {
  it('holds the claim until the review opens', async () => {
    await openResult();
    expect(beginRead).toHaveBeenCalledOnce();
    // a read, not a lookup the leave guard holds the sheet for
    expect(beginBusy).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
    expect(chooseFood).not.toHaveBeenCalled();
    const portioned = { ...milk, serving_label: '1 cup' };
    await act(async () => { detail.resolve(portioned); });
    expect(chooseFood).toHaveBeenCalledWith(portioned);
    expect(release).toHaveBeenCalledOnce();
  });

  it('lets go when the portion read fails, opening the food as listed', async () => {
    await openResult();
    await act(async () => { detail.reject(new Error('offline')); });
    expect(chooseFood).toHaveBeenCalledWith(milk);
    expect(release).toHaveBeenCalledOnce();
  });

  it('lets go when Search closes mid-read', async () => {
    await openResult();
    await act(async () => root.unmount());
    expect(release).toHaveBeenCalledOnce();
    root = createRoot(document.createElement('div'));
  });
});
