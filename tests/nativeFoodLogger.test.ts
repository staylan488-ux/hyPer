// @vitest-environment happy-dom
import * as dates from 'date-fns';
import { act, createContext, createElement, Fragment, useContext, useEffect, type ComponentType, type PropsWithChildren } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as barcodes from '@/lib/barcodes';
import * as composition from '@/lib/mealComposition';
import * as pendingEntry from '@/lib/pendingEntryId';
import * as photoReview from '@/lib/photoReview';
import * as requestGate from '@/lib/requestGate';
import { assertComposedMealOptions } from '@/lib/saveMealComposition';
import { foodValuesMatch, savedMealSuggestions } from '@/lib/savedMeals';
import * as timeout from '@/lib/withTimeout';
import type { Food } from '@/types';
import { loadNativeModule } from './helpers/loadNativeModule';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const Wrap = ({ children }: PropsWithChildren) => createElement(Fragment, null, children);
const Empty = () => null;
const noop = () => {};
const milk: Food = {
  id: 'milk', user_id: null, name: 'Milk', calories: 120, protein: 8, carbs: 12, fat: 5,
  serving_size: 240, serving_unit: 'ml', source: 'custom', fdc_id: null,
};
const recipe: Food = {
  ...milk, id: 'recipe', name: 'Protein shake', serving_size: 1, serving_unit: 'meal', source: 'saved_meal',
  description: composition.encodeMealComposition([composition.createMealIngredient(milk, 1, 'milk-part')]),
};
const savedMilk: Food = { ...milk, id: 'saved-milk', user_id: 'user-a', source: 'saved_meal' };
const loggedMilk = { id: 'log-milk', date: '2026-11-03', food: milk, servings: 1, logged_at: '2026-11-03T17:00:00Z', group_id: null };
const photoResult = { items: [], provider: 'openai', model: 'test', summary: 'Fresh plate' };
const photoItem: photoReview.PhotoReviewItem = {
  id: 'photo-milk', name: 'Milk', searchQuery: 'milk', amountGrams: 240, modelAmountGrams: 240,
  modelCalories: 120, modelProtein: 8, modelCarbs: 12, modelFat: 5, confidence: 0.8, notes: '',
  groundedFood: null, groundingCandidates: [],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

type Button = { title: string; disabled?: boolean; onPress: () => void };
type Field = { label: string; onChangeText: (text: string) => void };
type Context = { beginBusy: () => () => void; addIngredients: (parts: composition.MealIngredient[]) => void; composeMeal: (food: Food) => void; chooseFood: (food: Food) => void; editing: unknown; savedMeals: Food[] | null };
type ReviewProps = {
  draft: composition.MealDraft;
  savedTarget?: Food;
  editingEntryId?: string;
  update: (patch: Partial<composition.MealDraft>) => void;
};
type ManualProps = { draft: { fields: { name: string } }; onGeminiHandoff?: (description: string) => void };
type PhotoDraft = { photos: Record<string, unknown>; items: photoReview.PhotoReviewItem[]; summary: string };
type PhotoProps = { draft: PhotoDraft; setDraft: (update: (draft: PhotoDraft) => PhotoDraft) => void };
type NativeModule = Record<string, unknown>;

const active: Array<() => Promise<void>> = [];
beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  });
});
afterEach(async () => {
  for (const close of active.splice(0)) await close();
  vi.unstubAllGlobals();
});

