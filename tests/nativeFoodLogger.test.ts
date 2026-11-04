// @vitest-environment happy-dom
import * as dates from 'date-fns';
import { act, createContext, createElement, Fragment, useContext, useEffect, type ComponentType, type PropsWithChildren } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as zustand from 'zustand';

import * as barcodes from '@/lib/barcodes';
import * as composition from '@/lib/mealComposition';
import * as pendingEntry from '@/lib/pendingEntryId';
import * as photoReview from '@/lib/photoReview';
import * as requestGate from '@/lib/requestGate';
import { assertComposedMealOptions } from '@/lib/saveMealComposition';
import { foodValuesMatch, savedMealSuggestions } from '@/lib/savedMeals';
import * as timeout from '@/lib/withTimeout';
import type { Food } from '@/types';
import type * as LaunchActions from '../native/src/lib/launchActions';
import { loadNativeModule } from './helpers/loadNativeModule';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The real press store, on this React (native/'s zustand would bring its own copy).
const launchActions = loadNativeModule<typeof LaunchActions>('lib/launchActions.ts', { zustand });

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
type Context = { beginBusy: () => () => void; beginRead: () => () => void; addIngredients: (parts: composition.MealIngredient[]) => void; composeMeal: (food: Food) => void; chooseFood: (food: Food) => void; editing: unknown; savedMeals: Food[] | null; selectedKey: string; when: { time: string; groupId: string | null } };
type ReviewProps = {
  draft: composition.MealDraft;
  savedTarget?: Food;
  editingEntryId?: string;
  update: (patch: Partial<composition.MealDraft>) => void;
};
type ManualProps = { draft: { fields: { name: string } }; onGeminiHandoff?: (description: string) => void };
type PhotoDraft = { photos: Record<string, unknown>; items: photoReview.PhotoReviewItem[]; summary: string };
type PhotoProps = { draft: PhotoDraft; setDraft: (update: (draft: PhotoDraft) => PhotoDraft) => void; cameraRequest?: number };
type AiDraft = { hint: string; photos: unknown[]; result: unknown };
type AiProps = { cameraRequest?: number; draft: AiDraft; setDraft: (update: (draft: AiDraft) => AiDraft) => void };
type Press = { accessibilityLabel?: string; children?: unknown; onPress?: () => void };
type Input = { accessibilityLabel?: string; onChangeText: (text: string) => void };
type Choices = { options: { options: string[] }; callback: (index: number) => Promise<void> | void };
type Asset = { uri: string; width: number; height: number; type: string };
type PickerResult = { canceled: boolean; assets: Asset[] };
type NativeModule = Record<string, unknown>;

/** A pressable's name for VoiceOver, or the words it shows. */
const textOf = (node: unknown): string =>
  typeof node === 'string' || typeof node === 'number'
    ? String(node)
    : Array.isArray(node)
      ? node.map(textOf).join('')
      : node && typeof node === 'object' && 'props' in node
        ? textOf((node as { props: { children?: unknown } }).props.children)
        : '';

const active: Array<() => Promise<void>> = [];
beforeEach(() => {
  launchActions.useLaunchStore.setState({ press: null, held: true, cameraAsks: 0, openingAt: 0 });
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
function loggerHarness({ editing = false, worker = false, savedMeal = false, params = {}, device = true, clockGroup = null }: {
  editing?: boolean;
  worker?: boolean;
  savedMeal?: boolean;
  params?: Record<string, string | undefined>;
  /** False is the simulator: no camera. */
  device?: boolean;
  /** The meal the clock picks for a new entry today. */
  clockGroup?: string | null;
} = {}) {
  const captured: {
    buttons: Record<string, Button>;
    fields: Record<string, Field>;
    picker?: { selection: string; onSelectionChange: (tab: string) => void };
    saved?: { onEditSavedMeal: (food: Food) => void };
    review?: ReviewProps;
    foodReview?: { food: Food };
    manual?: ManualProps;
    photo?: PhotoProps;
    ai?: AiProps;
    context?: Context;
    scanCurrent?: () => boolean;
    guard?: { on: boolean; message: { title: string } };
    focus?: () => void;
    pressables: Record<string, Press>;
    inputs: Record<string, Input>;
    choices?: Choices;
  } = { buttons: {}, fields: {}, pressables: {}, inputs: {} };
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
  // The sheet's own navigation: its opening transition, sent by appear().
  const listeners: Record<string, (event: { data: { closing: boolean } }) => void> = {};
  const navigation = { addListener: (type: string, callback: (event: { data: { closing: boolean } }) => void) => { listeners[type] = callback; return noop; } };
  const appear = (closing = false) => act(async () => { listeners.transitionEnd?.({ data: { closing } }); });
  const refusePress = vi.fn();
  const announce = vi.fn();
  const when = vi.fn((): { date: Date; time: string; groupId: string | null } => ({ date: new Date('2026-11-03T10:00:00'), time: '10:00', groupId: null }));
  const camera = vi.fn(async (): Promise<PickerResult> => ({ canceled: false, assets: [{ uri: 'cam', width: 10, height: 10, type: 'image' }] }));
  const permission = vi.fn(async () => ({ granted: true }));
  const imagePicker = { requestCameraPermissionsAsync: permission, launchCameraAsync: camera, launchImageLibraryAsync: vi.fn() };
  const openSettings = vi.fn();
  const fuel = { logs: [loggedMilk], groups: [], refresh: noop };
  const useFuelStore = Object.assign((select: (state: typeof fuel) => unknown) => select(fuel), { getState: () => fuel });
  const imports: Record<string, unknown> = {
    'date-fns': dates,
    '@expo/ui/swift-ui': { Host: Wrap, Picker: (props: NonNullable<typeof captured.picker> & PropsWithChildren) => { captured.picker = props; return Wrap(props); }, Text: Wrap },
    '@expo/ui/swift-ui/modifiers': { pickerStyle: noop, tag: noop },
    'expo-router': {
      router: { back, push },
      useLocalSearchParams: () => ({ ...(editing ? { entry: loggedMilk.id } : savedMeal ? { savedMeal: recipe.id } : {}), ...params }),
      useNavigation: () => navigation,
      useFocusEffect: (callback: () => void) => {
        captured.focus = callback;
        useEffect(() => { callback(); }, [callback]);
      },
    },
    'expo-symbols': { SymbolView: Empty },
    'expo-image': { Image: Empty },
    'expo-image-manipulator': {},
    'expo-image-picker': imagePicker,
    'expo-device': { isDevice: device },
    'react-native': {
      AccessibilityInfo: { announceForAccessibility: noop, announceForAccessibilityWithOptions: announce },
      ActionSheetIOS: { showActionSheetWithOptions: (options: Choices['options'], callback: Choices['callback']) => { captured.choices = { options, callback }; } },
      Alert: { alert },
      Pressable: (props: PropsWithChildren<Press>) => {
        captured.pressables[props.accessibilityLabel ?? textOf(props.children)] = props;
        return Wrap(props);
      },
      View: Wrap,
      ScrollView: Wrap,
      TextInput: (props: Input) => {
        if (props.accessibilityLabel) captured.inputs[props.accessibilityLabel] = props;
        return null;
      },
      Keyboard: { dismiss: noop },
      ActivityIndicator: Empty,
      Linking: { openSettings },
      Image: {},
    },
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
    '~/lib/format': { formatWhole: String },
    '~/lib/foodLogger': { initialWhen: when, usesDayGroups: () => true, timeAsDate: () => new Date(), workerAccessToken: token, saveFoodEntry: saveFood },
    '~/lib/fuel': { groupsForDay: () => [], loadDayGroups: async () => [], suggestedGroup: () => (clockGroup ? { id: clockGroup } : null), today: () => '2026-11-03', useTodayKey: () => '2026-11-03', useFuelStore },
    '~/lib/haptics': { haptics: { tap: noop, select: noop, success, error } },
    '~/lib/launchActions': launchActions,
    '~/lib/launch': { refusePress },
    '~/lib/leaveGuard': { useLeaveGuard: (on: boolean, message: { title: string }) => { captured.guard = { on, message }; } },
    '~/lib/you': { loadYouMeals: loadYou, useYouMealsStore },
    '~/lib/motion': {},
    '~/platform/previewFlag': { isPreviewActive: () => true },
    '~/fuel/context': { LoggerContext: ContextProvider },
    './context': { useLogger },
    './WhenBlock': { WhenBlock: Empty },
    '~/fuel/FoodLists': { Empty: ({ text }: { text: string }) => text, SearchTab: Empty, SavedTab: (props: NonNullable<typeof captured.saved>) => { captured.saved = props; return null; } },
    '~/fuel/FoodReview': { FoodReview: (props: { food: Food }) => { captured.foodReview = props; return null; } },
    '~/fuel/RecentTab': { RecentTab: Empty },
    '~/fuel/AiTab': {
      emptyAi: () => ({ hint: '', answer: '', photos: [], result: null, items: [] }),
      aiHasDraft: (draft: { hint: string; photos: unknown[]; result: unknown }) => Boolean(draft.hint) || draft.photos.length > 0 || draft.result !== null,
      aiTakesPhoto: (draft: { photos: unknown[]; result: unknown }) => draft.result === null && draft.photos.length < 2,
      AiTab: (props: AiProps) => { captured.ai = props; return createElement(Probe); },
    },
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
  let container: HTMLDivElement | undefined;
  const close = async () => { await act(async () => { root?.unmount(); root = undefined; }); };
  active.push(close);
  const render = async () => {
    captured.review = undefined;
    captured.manual = undefined;
    container = document.createElement('div');
    root = createRoot(container);
    await act(async () => { root!.render(createElement(Sheet)); });
  };
  /** The words on the sheet (lines and notes; Capsules and Rows are recorded instead). */
  const text = () => container?.textContent ?? '';
  const press = async (name: string) => {
    expect(captured.pressables[name]).toBeDefined();
    await act(async () => { captured.pressables[name].onPress!(); });
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
  // Snap a meal pressed while this sheet is on top (lib/launch.ts hands it over).
  const ask = () => act(async () => { launchActions.askLoggerCamera(); });
  return { captured, imports, render, close, tab, click, press, text, startPhoto, openSavedEditor, appear, ask, lookup, analysis, analyze, token, ground, alert, success, error, saveMeal, saveFood, resolveFood, replaceSimple, loadSaved, mealsState, back, push, refusePress, announce, when, camera, permission, openSettings };
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

  it('closes freely while a Search result’s portion read runs, and holds for an analysis', async () => {
    const h = loggerHarness();
    await h.render();
    let read!: () => void;
    await act(async () => { read = h.captured.context!.beginRead(); });
    // Nothing is lost by closing during a read: no question, and Build a meal stays open.
    expect(h.captured.guard!.on).toBe(false);
    expect(h.captured.buttons['Build a meal'].disabled).toBe(false);
    await act(async () => { read(); read(); });
    let busy!: () => void;
    await act(async () => { busy = h.captured.context!.beginBusy(); });
    expect(h.captured.guard).toEqual({ on: true, message: { title: 'Stop the analysis?', message: 'The result is lost if you close now.' } });
    await act(async () => { busy(); });
    expect(h.captured.guard!.on).toBe(false);
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

// Snap a meal (lib/launch.ts): a press opens Log food with start=camera, or
// asks an open sheet, which answers through sheetSnap.
describe('native food logger: Snap a meal', () => {
  const settle = () => act(async () => { for (let tick = 0; tick < 20; tick += 1) await Promise.resolve(); });

  it('opens on AI and asks for the camera only once the sheet has slid up', async () => {
    const h = loggerHarness({ params: { start: 'camera' } });
    await h.render();
    expect(h.captured.picker!.selection).toBe('photo');
    expect(h.captured.ai!.cameraRequest).toBe(0);
    await h.appear(true);
    expect(h.captured.ai!.cameraRequest).toBe(0);
    await h.appear();
    expect(h.captured.ai!.cameraRequest).toBe(1);
    await h.appear();
    expect(h.captured.ai!.cameraRequest).toBe(1);
  });

  it('keeps a meal from last time under Resume pending meal and still opens the camera', async () => {
    composition.saveMealDraft('user-a', {
      name: 'Lunch', ingredients: [composition.createMealIngredient(milk, 1, 'kept-milk')], date: '2026-11-03', time: '12:00',
      groupId: null, method: 'barcode', entryId: '00000000-0000-4000-8000-000000000001', saveAsReusableMeal: false, locked: false,
    }, 'new');
    const h = loggerHarness({ params: { start: 'camera' } });
    await h.render();
    expect(h.captured.buttons['Resume pending meal']).toBeDefined();
    expect(h.captured.review).toBeUndefined();
    await h.appear();
    expect(h.captured.ai!.cameraRequest).toBe(1);
  });

  it('switches an open sheet for today to AI, resets When to now and asks for the camera', async () => {
    const h = loggerHarness();
    await h.render();
    await h.appear();
    expect(h.captured.picker!.selection).toBe('recent');
    expect(h.when).toHaveBeenCalledTimes(1);
    await h.ask();
    expect(h.captured.picker!.selection).toBe('photo');
    expect(h.captured.ai!.cameraRequest).toBe(1);
    expect(h.when).toHaveBeenCalledTimes(2);
    expect(h.when).toHaveBeenLastCalledWith(null, '2026-11-03', [], null);
    expect(h.refusePress).not.toHaveBeenCalled();
  });

  it('waits for the sheet to appear when asked during its slide', async () => {
    const h = loggerHarness();
    await h.render();
    await h.ask();
    expect(h.captured.picker!.selection).toBe('photo');
    expect(h.captured.ai!.cameraRequest).toBe(0);
    await h.appear();
    expect(h.captured.ai!.cameraRequest).toBe(1);
  });

  it.each<{ day?: string; group?: string }>([{ day: '2026-11-02' }, { group: 'g1' }])('starts over for now when a sheet holding nothing was opened with %o', async (params) => {
    const h = loggerHarness({ params });
    await h.render();
    await h.appear();
    expect(h.when).toHaveBeenLastCalledWith(null, params.day ?? '2026-11-03', [], params.group ?? null);
    const reads = h.loadSaved.mock.calls.length;
    await h.ask();
    // a fresh session (it reads Saved again as it mounts): today, no meal param, straight into the camera
    expect(h.loadSaved).toHaveBeenCalledTimes(reads + 1);
    expect(h.captured.context!.selectedKey).toBe('2026-11-03');
    expect(h.when).toHaveBeenCalledTimes(2);
    expect(h.when).toHaveBeenLastCalledWith(null, '2026-11-03', [], null);
    expect(h.captured.picker!.selection).toBe('photo');
    expect(h.captured.ai!.cameraRequest).toBe(1);
    expect(h.refusePress).not.toHaveBeenCalled();
  });

  it('refuses while typed Manual fields would be lost, and changes nothing', async () => {
    const h = loggerHarness();
    await h.render();
    await h.appear();
    await h.tab('manual');
    await act(async () => { h.captured.fields.Name.onChangeText('Toast'); });
    await h.ask();
    expect(h.refusePress).toHaveBeenCalledOnce();
    expect(h.captured.picker!.selection).toBe('manual');
    expect(h.captured.ai!.cameraRequest).toBe(0);
    expect(h.captured.manual!.draft.fields.name).toBe('Toast');
  });

  it('refuses while an entry is edited or a food is under review', async () => {
    const edit = loggerHarness({ editing: true });
    await edit.render();
    await edit.appear();
    await edit.ask();
    expect(edit.refusePress).toHaveBeenCalledOnce();
    expect(edit.captured.picker!.selection).toBe('manual');
    await edit.close();

    const review = loggerHarness();
    await review.render();
    await review.appear();
    await act(async () => { review.captured.context!.chooseFood(milk); });
    await review.ask();
    expect(review.refusePress).toHaveBeenCalledOnce();
    expect(review.captured.foodReview!.food).toEqual(milk);
  });

  it('does nothing at all while the camera or library is already up', async () => {
    const h = loggerHarness();
    const shot = deferred<PickerResult>();
    h.camera.mockReturnValueOnce(shot.promise);
    await h.render();
    await h.appear();
    const { pickFoodPhoto } = h.imports['~/fuel/PhotoTab'] as { pickFoodPhoto: (source: 'camera' | 'library') => Promise<unknown> };
    let picking!: Promise<unknown>;
    await act(async () => { picking = pickFoodPhoto('camera'); });
    await h.ask();
    expect(h.refusePress).not.toHaveBeenCalled();
    expect(h.captured.picker!.selection).toBe('recent');
    expect(h.captured.ai!.cameraRequest).toBe(0);
    await act(async () => { shot.resolve({ canceled: true, assets: [] }); await picking; });
  });

  it('takes the photo on the worker’s Photo tab and analyzes it without a tap', async () => {
    const h = loggerHarness({ worker: true, params: { start: 'camera' } });
    await h.render();
    expect(h.captured.picker!.selection).toBe('photo');
    expect(h.camera).not.toHaveBeenCalled();
    await h.appear();
    await settle();
    expect(h.camera).toHaveBeenCalledOnce();
    expect(h.captured.photo!.draft.photos).toEqual({ top: { uri: 'cam', width: 10, height: 10 } });
    expect(h.analyze).toHaveBeenCalledOnce();
    expect(h.announce).toHaveBeenCalledWith('Analyzing meal', { queue: true });
    await act(async () => { h.analysis.resolve(photoResult); });
    await settle();
    expect(h.captured.photo!.draft.items).toEqual([photoItem]);
    expect(h.captured.buttons['Log 1 item']).toBeDefined();
  });

  it('adds the photo to a description typed on AI, logged now to the meal the clock picks', async () => {
    const h = loggerHarness({ clockGroup: 'g-lunch' });
    await h.render();
    await h.appear();
    await h.tab('photo');
    await act(async () => { h.captured.ai!.setDraft((draft) => ({ ...draft, hint: 'Two eggs on toast' })); });
    expect(h.captured.guard!.on).toBe(true);
    h.when.mockReturnValueOnce({ date: new Date('2026-11-03T12:34:00'), time: '12:34', groupId: 'g-lunch' });
    await h.ask();
    expect(h.refusePress).not.toHaveBeenCalled();
    expect(h.when).toHaveBeenLastCalledWith(null, '2026-11-03', [], 'g-lunch');
    expect(h.captured.context!.when).toMatchObject({ time: '12:34', groupId: 'g-lunch' });
    expect(h.captured.ai!.cameraRequest).toBe(1);
    expect(h.captured.ai!.draft.hint).toBe('Two eggs on toast');
  });

  type Harness = ReturnType<typeof loggerHarness>;
  it.each<[string, (h: Harness) => Promise<unknown>]>([
    ['an estimate waiting', async (h) => {
      await h.tab('photo');
      await act(async () => { h.captured.ai!.setDraft((draft) => ({ ...draft, result: { items: [], summary: 'Eggs' } })); });
    }],
    ['the Scan tab open', (h) => h.tab('scan')],
    ['a lookup running', (h) => act(async () => { h.captured.context!.beginBusy(); })],
    ['a Search result’s portion read running', (h) => act(async () => { h.captured.context!.beginRead(); })],
    ['a meal being built', (h) => h.click('Build a meal')],
  ])('refuses with %s, and changes nothing', async (_case, setup) => {
    const h = loggerHarness();
    await h.render();
    await h.appear();
    await setup(h);
    const selection = h.captured.picker!.selection;
    await h.ask();
    expect(h.refusePress).toHaveBeenCalledOnce();
    expect(h.captured.picker!.selection).toBe(selection);
    expect(h.captured.ai!.cameraRequest).toBe(0);
  });

  it('refuses while a description typed in Manual’s Describe with AI would be lost', async () => {
    const h = loggerHarness();
    await h.render();
    await h.appear();
    await h.tab('manual');
    await h.press('Describe a meal or food');
    await act(async () => { h.captured.inputs['Describe the food'].onChangeText('two eggs and toast'); });
    await h.ask();
    expect(h.refusePress).toHaveBeenCalledOnce();
    expect(h.captured.picker!.selection).toBe('manual');
    expect(h.captured.ai!.cameraRequest).toBe(0);
    // cleared again, the sheet holds nothing and takes the press
    await act(async () => { h.captured.inputs['Describe the food'].onChangeText(' '); });
    await h.ask();
    expect(h.refusePress).toHaveBeenCalledOnce();
    expect(h.captured.picker!.selection).toBe('photo');
    expect(h.captured.ai!.cameraRequest).toBe(1);
  });

  it('starts over when asked before the sheet has appeared, and opens the camera once it has', async () => {
    const h = loggerHarness({ params: { day: '2026-11-02' } });
    await h.render();
    await h.ask();
    expect(h.refusePress).not.toHaveBeenCalled();
    expect(h.captured.context!.selectedKey).toBe('2026-11-03');
    expect(h.captured.picker!.selection).toBe('photo');
    expect(h.captured.ai!.cameraRequest).toBe(0);
    await h.appear();
    expect(h.captured.ai!.cameraRequest).toBe(1);
  });

  it('refuses over a Save as meal sheet whose foods are gone', async () => {
    const h = loggerHarness({ params: { saveEntries: 'gone' } });
    await h.render();
    expect(h.text()).toContain('Those foods are no longer in your log.');
    await h.ask();
    expect(h.refusePress).toHaveBeenCalledOnce();
  });

  it('leaves Add photo’s choices alone, then takes the press once they are answered', async () => {
    const settleAll = () => act(async () => { for (let tick = 0; tick < 20; tick += 1) await Promise.resolve(); });
    const h = loggerHarness({ worker: true });
    await h.render();
    await h.appear();
    await h.tab('photo');
    await h.press('Add top view photo');
    expect(h.captured.choices!.options.options).toEqual(['Take photo', 'Choose from library', 'Cancel']);
    await h.ask();
    expect(h.refusePress).not.toHaveBeenCalled();
    expect(h.captured.photo!.cameraRequest).toBe(0);
    expect(h.camera).not.toHaveBeenCalled();
    await act(async () => { await h.captured.choices!.callback(2); });
    await h.ask();
    await settleAll();
    expect(h.captured.photo!.cameraRequest).toBe(1);
    expect(h.camera).toHaveBeenCalledOnce();
    expect(h.analyze).toHaveBeenCalledOnce();
  });

  // The real shared picker (PhotoTab's pickFoodPhoto) behind a snap on the worker's Photo tab.
  it('says the camera isn’t available on the simulator, without opening one', async () => {
    const h = loggerHarness({ worker: true, device: false, params: { start: 'camera' } });
    await h.render();
    await h.appear();
    await settle();
    expect(h.permission).not.toHaveBeenCalled();
    expect(h.camera).not.toHaveBeenCalled();
    expect(h.text()).toContain('The camera isn’t available here.');
    expect(h.captured.buttons['Open Settings']).toBeUndefined();
    expect(h.analyze).not.toHaveBeenCalled();
  });

  it('says camera access is off, with Open Settings, when it was refused', async () => {
    const h = loggerHarness({ worker: true, params: { start: 'camera' } });
    h.permission.mockResolvedValueOnce({ granted: false });
    await h.render();
    await h.appear();
    await settle();
    expect(h.camera).not.toHaveBeenCalled();
    expect(h.text()).toContain('Camera access is off. Allow Camera for hyPer in Settings, then try again.');
    await h.click('Open Settings');
    expect(h.openSettings).toHaveBeenCalledOnce();
    expect(h.analyze).not.toHaveBeenCalled();
    const { foodPickerUp } = h.imports['~/fuel/PhotoTab'] as { foodPickerUp: () => boolean };
    expect(foodPickerUp()).toBe(false);
  });

  it('turns away a video from the camera', async () => {
    const h = loggerHarness({ worker: true, params: { start: 'camera' } });
    h.camera.mockResolvedValueOnce({ canceled: false, assets: [{ uri: 'clip', width: 10, height: 10, type: 'video' }] });
    await h.render();
    await h.appear();
    await settle();
    expect(h.text()).toContain('Please choose an image file.');
    expect(h.captured.photo!.draft.photos).toEqual({});
    expect(h.analyze).not.toHaveBeenCalled();
  });
});
