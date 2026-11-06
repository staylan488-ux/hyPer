// @vitest-environment happy-dom
import { act, createElement, Fragment, type ComponentType, type PropsWithChildren } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Food } from '@/types';
import { loadNativeModule } from './helpers/loadNativeModule';
import { silentAccessibility } from './helpers/silentAccessibility';

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
const pressables: Press[] = [];
let detail = deferred<Food>();
const release = vi.fn();
const beginRead = vi.fn(() => release);
const beginBusy = vi.fn(() => release);
const chooseFood = vi.fn();
const composeMeal = vi.fn();
const logger: Record<string, unknown> = {
  purpose: 'log', editing: null, beginBusy, beginRead, beginSave: () => noop, chooseFood, composeMeal, addIngredients: noop, groups: [], when: {}, savedMeals: [] as Food[],
  // Quick adds live on the sheet (#179), so a list keeps them across tabs.
  quickAddStates: {}, setQuickAddStates: noop, pendingQuickAdds: new Map(),
};

const { SearchTab } = loadNativeModule<{ SearchTab: ComponentType<{ query: string }> }>('fuel/FoodLists.tsx', {
  'expo-symbols': { SymbolView: Empty },
  'react-native': {
    ActivityIndicator: Empty,
    Alert: { alert: vi.fn() },
    Pressable: (props: PropsWithChildren<Press>) => {
      pressables.push(props);
      return Wrap(props);
    },
    // the field is the sheet's (Search foods); SearchTab shows its results
    TextInput: Empty,
    View: Wrap,
  },
  'react-native-reanimated': { default: { View: Wrap }, LayoutAnimationConfig: Wrap },
  '@/lib/foodPersistence': { ensureFoodRow: vi.fn() },
  '@/lib/foodUnits': { foodMacroLine: () => '', formatMeasurementAmount: String },
  '@/lib/mealComposition': { createMealIngredient: noop, decodeMealComposition: () => null },
  '@/lib/nutritionLedger': { servingLabel: () => '' },
  '@/lib/pendingEntryId': { createPendingEntryId: noop },
  '@/lib/saveNutritionEntry': { chosenFoodLogSource: noop },
  '@/lib/savedMeals': {
    filterSavedMeals: (meals: Food[], filter: string) => meals.filter((meal) => meal.name.toLowerCase().includes(filter.trim().toLowerCase())),
    retireSavedMeal: vi.fn(),
  },
  '@/lib/sessionUser': { getSessionUserId: async () => 'user-a' },
  '@/lib/usdaClient': { searchUsdaFoodsSecureStrict: async () => [milk], withUsdaPortion: () => detail.promise },
  '~/components/BlancText': { BlancText: ({ children }: PropsWithChildren) => createElement('span', null, children) },
  '~/components/Capsule': { Capsule: Empty },
  '~/components/HoldMenu': { HoldMenu: Wrap, hasHoldMenu: true, menuAccessibility: () => null, showActionSheet: noop },
  '~/components/Label': { Label: Wrap },
  '~/components/Row': { Hairline: Empty },
  '~/components/SwipeRow': { closeOpenSwipeRow: () => false, SwipeRow: Wrap, useSwipeActions: () => null },
  '~/lib/accessibility': silentAccessibility,
  '~/lib/foodLogger': { saveFoodEntry: vi.fn() },
  '~/lib/format': { formatWhole: (value: number) => String(Math.round(value)) },
  '~/lib/fuel': { useFuelStore: { getState: () => ({ refresh: noop }) } },
  '~/lib/haptics': { haptics: { tap: noop, select: noop, success: noop, error: noop } },
  '~/lib/motion': { blockExit: {}, rowEnter: {}, rowExit: {}, rowLayout: {} },
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

/** Searches for milk (typed into Log food's Search foods field) and taps its result, whose portion read then waits on `detail`. */
async function openResult() {
  await act(async () => { root.render(createElement(SearchTab, { query: '' })); });
  await act(async () => { root.render(createElement(SearchTab, { query: milk.name })); });
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

describe('Search: one field for saved meals and USDA', () => {
  // Search keeps results for the session, so each case types its own milk.
  const shakeFor = (name: string): Food => ({
    id: 'saved-shake', user_id: 'user-a', name: `${name} shake, mine`, calories: 410, protein: 40, carbs: 30, fat: 12,
    serving_size: 1, serving_unit: 'serving', source: 'custom', fdc_id: null,
  });
  afterEach(() => { logger.savedMeals = []; });

  it('lists matching saved meals first, under Saved, then USDA under Foods', async () => {
    const shake = shakeFor(milk.name);
    logger.savedMeals = [shake];
    const host = document.createElement('div');
    root.unmount();
    root = createRoot(host);
    await act(async () => { root.render(createElement(SearchTab, { query: milk.name })); });
    await act(async () => { await vi.advanceTimersByTimeAsync(350); });
    const text = host.textContent ?? '';
    expect(text.indexOf('Saved')).toBeGreaterThanOrEqual(0);
    expect(text.indexOf(shake.name)).toBeGreaterThan(text.indexOf('Saved'));
    expect(text.indexOf('Foods')).toBeGreaterThan(text.indexOf(shake.name));
    expect(text.lastIndexOf(milk.name)).toBeGreaterThan(text.indexOf('Foods'));
    // a saved meal opens as the Saved list opens it
    const row = [...pressables].reverse().find((props) => props.accessibilityLabel?.startsWith(`${shake.name}, `));
    await act(async () => { row!.onPress!(); });
    expect(chooseFood).toHaveBeenCalledWith(shake);
  });

  it('names no groups while only one kind matches', async () => {
    const host = document.createElement('div');
    root.unmount();
    root = createRoot(host);
    await act(async () => { root.render(createElement(SearchTab, { query: milk.name })); });
    await act(async () => { await vi.advanceTimersByTimeAsync(350); });
    expect(host.textContent).toContain(milk.name);
    expect(host.textContent).not.toContain('Saved');
    expect(host.textContent).not.toContain('Foods');
  });
});