/** Real sheet, Manual, Scan, Photo and meal-review components; only view/device/data boundaries are mocked. */
function loggerHarness({ editing = false, worker = false, savedMeal = false } = {}) {
  const captured: {
    buttons: Record<string, Button>;
    fields: Record<string, Field>;
    picker?: { selection: string; onSelectionChange: (tab: string) => void };
    saved?: { onEditSavedMeal: (food: Food) => void };
    review?: ReviewProps;
    foodReview?: { food: Food };
    manual?: ManualProps;
    photo?: PhotoProps;
    context?: Context;
    scanCurrent?: () => boolean;
    guard?: { on: boolean; message: { title: string } };
    focus?: () => void;
  } = { buttons: {}, fields: {} };
  const ContextProvider = createContext<Context | null>(null);
  const useLogger = () => useContext(ContextProvider)!;
  const Probe = () => {
    const context = useLogger();
    useEffect(() => { captured.context = context; }, [context]);
    return null;
  };
  const lookup = deferred<{ status: 'stale' | 'miss' }>();
  const analysis = deferred<typeof photoResult>();
  const analyze = vi.fn(() => analysis.promise);
  const token = vi.fn(async () => 'test');
  const ground = vi.fn(async () => [photoItem]);
  const alert = vi.fn();
  const success = vi.fn();
  const error = vi.fn();
  const saveMeal = vi.fn(async () => {});
  const saveFood = vi.fn(async () => {});
  const resolveFood = vi.fn(async () => ({ foodId: savedMilk.id }));
  let savedFoods = [recipe, savedMilk];
  const mealsState: { meals: Food[] | null } = { meals: [recipe] };
  const useYouMealsStore = {
    getState: () => mealsState,
    setState: (update: (state: typeof mealsState) => Partial<typeof mealsState>) => Object.assign(mealsState, update(mealsState)),
  };
  const loadSaved = vi.fn(async () => ({ meals: savedFoods }));
  const loadYou = vi.fn(async () => { mealsState.meals = savedFoods; });
  const replaceSimple = vi.fn(async (_userId: string, id: string, values: Pick<Food, 'name' | 'calories' | 'protein' | 'carbs' | 'fat'>) => {
    const replacement = { ...savedMilk, ...values, id: `replacement-${id}` };
    savedFoods = [...savedFoods.filter((food) => food.id !== id), replacement];
    return { id: replacement.id, retireFailed: false };
  });
  const back = vi.fn();
  const push = vi.fn();
  const fuel = { logs: [loggedMilk], groups: [], refresh: noop };
  const useFuelStore = Object.assign((select: (state: typeof fuel) => unknown) => select(fuel), { getState: () => fuel });
  const imports: Record<string, unknown> = {
    'date-fns': dates,
    '@expo/ui/swift-ui': { Host: Wrap, Picker: (props: NonNullable<typeof captured.picker> & PropsWithChildren) => { captured.picker = props; return Wrap(props); }, Text: Wrap },
    '@expo/ui/swift-ui/modifiers': { pickerStyle: noop, tag: noop },
    'expo-router': {
      router: { back, push },
      useLocalSearchParams: () => editing ? { entry: loggedMilk.id } : savedMeal ? { savedMeal: recipe.id } : {},
      useFocusEffect: (callback: () => void) => {
        captured.focus = callback;
        useEffect(() => { callback(); }, [callback]);
      },
    },
    'expo-symbols': { SymbolView: Empty },
    'expo-image': { Image: Empty },
    'expo-image-manipulator': {},
    'expo-image-picker': {},
    'react-native': { ActionSheetIOS: {}, Alert: { alert }, Pressable: Wrap, View: Wrap, ScrollView: Wrap, TextInput: Empty, Keyboard: { dismiss: noop }, ActivityIndicator: Empty, Linking: {}, Image: {} },
    'react-native-keyboard-controller': { KeyboardAwareScrollView: Wrap },
    'react-native-reanimated': { default: { View: Wrap }, LayoutAnimationConfig: Wrap },
    '@/lib/foodLoggerUtils': { toLocalTimeInput: () => '10:00' },
    '@/lib/mealComposition': composition,
    '@/lib/foodTrial': { getFoodAnalysisMode: () => worker ? 'worker' : 'gemini' },
    '@/lib/nutritionGroups': { nutritionGroupLabel: () => '' },
    '@/lib/savedFoodsCache': { readSavedFoodsCache: () => savedFoods, writeSavedFoodsCache: noop },
    '@/lib/savedMealFromLog': { mealFromLoggedFoods: noop, savedMealNamed: () => undefined },
    '@/lib/savedMeals': { loadSavedMeals: loadSaved, foodValuesMatch, savedMealSuggestions, replaceSavedMeal: replaceSimple },
    '@/lib/sessionUser': { getSessionUserId: async () => 'user-a' },
    '@/stores/authStore': { useAuthStore: Object.assign((select: (state: { user: { id: string } }) => unknown) => select({ user: { id: 'user-a' } }), { getState: () => ({ user: { id: 'user-a' } }) }) },
    '@/lib/foodDescription': {},
    '@/lib/foodPersistence': {},
    '@/lib/manualFood': { resolveManualFood: resolveFood },
    '@/lib/savedBarcodeFoods': {},
    '@/lib/foodUnits': { formatMacroInput: String },
    '@/lib/pendingEntryId': pendingEntry,
    '@/lib/requestGate': requestGate,
    '@/lib/barcodes': barcodes,
    '@/lib/withTimeout': timeout,
    '@/lib/barcodeLookup': { lookupBarcode: (_barcode: string, current: () => boolean) => { captured.scanCurrent = current; return lookup.promise; } },
    '@/lib/photoAnalysis': { getPhotoWorkerSettings: () => ({ provider: 'openai' }), analyzeFoodPhoto: analyze },
    '@/lib/photoReview': { ...photoReview, groundPhotoItems: ground },
    '@/lib/mealDestination': {},
    '@/lib/saveMealComposition': { assertComposedMealOptions, saveComposedMeal: saveMeal },
    '../../modules/hyper-barcode': { HyperBarcode: { getAvailability: async () => ({ available: false }) } },
    '~/components/BlancText': { BlancText: Wrap },
    '~/components/Capsule': { Capsule: (props: Button) => { captured.buttons[props.title] = props; return null; } },
    '~/components/GlassButton': { GlassButton: Empty },
    '~/components/Label': { Label: Wrap },
    '~/components/Row': { Row: (props: Button) => { captured.buttons[props.title] = props; return null; }, Hairline: Empty },
    '~/components/SwipeRow': { dismissOpenSwipeRow: noop, closeOpenSwipeRow: () => false, SwipeRow: Wrap },
    '~/components/HoldMenu': { HoldMenu: Wrap, hasHoldMenu: true },
    '~/components/Form': { FieldRow: (props: Field) => { captured.fields[props.label] = props; return null; }, FormNote: Wrap, ToggleRow: Empty, PickerRow: Empty, useDecimalText: (n: number) => ({ text: String(n), onChangeText: noop }) },
    '~/components/Section': { Section: Wrap },
    '~/components/Stepper': { Stepper: Empty },
    '~/lib/format': { formatWhole: String },
    '~/lib/foodLogger': { initialWhen: () => ({ date: new Date('2026-11-03T10:00:00'), time: '10:00', groupId: null }), usesDayGroups: () => true, timeAsDate: () => new Date(), workerAccessToken: token, saveFoodEntry: saveFood },
    '~/lib/fuel': { groupsForDay: () => [], loadDayGroups: async () => [], suggestedGroup: () => null, today: () => '2026-11-03', useTodayKey: () => '2026-11-03', useFuelStore },
    '~/lib/haptics': { haptics: { tap: noop, select: noop, success, error } },
    '~/lib/leaveGuard': { useLeaveGuard: (on: boolean, message: { title: string }) => { captured.guard = { on, message }; } },
    '~/lib/you': { loadYouMeals: loadYou, useYouMealsStore },
    '~/lib/motion': {},
    '~/platform/previewFlag': { isPreviewActive: () => true },
    '~/fuel/context': { LoggerContext: ContextProvider },
    './context': { useLogger },
    './WhenBlock': { WhenBlock: Empty },
    '~/fuel/FoodLists': { Empty, SearchTab: Empty, SavedTab: (props: NonNullable<typeof captured.saved>) => { captured.saved = props; return null; } },
    '~/fuel/FoodReview': { FoodReview: (props: { food: Food }) => { captured.foodReview = props; return null; } },
    '~/fuel/RecentTab': { RecentTab: Empty },
    '~/fuel/AiTab': { emptyAi: () => ({ hint: '', answer: '', photos: [], result: null, items: [] }), aiHasDraft: () => false, AiTab: Probe },
    '~/theme/blanc': { useBlanc: () => ({}), space: { gutter: 20 }, type: {} },
  };
  const manualModule = loadNativeModule<NativeModule>('fuel/ManualTab.tsx', imports);
  imports['~/fuel/ManualTab'] = { ...manualModule, ManualTab: (props: ManualProps) => {
    captured.manual = props;
    captured.context = useLogger();
    return createElement(manualModule.ManualTab as ComponentType<ManualProps>, props);
  } };
  const reviewModule = loadNativeModule<NativeModule>('fuel/MealReview.tsx', imports);
  imports['~/fuel/MealReview'] = { MealReview: (props: ReviewProps) => {
    captured.review = props;
    return createElement(reviewModule.MealReview as ComponentType<ReviewProps>, props);
  } };
  const photoModule = loadNativeModule<NativeModule>('fuel/PhotoTab.tsx', imports);
  imports['~/fuel/PhotoTab'] = { ...photoModule, PhotoTab: (props: PhotoProps) => {
    captured.photo = props;
    captured.context = useLogger();
    return createElement(photoModule.PhotoTab as ComponentType<PhotoProps>, props);
  } };
  imports['~/fuel/ScanTab'] = loadNativeModule('fuel/ScanTab.tsx', imports);
  const Sheet = loadNativeModule<{ default: ComponentType }>('app/log-food.tsx', imports).default;
  let root: Root | undefined;
  const close = async () => { await act(async () => { root?.unmount(); root = undefined; }); };
  active.push(close);
  const render = async () => {
    captured.review = undefined;
    captured.manual = undefined;
    root = createRoot(document.createElement('div'));
    await act(async () => { root!.render(createElement(Sheet)); });
  };
  const tab = async (name: string) => { await act(async () => { captured.picker!.onSelectionChange(name); }); };
  const click = async (name: string) => {
    expect(captured.buttons[name].disabled).not.toBe(true);
    await act(async () => { captured.buttons[name].onPress(); });
  };
  const startPhoto = async () => {
    await tab('photo');
    await act(async () => { captured.photo!.setDraft((draft) => ({ ...draft, photos: { top: { uri: 'test', width: 10, height: 10 } } })); });
    await click('Analyze');
    expect(token).toHaveBeenCalledOnce();
  };
  const openSavedEditor = async () => {
    const route = push.mock.lastCall?.[0] as { pathname: string; params: { id: string } };
    expect(route.pathname).toBe('/saved-meal');
    const editorImports = { ...imports, 'expo-router': { router: { back }, useLocalSearchParams: () => route.params } };
    const Editor = loadNativeModule<{ default: ComponentType }>('app/saved-meal.tsx', editorImports).default;
    const editorRoot = createRoot(document.createElement('div'));
    const closeEditor = async () => { await act(async () => { editorRoot.unmount(); }); };
    active.push(closeEditor);
    await act(async () => { editorRoot.render(createElement(Editor)); });
  };
  return { captured, render, close, tab, click, startPhoto, openSavedEditor, lookup, analysis, analyze, token, ground, alert, success, error, saveMeal, saveFood, resolveFood, replaceSimple, loadSaved, mealsState, back, push };
}

describe('native food logger transitions', () => {
  it('keeps Saved → Edit separate from the entry that originally opened the sheet', async () => {
    const h = loggerHarness({ editing: true });
    await h.render();
    await h.tab('saved');
    await act(async () => { h.captured.saved!.onEditSavedMeal(recipe); });
    expect(h.captured.review!.savedTarget?.id).toBe(recipe.id);
    expect(h.captured.review!.editingEntryId).toBeUndefined();
    expect(h.captured.context!.editing).toBeNull();
    await act(async () => { h.captured.review!.update({ name: 'Edited shake' }); });
    expect(composition.loadMealDraft('user-a', 'saved:recipe')?.name).toBe('Edited shake');
    expect(composition.loadMealDraft('user-a', 'edit:log-milk')).toBeNull();
    await h.close();
    await h.render();
    expect(h.captured.review).toBeUndefined();
    expect(h.captured.manual!.draft.fields.name).toBe('Milk');
    await h.tab('saved');
    await act(async () => { h.captured.saved!.onEditSavedMeal(recipe); });
    expect(h.captured.review!.draft.name).toBe('Edited shake');
    await h.click('Save changes');
    expect(h.saveMeal).toHaveBeenCalledWith(expect.objectContaining({ name: 'Edited shake' }), 'user-a', expect.objectContaining({ editSavedMealId: recipe.id, editEntryId: undefined }));
    expect(composition.loadMealDraft('user-a', 'saved:recipe')).toBeNull();
  });

  it('still opens a saved recipe from You and saves only that recipe', async () => {
    const h = loggerHarness({ savedMeal: true });
    await h.render();
    await h.click('Save changes');
    expect(h.saveMeal).toHaveBeenCalledWith(expect.anything(), 'user-a', expect.objectContaining({ editSavedMealId: recipe.id, editEntryId: undefined }));
    expect(h.back).toHaveBeenCalledOnce();
  });

  it('edits a simple saved food separately and returns to the untouched entry draft', async () => {
    const h = loggerHarness({ editing: true });
    const oldRead = deferred<{ meals: Food[] }>();
    h.loadSaved.mockReturnValueOnce(oldRead.promise);
    await h.render();
    await act(async () => { h.captured.fields.Name.onChangeText('My milk entry'); });
    await h.tab('saved');
    expect(h.mealsState.meals?.some((food) => food.id === savedMilk.id)).toBe(false);
    await act(async () => { h.captured.saved!.onEditSavedMeal(savedMilk); });
    expect(h.push).toHaveBeenCalledWith({ pathname: '/saved-meal', params: { id: savedMilk.id } });
    expect(h.mealsState.meals?.find((food) => food.id === savedMilk.id)).toEqual(savedMilk);
    expect(h.captured.manual!.draft.fields.name).toBe('My milk entry');
    await h.openSavedEditor();
    await act(async () => { h.captured.fields.Name.onChangeText('Saved milk corrected'); });
    await h.click('Save');
    expect(h.replaceSimple).toHaveBeenCalledWith('user-a', savedMilk.id, expect.objectContaining({ name: 'Saved milk corrected' }));
    expect(h.saveFood).not.toHaveBeenCalled();
    expect(h.saveMeal).not.toHaveBeenCalled();
    expect(h.back).toHaveBeenCalledOnce();
    const reads = h.loadSaved.mock.calls.length;
    await act(async () => { h.captured.focus!(); });
    expect(h.loadSaved).toHaveBeenCalledTimes(reads + 1);
    expect(h.captured.context!.savedMeals?.some((food) => food.name === 'Saved milk corrected')).toBe(true);
    // The read from before editing must not replace the refreshed saved list.
    await act(async () => { oldRead.resolve({ meals: [recipe, savedMilk] }); });
    expect(h.captured.context!.savedMeals?.some((food) => food.name === 'Saved milk corrected')).toBe(true);
    await h.tab('manual');
    expect(h.captured.manual!.draft.fields.name).toBe('My milk entry');
    expect(h.captured.context!.editing).toEqual(loggedMilk);
  });

  it('keeps ordinary saved-food selection as a log-entry replacement, not a saved-food edit', async () => {
    const h = loggerHarness({ editing: true });
    await h.render();
    await act(async () => { h.captured.context!.chooseFood(savedMilk); });
    expect(h.captured.foodReview!.food).toEqual(savedMilk);
    expect(h.captured.context!.editing).toEqual(loggedMilk);
    expect(h.push).not.toHaveBeenCalled();
    expect(h.replaceSimple).not.toHaveBeenCalled();
  });

  it('still uses the logged-entry target when choosing a recipe to replace that entry', async () => {
    const h = loggerHarness({ editing: true });
    await h.render();
    await act(async () => { h.captured.context!.composeMeal(recipe); });
    expect(h.captured.review!.editingEntryId).toBe(loggedMilk.id);
    expect(h.captured.review!.savedTarget).toBeUndefined();
    expect(composition.loadMealDraft('user-a', 'edit:log-milk')?.name).toBe(recipe.name);
    expect(composition.loadMealDraft('user-a', 'new')).toBeNull();
    await h.click('Save changes');
    expect(h.saveMeal).toHaveBeenCalledWith(expect.anything(), 'user-a', expect.objectContaining({ editEntryId: loggedMilk.id, editSavedMealId: undefined }));
    expect(composition.loadMealDraft('user-a', 'edit:log-milk')).toBeNull();
  });

  it('releases an abandoned scan before its response, allowing another input method', async () => {
    const h = loggerHarness();
    await h.render();
    await h.tab('scan');
    await act(async () => { h.captured.fields['Barcode digits'].onChangeText('012345678905'); });
    await h.click('Look up barcode');
    expect(h.captured.buttons['Build a meal'].disabled).toBe(true);
    await h.tab('manual');
    expect(h.captured.scanCurrent!()).toBe(false);
    expect(h.captured.buttons['Build a meal'].disabled).toBe(false);
    expect(h.captured.guard!.on).toBe(false);
    await act(async () => { h.captured.manual!.onGeminiHandoff!('chicken and rice'); });
    expect(h.alert).not.toHaveBeenCalled();
    expect(h.captured.picker!.selection).toBe('photo');
    let release!: () => void;
    await act(async () => { release = h.captured.context!.beginBusy(); });
    await act(async () => { h.lookup.resolve({ status: 'stale' }); });
    expect(h.captured.buttons['Build a meal'].disabled).toBe(true);
    await act(async () => { release(); });
    expect(h.captured.buttons['Build a meal'].disabled).toBe(false);
  });

  it('releases each busy owner once without clearing another owner', async () => {
    const h = loggerHarness();
    await h.render();
    let first!: () => void;
    let second!: () => void;
    await act(async () => { first = h.captured.context!.beginBusy(); second = h.captured.context!.beginBusy(); });
    await act(async () => { first(); first(); });
    expect(h.captured.buttons['Build a meal'].disabled).toBe(true);
    await act(async () => { second(); });
    expect(h.captured.buttons['Build a meal'].disabled).toBe(false);
  });

  it('does not insert an abandoned photo analysis into the next ingredient capture', async () => {
    const h = loggerHarness({ worker: true });
    await h.render();
    await h.click('Build a meal');
    await h.startPhoto();
    await h.tab('manual');
    await act(async () => { h.captured.context!.addIngredients([composition.createMealIngredient(milk, 1)]); });
    await h.tab('photo');
    const successes = h.success.mock.calls.length;
    await act(async () => { h.analysis.resolve(photoResult); });
    expect(h.ground).not.toHaveBeenCalled();
    expect(h.captured.photo!.draft.items).toEqual([]);
    expect(h.captured.photo!.draft.photos).toEqual({});
    expect(h.success).toHaveBeenCalledTimes(successes);
    expect(h.captured.buttons['Review meal'].disabled).toBe(false);
  });

  it('drops a photo result that finishes matching foods after ingredient capture resets', async () => {
    const h = loggerHarness({ worker: true });
    const matching = deferred<photoReview.PhotoReviewItem[]>();
    h.ground.mockReturnValue(matching.promise);
    await h.render();
    await h.click('Build a meal');
    await h.startPhoto();
    await act(async () => { h.analysis.resolve(photoResult); });
    expect(h.ground).toHaveBeenCalledOnce();
    await h.tab('manual');
    await act(async () => { h.captured.context!.addIngredients([composition.createMealIngredient(milk, 1)]); });
    await h.tab('photo');
    await act(async () => { matching.resolve([photoItem]); });
    expect(h.captured.photo!.draft.items).toEqual([]);
    expect(h.success).toHaveBeenCalledOnce(); // Adding the manual ingredient only.
  });

  it('keeps background photo analysis busy and returns its result after a normal tab switch', async () => {
    const h = loggerHarness({ worker: true });
    await h.render();
    await h.startPhoto();
    await h.tab('manual');
    expect(h.captured.buttons['Build a meal'].disabled).toBe(true);
    await act(async () => { h.analysis.resolve(photoResult); });
    expect(h.captured.buttons['Build a meal'].disabled).toBe(false);
    await h.tab('photo');
    expect(h.captured.photo!.draft.items).toEqual([photoItem]);
    expect(h.captured.photo!.draft.summary).toBe('Fresh plate');
    expect(h.success).toHaveBeenCalledOnce();
  });

  it('drops a photo analysis error after the sheet really closes', async () => {
    const h = loggerHarness({ worker: true });
    await h.render();
    await h.startPhoto();
    await h.close();
    await act(async () => { h.analysis.reject(new Error('old request failed')); });
    expect(h.error).not.toHaveBeenCalled();
  });

  it('does not start photo analysis if token acquisition finishes after the sheet closes', async () => {
    const h = loggerHarness({ worker: true });
    const access = deferred<string>();
    h.token.mockReturnValue(access.promise);
    await h.render();
    await h.startPhoto();
    expect(h.analyze).not.toHaveBeenCalled();
    await h.close();
    await act(async () => { access.resolve('test'); });
    expect(h.analyze).not.toHaveBeenCalled();
  });
});
