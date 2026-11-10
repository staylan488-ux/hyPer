// @vitest-environment happy-dom
import * as dates from 'date-fns';
import { act, Children, createContext, createElement, Fragment, isValidElement, useCallback, useContext, useEffect, useState, type ComponentType, type PropsWithChildren, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as zustand from 'zustand';

import * as analysisProgress from '@/lib/analysisProgress';
import * as barcodes from '@/lib/barcodes';
import * as decimalText from '@/lib/decimalText';
import * as foodTrial from '@/lib/foodTrial';
import * as foodTrialReview from '@/lib/foodTrialReview';
import * as foodUnits from '@/lib/foodUnits';
import * as loggerUtils from '@/lib/foodLoggerUtils';
import { mealForTime } from '../native/src/lib/meals';
import * as composition from '@/lib/mealComposition';
import * as pendingEntry from '@/lib/pendingEntryId';
import * as recentFoods from '@/lib/recentFoods';
import { usualAmountInput } from '@/lib/recentFoods';
import * as nutritionLedger from '@/lib/nutritionLedger';
import * as nutritionMacros from '@/lib/nutritionMacros';
import * as saveNutrition from '@/lib/saveNutritionEntry';
import * as photoReview from '@/lib/photoReview';
import * as requestGate from '@/lib/requestGate';
import { assertComposedMealOptions } from '@/lib/saveMealComposition';
import { filterSavedMeals, foodValuesMatch, savedMealSuggestions } from '@/lib/savedMeals';
import * as timeout from '@/lib/withTimeout';
import * as groupRules from '@/lib/nutritionGroups';
import type { Food, NutritionGroup } from '@/types';
import type * as LaunchActions from '../native/src/lib/launchActions';
import { loadNativeModule } from './helpers/loadNativeModule';
import { nativeFuelStore } from './helpers/nativeFuelStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The real press store, on this React (native/'s zustand would bring its own copy).
const launchActions = loadNativeModule<typeof LaunchActions>('lib/launchActions.ts', { zustand });

const Wrap = ({ children }: PropsWithChildren) => createElement(Fragment, null, children);
/** The words a pressable shows, to find it the way a person would. */
const textOf = (node: ReactNode): string =>
  typeof node === 'string' || typeof node === 'number'
    ? String(node)
    : Array.isArray(node)
      ? node.map(textOf).join('')
      : isValidElement<PropsWithChildren>(node) ? textOf(node.props.children) : '';
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
const loggedMilk = { id: 'log-milk', date: '2026-11-03', food_id: milk.id, food: milk, servings: 1, logged_at: '2026-11-03T17:00:00Z', group_id: null as string | null, source: 'barcode' as const };
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
type Field = { label: string; value?: string; onChangeText: (text: string) => void; onSubmitEditing?: () => void };
type Press = {
  children?: ReactNode | ((state: { pressed: boolean }) => ReactNode);
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityValue?: { text?: string };
  disabled?: boolean;
  accessibilityActions?: Array<{ name: string; label: string }>;
  onAccessibilityAction?: (event: { nativeEvent: { actionName: string } }) => void;
};
type SwipeAction = { label: string; destructive?: boolean; onPress: () => void };
type SectionProps = PropsWithChildren<{ title: string; action?: { title: string; onPress: () => void } }>;
type AlertButton = { text: string; onPress?: () => void };
type Input = { accessibilityLabel?: string; value?: string; editable?: boolean; onChangeText?: (text: string) => void; onFocus?: () => void };
type Context = { beginBusy: () => () => void; beginRead: () => () => void; beginSave: () => () => void; addIngredients: (parts: composition.MealIngredient[]) => void; composeMeal: (food: Food) => void; chooseFood: (food: Food) => void; editing: unknown; savedMeals: Food[] | null; selectedKey: string; when: { time: string; groupId: string | null }; setWhen: (next: { date: Date; time: string; groupId: string | null }) => void };
type ReviewProps = {
  draft: composition.MealDraft;
  savedTarget?: Food;
  editingEntryId?: string;
  update: (patch: Partial<composition.MealDraft>) => void;
};
type ManualDraft = { fields: Record<'name' | 'calories' | 'protein' | 'carbs' | 'fat', string>; selectedSavedMealId: string | null };
type ManualProps = { draft: ManualDraft; setDraft: (update: (draft: ManualDraft) => ManualDraft) => void; onGeminiHandoff?: (description: string) => void };
type PhotoDraft = { photos: Record<string, unknown>; items: photoReview.PhotoReviewItem[]; summary: string };
type PhotoProps = { draft: PhotoDraft; setDraft: (update: (draft: PhotoDraft) => PhotoDraft) => void; cameraRequest?: number };
type AiDraft = { hint: string; photos: unknown[]; result: unknown; items: Array<foodTrial.TrialFoodItem & { key: string }> };
type AiProps = { cameraRequest?: number; addPhotoRequest?: number; focusRequest?: number; draft: AiDraft; setDraft: (update: (draft: AiDraft) => AiDraft) => void };
type Choices = { options: { options: string[] }; callback: (index: number) => Promise<void> | void };
type Asset = { uri: string; width: number; height: number; type: string };
type PickerResult = { canceled: boolean; assets: Asset[] };
/** Camera access as expo-camera reports it. */
type Access = { granted: boolean; status: 'granted' | 'denied' | 'undetermined'; canAskAgain: boolean };
type Picture = { uri: string; width: number; height: number };
type Viewfinder = { ref?: { current: unknown }; active?: boolean; flash?: string; onCameraReady?: () => void; onMountError?: () => void };
type NativeModule = Record<string, unknown>;

const active: Array<() => Promise<void>> = [];
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-03T10:00:00'));
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
  vi.useRealTimers();
});

/** Real sheet, Manual, Scan, Photo and meal-review components; only view/device/data boundaries are mocked. */
/** What Fuel's close-the-gap card hands Log food to review (context.ts offerReview). */
let reviewHandoff: { food: Food; servings: number } | null = null;

function loggerHarness({ editing = false, entry = loggedMilk, worker = false, savedMeal = false, params = {}, device = true, clockGroup = null, realReview = false, realAi = false, realLists = false, realClock = false, fuelActions, readRecent, dayGroups = [], fuelDay = '2026-11-03', sameDay = true, large = false, rowActions = false }: {
  editing?: boolean;
  entry?: typeof loggedMilk;
  worker?: boolean;
  savedMeal?: boolean;
  params?: Record<string, string | undefined>;
  /** False is the simulator: no camera. */
  device?: boolean;
  /** The meal the clock picks for a new entry today. */
  clockGroup?: string | null;
  /** The real FoodReview instead of a stand-in. */
  realReview?: boolean;
  /** The real AI tab instead of a stand-in. */
  realAi?: boolean;
  /** The real Recent, Saved and Search lists, saving through the real food logger. */
  realLists?: boolean;
  /** Runs the real Recent cache against this data-read boundary. */
  readRecent?: typeof recentFoods.loadRecentLogs;
  realClock?: boolean;
  fuelActions?: { refresh: () => Promise<void>; refreshAfterWrite: () => Promise<void>; invalidateTotals: () => void; deleteEntry?: (id: string) => Promise<boolean> };
  /** The day's meals as Fuel's store holds them. */
  dayGroups?: NutritionGroup[];
  /** The day Fuel shows, where its addGroup makes a meal. */
  fuelDay?: string;
  /** False: When's date has left the sheet's day, so its meals don't apply. */
  sameDay?: boolean;
  /** The accessibility text sizes. */
  large?: boolean;
  /** Rows offer their swipe and hold actions to VoiceOver: SwipeRow hands its actions to the row inside, and the real HoldMenu names the menu's. */
  rowActions?: boolean;
} = {}) {
  const captured: {
    buttons: Record<string, Button>;
    fields: Record<string, Field>;
    inputs: Record<string, Input>;
    pressables: Record<string, Press>;
    sections: Record<string, SectionProps>;
    /** Switches drawn, by label. */
    toggles: Record<string, { label: string; value: boolean }>;
    /** The tab on screen, across the segmented lists and the entry methods; a change goes to whichever holds the name. */
    picker?: { selection: string; onSelectionChange: (tab: string) => void; disabled?: boolean };
    /** Recent | Saved | Search, as drawn. */
    segments?: { selection: string; onSelectionChange: (tab: string) => void; disabled?: boolean; tags: string[] };
    /** Scan, Manual and Describe/Photo, as drawn. */
    methods?: { selected: string | null; gemini: boolean; photoWaiting: boolean; disabled: boolean; onSelect: (method: string) => void };
    saved?: { onEditSavedMeal: (food: Food) => void };
    review?: ReviewProps;
    foodReview?: { food: Food; onChangeFood?: () => void };
    manual?: ManualProps;
    photo?: PhotoProps;
    ai?: AiProps;
    context?: Context;
    scanCurrent?: () => boolean;
    guard?: { on: boolean; message: { title: string }; busy?: boolean };
    focus?: () => void;
    choices?: Choices;
    /** The camera screen's live preview, while it shows one. */
    viewfinder?: Viewfinder;
    /** Search's results, for the words in the field. */
    search?: { query: string };
    /** The sheet's scroll view as last drawn: its children and which of them stay pinned. */
    scroll?: PropsWithChildren<{ stickyHeaderIndices?: number[]; bottomOffset?: number }>;
  } = { buttons: {}, fields: {}, inputs: {}, pressables: {}, sections: {}, toggles: {} };
  Object.defineProperty(captured, 'picker', {
    get: () => {
      const { segments, methods } = captured;
      if (!segments) return undefined;
      return {
        selection: methods?.selected ?? segments.selection,
        // Both hold still together while a save runs.
        disabled: Boolean(segments.disabled) && (!methods || methods.disabled),
        onSelectionChange: (name: string) => {
          if (segments.tags.includes(name)) segments.onSelectionChange(name);
          // A disabled method button takes no press.
          else if (!methods!.disabled) methods!.onSelect(name);
        },
      };
    },
  });
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
  const tap = vi.fn();
  const success = vi.fn();
  const error = vi.fn();
  const saveMeal = vi.fn(async () => {});
  const resolveDestination = vi.fn(async (groupId: string | null) => ({ groupId, mealType: groupId ? 'lunch' as const : null }));
  const saveFood = vi.fn(async () => {});
  const entries = new Map<string, unknown>();
  const persistEntry = vi.fn(async (payload: unknown, _editingId?: string, retryId?: string) => {
    if (!retryId) throw new Error('Quick-add must use a retry ID');
    entries.set(retryId, payload);
  });
  const ensureFood = vi.fn(async () => 'food-row');
  const retire = vi.fn(async (): Promise<{ error: unknown }> => ({ error: null }));
  const resolveFood = vi.fn(async () => ({ foodId: savedMilk.id }));
  let savedFoods = [recipe, savedMilk];
  const mealsState: { meals: Food[] | null } = { meals: [recipe] };
  const useYouMealsStore = {
    getState: () => mealsState,
    setState: (update: (state: typeof mealsState) => Partial<typeof mealsState>) => Object.assign(mealsState, update(mealsState)),
  };
  const loadSaved = vi.fn(async () => ({ meals: savedFoods }));
  const loadYou = vi.fn(async () => { mealsState.meals = savedFoods; });
  type Replaced = { id: string | null; retireFailed: boolean };
  const replaceSimple = vi.fn(async (_userId: string, id: string, values: Pick<Food, 'name' | 'calories' | 'protein' | 'carbs' | 'fat'>): Promise<Replaced> => {
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
  // The camera screen (app/food-camera.tsx): pushed over the sheet as its own root, gone again on back.
  const shutter = vi.fn(async (): Promise<Picture> => ({ uri: 'cam', width: 10, height: 10 }));
  const readAccess = vi.fn(async (): Promise<Access> => ({ granted: true, status: 'granted', canAskAgain: true }));
  const permission = vi.fn(async (): Promise<Access> => ({ granted: true, status: 'granted', canAskAgain: true }));
  const library = vi.fn(async (): Promise<PickerResult> => ({ canceled: false, assets: [{ uri: 'lib', width: 12, height: 9, type: 'image' }] }));
  const imagePicker = { launchImageLibraryAsync: library };
  let cameraRoot: Root | null = null;
  let cameraHost: HTMLDivElement | null = null;
  const closeCameraRoot = () => {
    cameraRoot?.unmount();
    cameraRoot = null;
    captured.viewfinder = undefined;
  };
  const openCamera = vi.fn<(route: string) => void>(() => {
    cameraHost = document.createElement('div');
    cameraRoot = createRoot(cameraHost);
    cameraRoot.render(createElement(FoodCamera));
  });
  const cameraBack = vi.fn(closeCameraRoot);
  const openSettings = vi.fn();
  const dismissKeyboard = vi.fn();
  // Fuel's addGroup: a new unlabelled meal or snack on the day Fuel shows, or a failure.
  const addGroup = vi.fn(async (kind: 'meal' | 'snack'): Promise<NutritionGroup | null> => {
    const group: NutritionGroup = { id: `new-${kind}`, user_id: 'user-a', date: fuel.selected, kind, label: null, sort_order: fuel.groups.length };
    fuel.groups = [...fuel.groups, group];
    return group;
  });
  const fuel = { selected: fuelDay, loadedMonth: fuelDay.slice(0, 7), logs: [entry], groups: dayGroups, refresh: noop, refreshAfterWrite: noop, invalidateTotals: noop, deleteEntry: vi.fn<(id: string) => Promise<boolean>>(async () => true), addGroup, ...fuelActions };
  const useFuelStore = Object.assign((select: (state: typeof fuel) => unknown) => select(fuel), { getState: () => fuel });
  const imports: Record<string, unknown> = {
    'date-fns': dates,
    '@expo/ui/swift-ui': {
      Host: Wrap,
      Picker: (props: Omit<NonNullable<typeof captured.segments>, 'tags'> & PropsWithChildren<{ modifiers?: unknown[] }>) => {
        const tags = Children.toArray(props.children).flatMap((child) =>
          isValidElement<{ modifiers?: Array<{ tag?: string }> }>(child) ? (child.props.modifiers ?? []).map((modifier) => modifier?.tag).filter((tag): tag is string => Boolean(tag)) : [],
        );
        const drawn = { ...props, tags, disabled: props.modifiers?.some((modifier) => (modifier as { disabled?: boolean } | undefined)?.disabled === true) };
        captured.segments = drawn;
        // forgotten once off screen (Search hides them)
        useEffect(() => () => { if (captured.segments === drawn) captured.segments = undefined; });
        return Wrap(props);
      },
      Text: Wrap,
    },
    '@expo/ui/swift-ui/modifiers': { accessibilityLabel: noop, pickerStyle: noop, tag: (tag: string) => ({ tag }), disabled: (disabled = true) => ({ disabled }) },
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
      ActionSheetIOS: { showActionSheetWithOptions: (options: Choices['options'], callback: Choices['callback']) => { captured.choices = { options, callback }; } },
      Alert: { alert },
      View: Wrap,
      // Kept while shown, by its name for VoiceOver and by the words on it.
      Pressable: (props: Press) => {
        const children = typeof props.children === 'function' ? props.children({ pressed: false }) : props.children;
        const names = [...new Set([props.accessibilityLabel, textOf(children)])].filter((name): name is string => Boolean(name));
        useEffect(() => {
          for (const name of names) captured.pressables[name] = props;
          return () => {
            for (const name of names) if (captured.pressables[name] === props) delete captured.pressables[name];
          };
        });
        return Wrap({ children });
      },
      ScrollView: Wrap,
      Text: Wrap,
      TextInput: (props: Input) => { if (props.accessibilityLabel) captured.inputs[props.accessibilityLabel] = props; return null; },
      Keyboard: { dismiss: dismissKeyboard },
      ActivityIndicator: Empty,
      Linking: { openSettings },
      Image: {},
    },
    'react-native-keyboard-controller': {
      KeyboardAwareScrollView: (props: NonNullable<typeof captured.scroll>) => { captured.scroll = props; return Wrap(props); },
    },
    'react-native-reanimated': { default: { View: Wrap }, LayoutAnimationConfig: Wrap },
    '@/lib/foodLoggerUtils': { toLocalTimeInput: () => '10:00' },
    '@/lib/decimalText': decimalText,
    '@/lib/mealComposition': composition,
    '@/lib/foodTrial': { getFoodAnalysisMode: () => worker ? 'worker' : 'gemini' },
    '@/lib/nutritionGroups': { nutritionGroupLabel: groupRules.nutritionGroupLabel, nutritionGroupTitle: groupRules.nutritionGroupTitle, NO_MEAL: groupRules.NO_MEAL },
    '@/lib/savedFoodsCache': { readSavedFoodsCache: () => savedFoods, writeSavedFoodsCache: noop },
    '@/lib/savedMealFromLog': { mealFromLoggedFoods: noop, savedMealNamed: () => undefined },
    '@/lib/savedMeals': { loadSavedMeals: loadSaved, filterSavedMeals, foodValuesMatch, savedMealSuggestions, replaceSavedMeal: replaceSimple, retireSavedMeal: retire },
    '@/lib/sessionUser': { getSessionUserId: async () => 'user-a' },
    '@/stores/authStore': { useAuthStore: Object.assign((select: (state: { user: { id: string } }) => unknown) => select({ user: { id: 'user-a' } }), { getState: () => ({ user: { id: 'user-a' } }) }) },
    '@/lib/foodDescription': {},
    '@/lib/foodPersistence': { ensureFoodRow: ensureFood },
    '@/lib/manualFood': { resolveManualFood: resolveFood },
    '@/lib/savedBarcodeFoods': {},
    '@/lib/foodUnits': foodUnits,
    '@/lib/pendingEntryId': pendingEntry,
    '@/lib/requestGate': requestGate,
    '@/lib/barcodes': barcodes,
    '@/lib/withTimeout': timeout,
    '@/lib/barcodeLookup': { lookupBarcode: (_barcode: string, current: () => boolean) => { captured.scanCurrent = current; return lookup.promise; } },
    '@/lib/photoAnalysis': { getPhotoWorkerSettings: () => ({ provider: 'openai' }), analyzeFoodPhoto: analyze },
    '@/lib/photoReview': { ...photoReview, groundPhotoItems: ground },
    '@/lib/mealDestination': { resolveMealDestination: resolveDestination },
    '@/lib/saveMealComposition': { assertComposedMealOptions, saveComposedMeal: saveMeal },
    '../../modules/hyper-barcode': { HyperBarcode: { getAvailability: async () => ({ available: false }) } },
    '~/components/BlancText': { BlancText: Wrap, blancTextStyle: () => ({}), textSizing: () => ({}) },
    '~/components/Capsule': { Capsule: (props: Button) => { captured.buttons[props.title] = props; return null; } },
    '~/components/GlassButton': { GlassButton: (props: Button & { accessibilityLabel: string }) => { captured.buttons[props.accessibilityLabel] = props; return null; } },
    '~/components/Label': { Label: Wrap },
    '~/components/RollingText': { RollingText: Wrap },
    '@/lib/nutritionMacros': nutritionMacros,
    '~/components/Row': { Row: (props: Button) => { captured.buttons[props.title] = props; return null; }, Hairline: Empty },
    '~/components/SwipeRow': { dismissOpenSwipeRow: noop, closeOpenSwipeRow: () => false, SwipeRow: Wrap, useSwipeActions: () => [] },
    '~/components/HoldMenu': { HoldMenu: Wrap, hasHoldMenu: true, menuAccessibility: () => ({ actions: [], run: () => false }) },
    '~/components/Form': { FieldArea: Wrap, FieldRow: (props: Field) => { captured.fields[props.label] = props; return null; }, FormNote: Wrap, ToggleRow: (props: { label: string; value: boolean }) => { captured.toggles[props.label] = props; return null; }, NumberFieldRow: Empty, PickerRow: Empty, useDecimalText: (n: number) => ({ text: String(n), onChangeText: noop }) },
    '~/components/Section': { Section: (props: SectionProps) => { captured.sections[props.title] = props; return Wrap(props); } },
    '~/components/Stepper': { Stepper: Empty },
    '~/lib/format': { formatWhole: String },
    // VoiceOver and the text size are device services: silent, standard size (announcements recorded).
    '~/lib/accessibility': { announce, useAnnounce: noop, useLargeText: () => large, useScreenReader: () => false, useIncreaseContrast: () => false, speak: (text: string) => text, spokenUnit: (unit: string) => unit },
    '~/lib/foodLogger': { initialWhen: when, usesDayGroups: () => sameDay, timeAsDate: () => new Date(), workerAccessToken: token, saveFoodEntry: saveFood, SAVE_FAILED: 'Not logged. Try again.' },
    './fuel': { useFuelStore },
    '~/lib/fuel': { groupsForDay: (key: string) => fuel.groups.filter((group) => group.date === key), loadDayGroups: async (key: string) => fuel.groups.filter((group) => group.date === key), suggestedGroup: () => (clockGroup ? { id: clockGroup } : null), today: () => '2026-11-03', useTodayKey: () => '2026-11-03', useFuelStore },
    '~/lib/haptics': { haptics: { tap, select: noop, success, error } },
    '~/lib/launchActions': launchActions,
    '~/lib/launch': { refusePress },
    '~/lib/leaveGuard': { useLeaveGuard: (on: boolean, message: { title: string }, options: { busy?: boolean } = {}) => { captured.guard = { on, message, busy: options.busy }; } },
    '~/lib/you': { loadYouMeals: loadYou, useYouMealsStore },
    '~/lib/motion': {},
    '~/platform/previewFlag': { isPreviewActive: () => true },
    '~/fuel/context': { LoggerContext: ContextProvider, takeReview: () => { const taken = reviewHandoff; reviewHandoff = null; return taken; } },
    './context': { useLogger },
    './WhenBlock': { WhenBlock: Empty },
    './FoodLists': { spokenMacros: () => '' },
    '~/fuel/FoodLists': {
      Empty: ({ text }: { text: string }) => text,
      // Search foods, kept by its placeholder as VoiceOver names it.
      SearchField: (props: { value: string; placeholder: string; editable?: boolean; onChange: (text: string) => void; onFocus?: () => void }) => {
        captured.inputs[props.placeholder] = { accessibilityLabel: props.placeholder, value: props.value, editable: props.editable, onChangeText: props.onChange, onFocus: props.onFocus };
        return null;
      },
      SearchTab: (props: { query: string }) => { captured.search = props; return null; },
      SavedTab: (props: NonNullable<typeof captured.saved>) => { captured.saved = props; return null; } },
    '~/fuel/FoodReview': { FoodReview: (props: { food: Food }) => { captured.foodReview = props; return null; } },
    '~/fuel/RecentTab': { RecentTab: Empty },
    '~/fuel/EntryMethods': { EntryMethods: (props: NonNullable<typeof captured.methods>) => {
      captured.methods = props;
      useEffect(() => () => { if (captured.methods === props) captured.methods = undefined; });
      return null;
    } },
    '~/fuel/AiTab': {
      emptyAi: () => ({ hint: '', answer: '', photos: [], result: null, items: [] }),
      aiHasDraft: (draft: { hint: string; photos: unknown[]; result: unknown }) => Boolean(draft.hint) || draft.photos.length > 0 || draft.result !== null,
      aiTakesPhoto: (draft: { photos: unknown[]; result: unknown }) => draft.result === null && draft.photos.length < 2,
      AiTab: (props: AiProps) => { captured.ai = props; return createElement(Probe); },
    },
    '~/theme/blanc': { useBlanc: () => ({}), paletteFor: () => ({}), space: { gutter: 20 }, type: {} },
  };
  if (rowActions) {
    // As SwipeRow does: the row inside (the element VoiceOver focuses) takes the swipe actions as its own.
    const SwipeActions = createContext<SwipeAction[] | null>(null);
    const swipeRow = {
      dismissOpenSwipeRow: noop,
      closeOpenSwipeRow: () => false,
      SwipeRow: ({ actions, children }: PropsWithChildren<{ actions: SwipeAction[] }>) => createElement(SwipeActions.Provider, { value: actions }, children),
      useSwipeActions: () => useContext(SwipeActions),
    };
    imports['~/components/SwipeRow'] = swipeRow;
    imports['~/components/HoldMenu'] = loadNativeModule('components/HoldMenu.tsx', {
      'react-native': imports['react-native'],
      '../../modules/hyper-menu': { HyperMenuView: Wrap, hasHyperMenu: true },
      '~/lib/menu': loadNativeModule('lib/menu.ts', {}),
      '~/theme/blanc': { radius: {}, useBlanc: () => ({}) },
      './SwipeRow': swipeRow,
    });
  }
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
  // The real camera bridge and screen; only the camera itself, its permission and the photo library are stood in for.
  const foodCamera = loadNativeModule<NativeModule>('fuel/foodCamera.ts', { 'expo-image-picker': imagePicker, 'expo-router': { router: { push: openCamera } } });
  imports['./foodCamera'] = foodCamera;
  const FoodCamera = loadNativeModule<{ default: ComponentType }>('app/food-camera.tsx', {
    ...imports,
    'expo-camera': {
      CameraView: (props: Viewfinder) => {
        useEffect(() => {
          captured.viewfinder = props;
          if (props.ref) props.ref.current = { takePictureAsync: shutter };
        });
        return null;
      },
      useCameraPermissions: () => {
        const [access, setAccess] = useState<Access | null>(null);
        useEffect(() => { void readAccess().then(setAccess); }, []);
        const request = useCallback(async () => { const next = await permission(); setAccess(next); return next; }, []);
        const read = useCallback(async () => { const next = await readAccess(); setAccess(next); return next; }, []);
        return [access, request, read];
      },
    },
    'expo-router': { router: { back: cameraBack } },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) },
    '@/lib/appVisibility': { onAppVisible: () => noop },
    '~/fuel/foodCamera': foodCamera,
  }).default;
  const photoModule = loadNativeModule<NativeModule>('fuel/PhotoTab.tsx', imports);
  imports['~/fuel/PhotoTab'] = { ...photoModule, PhotoTab: (props: PhotoProps) => {
    captured.photo = props;
    captured.context = useLogger();
    return createElement(photoModule.PhotoTab as ComponentType<PhotoProps>, props);
  } };
  imports['~/fuel/ScanTab'] = loadNativeModule('fuel/ScanTab.tsx', imports);
  if (realReview) {
    const foodReview = loadNativeModule<NativeModule>('fuel/FoodReview.tsx', {
      ...imports,
      '@/lib/foodUnits': foodUnits,
      '@/lib/recentFoods': { usualAmountInput },
      '@/lib/saveNutritionEntry': { chosenFoodLogSource: () => 'search' },
      '@/lib/barcodeLookup': { barcodeProviderLabel: String },
      './ServingHelper': { ServingHelper: Empty },
    });
    imports['~/fuel/FoodReview'] = { FoodReview: (props: { food: Food }) => {
      captured.foodReview = props;
      return createElement(foodReview.FoodReview as ComponentType<{ food: Food }>, props);
    } };
  }
  if (realAi) {
    const aiModule = loadNativeModule<NativeModule>('fuel/AiTab.tsx', {
      ...imports,
      '@/lib/foodTrial': { ...foodTrial, getFoodAnalysisMode: () => 'gemini' },
      '@/lib/foodTrialReview': foodTrialReview,
      '@/lib/analysisProgress': analysisProgress,
      './AnalysisProgress': { AnalysisProgress: Empty },
      './PhotoTab': photoModule,
    });
    imports['~/fuel/AiTab'] = { ...aiModule, AiTab: (props: AiProps) => {
      captured.ai = props;
      return createElement(aiModule.AiTab as ComponentType<AiProps>, props);
    } };
  }
  if (realLists) {
    const realFoodLogger = loadNativeModule<NativeModule>('lib/foodLogger.ts', {
      ...imports,
      '@/lib/saveNutritionEntry': { ...saveNutrition, persistNutritionEntry: persistEntry },
      '@/lib/supabase': {},
    });
    const listImports = {
      ...imports,
      '@/lib/foodUnits': foodUnits,
      '@/lib/nutritionLedger': nutritionLedger,
      '@/lib/saveNutritionEntry': saveNutrition,
      '@/lib/usdaClient': {},
      '~/lib/foodLogger': { ...imports['~/lib/foodLogger'] as NativeModule, saveFoodEntry: realFoodLogger.saveFoodEntry },
    };
    const lists = loadNativeModule<NativeModule>('fuel/FoodLists.tsx', listImports);
    imports['~/fuel/FoodLists'] = lists;
    imports['~/fuel/RecentTab'] = loadNativeModule('fuel/RecentTab.tsx', {
      ...listImports,
      './FoodLists': lists,
      '@/lib/recentFoods': recentFoods,
      './recent': readRecent ? loadNativeModule('fuel/recent.ts', {
        '@/lib/recentFoods': { ...recentFoods, loadRecentLogs: readRecent },
        '@/stores/authStore': { useAuthStore: zustand.create(() => ({ user: { id: 'user-a' } })) },
        '~/lib/fuel': { useFuelStore: zustand.create(() => fuel) },
      }) : {
        useRecentLogs: () => ({ logs: [{ ...loggedMilk, food_id: milk.id }], failed: false, version: 0, settle: noop, retry: noop }),
        useHiddenRecentFoods: () => ({ hidden: {}, hide: noop }),
      },
    });
  }
  if (realClock) {
    const realLogger = loadNativeModule<NativeModule>('lib/foodLogger.ts', {
      ...imports, '@/lib/foodLoggerUtils': loggerUtils, '@/lib/saveNutritionEntry': saveNutrition, '@/lib/supabase': {},
    });
    imports['~/lib/foodLogger'] = { ...imports['~/lib/foodLogger'] as NativeModule, initialWhen: realLogger.initialWhen };
    const groups = (key: string) => ['breakfast', 'lunch', 'dinner', 'snack'].map((label) => ({ id: `${key}:${label}`, date: key, label }));
    imports['~/lib/fuel'] = {
      ...imports['~/lib/fuel'] as NativeModule,
      today: () => dates.format(new Date(), 'yyyy-MM-dd'),
      useTodayKey: () => dates.format(new Date(), 'yyyy-MM-dd'),
      loadDayGroups: async (key: string) => groups(key),
      suggestedGroup: (list: Array<{ label: string }>, at?: Date) => list.find((group) => group.label === mealForTime(at ?? new Date())),
    };
  }
  const Sheet = loadNativeModule<{ default: ComponentType }>('app/log-food.tsx', imports).default;
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;
  const close = async () => { await act(async () => { closeCameraRoot(); root?.unmount(); root = undefined; }); };
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
  const tab = async (name: string) => {
    expect(captured.picker!.disabled).not.toBe(true);
    await act(async () => { captured.picker!.onSelectionChange(name); });
  };
  const click = async (name: string) => {
    expect(captured.buttons[name].disabled).not.toBe(true);
    await act(async () => { captured.buttons[name].onPress(); });
  };
  /** Edit entry's Change food, under the food's name (the header's ✕ closes). */
  const changeFood = async () => {
    const link = captured.pressables['Change food'];
    if (link) {
      await act(async () => { link.onPress?.(); });
      return;
    }
    expect(captured.foodReview?.onChangeFood).toBeDefined();
    await act(async () => { captured.foodReview!.onChangeFood!(); });
  };
  /** Focuses Search foods (and types into it), as a tap on the field does. */
  const search = async (words?: string) => {
    const field = captured.inputs['Search foods'];
    expect(field).toBeDefined();
    await act(async () => { field.onFocus!(); });
    if (words !== undefined) await act(async () => { captured.inputs['Search foods'].onChangeText!(words); });
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
  // A lookup holds the sheet: closing then asks to stop the analysis (Build a meal shows on Recent and Saved only).
  const busy = () => captured.guard!.message.title === 'Stop the analysis?';
  const flush = () => act(async () => { for (let tick = 0; tick < 20; tick += 1) await Promise.resolve(); });
  /** The camera screen's words, while it is up. */
  const cameraText = () => (cameraRoot ? cameraHost?.textContent ?? '' : '');
  const cameraUp = () => cameraRoot !== null;
  /** On the camera screen: the shutter once the preview runs, then Use Photo. */
  const shoot = async () => {
    await act(async () => { captured.viewfinder!.onCameraReady!(); });
    await press('Take photo');
    await flush();
    await press('Use Photo');
    await flush();
  };
  // Snap a meal pressed while this sheet is on top (lib/launch.ts hands it over).
  const ask = (atMs?: number) => act(async () => { launchActions.askLoggerCamera(atMs); });
  return {
    captured, imports, render, close, text, tab, click, changeFood, press, search, startPhoto, openSavedEditor, busy, appear, ask, entries, persistEntry, lookup, analysis, analyze,
    token, ground, alert, tap, success, error, saveMeal, resolveDestination, saveFood, ensureFood, resolveFood, replaceSimple, retire, loadSaved, mealsState, back, push,
    refusePress, announce, when, addGroup, dismissKeyboard, permission, readAccess, shutter, library, openCamera, cameraBack, cameraText, cameraUp, shoot, flush, openSettings,
  };
}

describe('editing measured food entries', () => {
  it.each([
    ['g', 100, 2, '200', '250', 2.5],
    ['ml', 240, 1, '240', '120', 0.5],
  ] as const)('opens in %s and saves the changed amount to the same entry', async (unit, size, servings, amount, nextAmount, nextServings) => {
    const food = { ...milk, serving_unit: unit, serving_size: size };
    const h = loggerHarness({ editing: true, realReview: true, entry: { ...loggedMilk, food, servings } });
    await h.render();
    expect(h.captured.foodReview?.food).toEqual(food);
    expect(h.captured.fields.Amount.value).toBe(amount);
    expect(h.captured.guard?.on).toBe(false);
    await act(async () => { h.captured.fields.Amount.onChangeText(nextAmount); });
    expect(h.captured.guard?.on).toBe(true);
    await h.click('Save changes');
    expect(h.saveFood).toHaveBeenCalledWith(expect.objectContaining({
      foodId: milk.id, servings: nextServings, editingId: loggedMilk.id, source: 'barcode',
    }));
    expect(h.ensureFood).not.toHaveBeenCalled();
    expect(h.back).toHaveBeenCalledOnce();
  });

  it('keeps a serving-based entry in Manual', async () => {
    const h = loggerHarness({ editing: true, entry: { ...loggedMilk, food: { ...milk, serving_size: 1, serving_unit: 'serving' } } });
    await h.render();
    expect(h.captured.foodReview).toBeUndefined();
    expect(h.captured.manual?.draft.fields.name).toBe(milk.name);
  });

  it('keeps a changed amount when going back to edit the macros', async () => {
    const h = loggerHarness({ editing: true, realReview: true });
    await h.render();
    await act(async () => { h.captured.fields.Amount.onChangeText('120'); });
    await h.changeFood();
    await h.click('Save changes');
    expect(h.saveFood).toHaveBeenCalledWith(expect.objectContaining({ servings: 0.5, editingId: loggedMilk.id }));
  });
});

describe('Edit entry: a way out and a way to another food', () => {
  it('opens with ✕ to close and Change food under the name, and ‹ only once another food is picked', async () => {
    const h = loggerHarness({ editing: true });
    await h.render();
    expect(h.captured.buttons.Close).toBeDefined();
    expect(h.captured.buttons.Back).toBeUndefined();
    expect(h.captured.foodReview?.onChangeFood).toBeDefined();
    await h.changeFood();
    expect(h.captured.buttons.Close).toBeDefined();
    await act(async () => { h.captured.context!.chooseFood(recipe); });
    expect(h.captured.buttons.Back).toBeDefined();
    expect(h.captured.foodReview?.onChangeFood).toBeUndefined();
  });
});

describe('native food logger transitions', () => {
  it('offers Save as reusable meal for a new built meal, never for a saved meal opened to log', async () => {
    const h = loggerHarness();
    await h.render();
    await h.click('Build a meal');
    await act(async () => { h.captured.context!.addIngredients([composition.createMealIngredient(milk, 1, 'milk-part')]); });
    await h.click('Review meal');
    expect(h.captured.toggles['Save as reusable meal']).toMatchObject({ value: false });
    await act(async () => { h.captured.review!.update({ name: 'Milk bowl' }); });
    // Discarded, so the saved meal doesn't open over this one.
    await h.close();
    composition.clearMealDraft('user-a', 'new');

    const saved = loggerHarness();
    await saved.render();
    await act(async () => { saved.captured.context!.composeMeal(recipe); });
    expect(saved.captured.review!.draft.name).toBe(recipe.name);
    expect(saved.captured.sections.When).toBeDefined();
    expect(saved.captured.toggles['Save as reusable meal']).toBeUndefined();
    // Closed and opened again, the kept draft still knows it came from Saved.
    await saved.close();
    await saved.render();
    expect(saved.captured.review!.draft.method).toBe('saved');
    expect(saved.captured.toggles['Save as reusable meal']).toBeUndefined();
    await saved.click('Log meal');
    expect(saved.saveMeal).toHaveBeenCalledWith(expect.objectContaining({ saveAsReusableMeal: false }), 'user-a', expect.anything());
  });

  it('keeps Saved → Edit separate from the entry that originally opened the sheet', async () => {
    const h = loggerHarness({ editing: true });
    await h.render();
    await h.changeFood();
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
    await h.changeFood();
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
    await h.changeFood();
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

  it('opens on a close-the-gap pick from Fuel: its review at the usual amount, or a built meal’s builder', async () => {
    reviewHandoff = { food: milk, servings: 2 };
    const h = loggerHarness({ params: { day: '2026-11-03', review: '1' } });
    await h.render();
    expect(h.captured.foodReview).toMatchObject({ food: milk, servings: 2 });
    expect(reviewHandoff).toBeNull();

    reviewHandoff = { food: recipe, servings: 1 };
    const built = loggerHarness({ params: { day: '2026-11-03', review: '1' } });
    await built.render();
    expect(built.captured.review).toBeDefined();
    expect(composition.loadMealDraft('user-a', 'new')?.name).toBe(recipe.name);
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

  // The number pad's bar covered Look up barcode, so a tap on it did nothing.
  it('keeps Look up barcode above the number pad, and taps once for it', async () => {
    const h = loggerHarness();
    await h.render();
    expect(h.captured.scroll!.bottomOffset).toBe(24);
    await h.tab('scan');
    // The field rises with room for the 54 pt capsule 12 pt under it.
    expect(h.captured.scroll!.bottomOffset).toBe(90);

    await act(async () => { h.captured.fields['Barcode'].onChangeText('012345678905'); });
    h.tap.mockClear();
    await h.click('Look up barcode');
    // The capsule gives its own tap; the lookup adds none.
    expect(h.tap).not.toHaveBeenCalled();
    await act(async () => { h.lookup.resolve({ status: 'miss' }); });
    expect(h.error).toHaveBeenCalled();

    // The pad's Search key has no capsule, so the lookup taps for it.
    await act(async () => { h.captured.fields['Barcode'].onSubmitEditing?.(); });
    expect(h.tap).toHaveBeenCalledTimes(1);
    await h.tab('manual');
    expect(h.captured.scroll!.bottomOffset).toBe(24);
  });

  it('releases an abandoned scan before its response, allowing another input method', async () => {
    const h = loggerHarness();
    await h.render();
    await h.tab('scan');
    await act(async () => { h.captured.fields['Barcode'].onChangeText('012345678905'); });
    await h.click('Look up barcode');
    expect(h.busy()).toBe(true);
    await h.tab('manual');
    expect(h.captured.scanCurrent!()).toBe(false);
    expect(h.busy()).toBe(false);
    expect(h.captured.guard!.on).toBe(false);
    await act(async () => { h.captured.manual!.onGeminiHandoff!('chicken and rice'); });
    expect(h.alert).not.toHaveBeenCalled();
    // Manual's words arrive on the meal view through Describe's door
    expect(h.captured.picker!.selection).toBe('describe');
    let release!: () => void;
    await act(async () => { release = h.captured.context!.beginBusy(); });
    await act(async () => { h.lookup.resolve({ status: 'stale' }); });
    expect(h.busy()).toBe(true);
    await act(async () => { release(); });
    expect(h.busy()).toBe(false);
  });

  it('offers each list one way to make something: Build a meal under Recent, New saved meal under Saved', async () => {
    const h = loggerHarness();
    // Rows stay recorded once drawn, so each check starts from none.
    const forget = () => { delete h.captured.buttons['Build a meal']; delete h.captured.buttons['New saved meal']; };
    await h.render();
    expect(h.captured.buttons['Build a meal']).toMatchObject({ detail: 'Combine several foods into one entry' });
    expect(h.captured.buttons['New saved meal']).toBeUndefined();
    forget();
    await h.search();
    expect(h.captured.buttons['Build a meal']).toBeUndefined();
    expect(h.captured.buttons['New saved meal']).toBeUndefined();
    await h.press('Cancel');
    for (const name of ['scan', 'manual', 'photo']) {
      forget();
      await h.tab(name);
      expect(h.captured.buttons['Build a meal']).toBeUndefined();
      expect(h.captured.buttons['New saved meal']).toBeUndefined();
    }
    forget();
    await h.tab('saved');
    // Saved's own: a saved meal, named so it doesn't read as Build a meal.
    expect(h.captured.buttons['Build a meal']).toBeUndefined();
    expect(h.captured.buttons['New saved meal']).toMatchObject({ detail: 'Macros you enter once, to log in a tap' });
    // It runs the new-saved-meal flow: Manual, kept as a saved meal.
    await h.click('New saved meal');
    expect(h.captured.picker!.selection).toBe('manual');
    expect(h.captured.manual!.draft).toMatchObject({ saveAsReusable: true });
  });

  it('offers no new saved meal while an entry is edited', async () => {
    const h = loggerHarness({ editing: true, entry: { ...loggedMilk, food: { ...milk, serving_size: 1, serving_unit: 'serving' } } });
    await h.render();
    await h.tab('saved');
    expect(h.captured.buttons['New saved meal']).toBeUndefined();
  });

  it('splits the lists (segmented) from the entry methods, and never shows a list as chosen over a method', async () => {
    const h = loggerHarness();
    await h.render();
    // Search is the field above them, not a segment.
    expect(h.captured.segments!.tags).toEqual(['recent', 'saved']);
    expect(h.captured.methods).toMatchObject({ selected: null, gemini: true, photoWaiting: false, disabled: false });
    for (const method of ['scan', 'manual', 'photo', 'describe']) {
      await act(async () => { h.captured.methods!.onSelect(method); });
      expect(h.captured.methods!.selected).toBe(method);
      // No segment carries this value, so none is drawn as chosen.
      expect(h.captured.segments!.selection).toBe('none');
      expect(h.captured.segments!.tags).not.toContain('none');
    }
    // A tap on a segment goes back to that list and clears the method.
    await act(async () => { h.captured.segments!.onSelectionChange('saved'); });
    expect(h.captured.segments!.selection).toBe('saved');
    expect(h.captured.methods!.selected).toBeNull();
  });

  it('opens the camera from Photo and the words from Describe, on one meal view, with nothing estimated on its own', async () => {
    const h = loggerHarness();
    await h.render();
    await h.appear();
    await act(async () => { h.captured.methods!.onSelect('photo'); });
    expect(h.captured.methods!.selected).toBe('photo');
    expect(h.captured.ai!.addPhotoRequest).toBe(1);
    expect(h.captured.ai!.focusRequest).toBe(0);
    // Snap a meal's own request (which estimates at once) is left alone
    expect(h.captured.ai!.cameraRequest).toBe(0);
    // Describe is the same view: the words, with the photo kept
    await act(async () => { h.captured.ai!.setDraft((draft) => ({ ...draft, photos: [{ uri: 'cam', width: 10, height: 10 }] })); });
    await act(async () => { h.captured.methods!.onSelect('describe'); });
    expect(h.captured.methods!.selected).toBe('describe');
    expect(h.captured.ai!.focusRequest).toBe(1);
    expect(h.captured.ai!.addPhotoRequest).toBe(1);
    expect(h.captured.ai!.draft.photos).toHaveLength(1);
    // Photo again adds a second photo; never once the view holds an estimate
    await act(async () => { h.captured.methods!.onSelect('photo'); });
    expect(h.captured.ai!.addPhotoRequest).toBe(2);
    await act(async () => { h.captured.ai!.setDraft((draft) => ({ ...draft, result: { items: [], summary: 'Eggs' } })); });
    await act(async () => { h.captured.methods!.onSelect('photo'); });
    expect(h.captured.ai!.addPhotoRequest).toBe(2);
    expect(h.captured.ai!.cameraRequest).toBe(0);
  });

  it('gives the photo worker Photo alone, which takes the first view without analyzing it', async () => {
    const h = loggerHarness({ worker: true });
    await h.render();
    await h.appear();
    expect(h.captured.methods!.gemini).toBe(false);
    await act(async () => { h.captured.methods!.onSelect('photo'); });
    await h.flush();
    expect(h.openCamera).toHaveBeenCalledOnce();
    await h.shoot();
    expect(h.captured.photo!.draft.photos).toEqual({ top: { uri: 'cam', width: 10, height: 10 } });
    expect(h.analyze).not.toHaveBeenCalled();
  });

  it('tells the entry methods when the worker’s photo estimate waits on another tab', async () => {
    const h = loggerHarness({ worker: true });
    await h.render();
    expect(h.captured.methods).toMatchObject({ gemini: false, photoWaiting: false });
    await h.tab('photo');
    await act(async () => {
      h.captured.photo!.setDraft((draft) => ({ ...draft, items: [photoItem] }));
    });
    expect(h.captured.methods!.photoWaiting).toBe(false);
    await h.tab('recent');
    expect(h.captured.methods!.photoWaiting).toBe(true);
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
    // An analysis is not a save: the guard asks, but the sheet isn't held as busy.
    expect(h.captured.guard).toEqual({ on: true, message: { title: 'Stop the analysis?', message: 'The result is lost if you close now.' }, busy: false });
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
    expect(h.busy()).toBe(true);
    await act(async () => { h.analysis.resolve(photoResult); });
    expect(h.busy()).toBe(false);
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

describe('Log food: Search foods takes the sheet over', () => {
  it('hides the segments and entry methods for results under the field, and Cancel goes back to the list that showed', async () => {
    const h = loggerHarness();
    await h.render();
    await h.tab('saved');
    expect(h.captured.pressables.Cancel).toBeUndefined();
    await h.search('oats');
    // results sit right under the field
    expect(h.captured.segments).toBeUndefined();
    expect(h.captured.methods).toBeUndefined();
    expect(h.captured.search).toEqual({ query: 'oats' });
    expect(h.captured.inputs['Search foods'].value).toBe('oats');
    await h.press('Cancel');
    expect(h.dismissKeyboard).toHaveBeenCalledOnce();
    expect(h.captured.inputs['Search foods'].value).toBe('');
    expect(h.captured.segments!.selection).toBe('saved');
    expect(h.captured.methods!.selected).toBeNull();
    expect(h.captured.pressables.Cancel).toBeUndefined();
  });

  it('goes back to an entry method with its work kept, and no segment claims it', async () => {
    const h = loggerHarness();
    await h.render();
    await h.tab('manual');
    await act(async () => { h.captured.manual!.setDraft((draft) => ({ ...draft, fields: { ...draft.fields, name: 'Toast' } })); });
    await h.search();
    expect(h.captured.methods).toBeUndefined();
    await h.press('Cancel');
    expect(h.captured.methods!.selected).toBe('manual');
    expect(h.captured.segments!.selection).toBe('none');
    expect(h.captured.manual!.draft.fields.name).toBe('Toast');
  });

  it('keeps the words through a food’s review', async () => {
    const h = loggerHarness();
    await h.render();
    await h.search('oats');
    await act(async () => { h.captured.context!.chooseFood(milk); });
    expect(h.captured.foodReview!.food).toEqual(milk);
    // a review is its own view: no field over it
    expect(h.captured.pressables.Cancel).toBeUndefined();
    h.captured.search = undefined;
    await h.click('Back');
    expect(h.captured.search).toEqual({ query: 'oats' });
    expect(h.captured.pressables.Cancel).toBeDefined();
  });

  it('holds still while a save runs', async () => {
    const h = loggerHarness();
    await h.render();
    let release!: () => void;
    await act(async () => { release = h.captured.context!.beginSave(); });
    expect(h.captured.inputs['Search foods'].editable).toBe(false);
    await h.search();
    expect(h.captured.pressables.Cancel).toBeUndefined();
    expect(h.captured.segments!.selection).toBe('recent');
    await act(async () => { release(); });
    expect(h.captured.inputs['Search foods'].editable).toBe(true);
    // A quick add from the results leaves the field live (the keyboard stays up); only Cancel waits.
    await h.search('oats');
    await act(async () => { release = h.captured.context!.beginSave(); });
    expect(h.captured.inputs['Search foods'].editable).toBe(true);
    expect(h.captured.pressables.Cancel.disabled).toBe(true);
    await act(async () => { release(); });
    expect(h.captured.pressables.Cancel.disabled).toBe(false);
  });

  it('empties the field and puts the keyboard away when Snap a meal takes the sheet', async () => {
    const h = loggerHarness();
    await h.render();
    await h.appear();
    await h.search('oats');
    await h.ask();
    expect(h.captured.methods!.selected).toBe('photo');
    expect(h.captured.ai!.cameraRequest).toBe(1);
    expect(h.captured.inputs['Search foods'].value).toBe('');
    expect(h.dismissKeyboard).toHaveBeenCalledOnce();
    expect(h.captured.pressables.Cancel).toBeUndefined();
  });
});

describe('Log food: where the food goes', () => {
  const lunch: NutritionGroup = { id: 'lunch', user_id: 'user-a', date: '2026-11-03', kind: 'meal', label: 'lunch', sort_order: 1 };
  const nov2 = { date: new Date('2026-11-02T00:00:00'), time: '00:00', groupId: null };

  it.each([
    ['today with no meal', {}, null, 'Adds to today'],
    ['another day with no meal', { params: { day: '2026-11-02' } }, nov2, 'Adds to Nov 2'],
    ['a meal', { dayGroups: [lunch], params: { group: 'lunch' } }, { date: new Date('2026-11-03T10:00:00'), time: '10:00', groupId: 'lunch' }, 'Adds to Lunch'],
  ] as const)('says it positively for %s, as a button that changes it', async (_case, options, when, line) => {
    const h = loggerHarness('dayGroups' in options ? { ...options, dayGroups: [...options.dayGroups] } : options);
    if (when) h.when.mockReturnValue(when);
    await h.render();
    expect(h.text()).toContain(line);
    expect(h.text()).not.toContain('no meal');
    expect(h.captured.pressables[`${line}. Change`]).toBeDefined();
  });

  it('names the meal an edited entry is in, or No meal', async () => {
    const h = loggerHarness({ editing: true, dayGroups: [lunch] });
    await h.render();
    expect(h.text()).toContain('No meal');
    await h.press('No meal. Change');
    await act(async () => { await h.captured.choices!.callback(1); });
    expect(h.text()).toContain('In Lunch');
  });

  it('names the day, not a meal, once When has left the sheet’s day', async () => {
    const h = loggerHarness({ sameDay: false });
    h.when.mockReturnValue(nov2);
    await h.render();
    expect(h.text()).toContain('Adds to Nov 2');
    expect(h.text()).not.toContain('Unassigned');
    expect(h.captured.pressables['Adds to Nov 2'].disabled).toBe(true);
    const edit = loggerHarness({ editing: true, sameDay: false });
    edit.when.mockReturnValue(nov2);
    await edit.render();
    expect(edit.text()).toContain('Moves to Nov 2');
  });

  it('offers No meal, the day’s meals, then New meal and New snack, and goes to the one made', async () => {
    const h = loggerHarness({ dayGroups: [lunch] });
    await h.render();
    await h.press('Adds to today. Change');
    expect(h.captured.choices!.options.options).toEqual(['No meal', 'Lunch', 'New meal', 'New snack', 'Cancel']);
    await act(async () => { await h.captured.choices!.callback(2); });
    await h.flush();
    expect(h.addGroup).toHaveBeenCalledWith('meal');
    expect(h.success).toHaveBeenCalledOnce();
    expect(h.captured.context!.when.groupId).toBe('new-meal');
    // named as Fuel's rules number it: the day's second meal after Lunch
    expect(h.text()).toContain('Adds to Meal 2');
    expect(h.announce).toHaveBeenCalledWith('Adds to Meal 2');
    // listed with the day's meals from then on; No meal takes it out again
    await h.press('Adds to Meal 2. Change');
    expect(h.captured.choices!.options.options).toEqual(['No meal', 'Lunch', 'Meal 2', 'New meal', 'New snack', 'Cancel']);
    await act(async () => { await h.captured.choices!.callback(0); });
    expect(h.captured.context!.when.groupId).toBeNull();
    expect(h.text()).toContain('Adds to today');
  });

  it('makes a snack the same way', async () => {
    const h = loggerHarness({ dayGroups: [lunch] });
    await h.render();
    await h.press('Adds to today. Change');
    await act(async () => { await h.captured.choices!.callback(3); });
    await h.flush();
    expect(h.addGroup).toHaveBeenCalledWith('snack');
    expect(h.captured.context!.when.groupId).toBe('new-snack');
    // A lone snack is "Snack", as Fuel's list names it.
    expect(h.text()).toContain('Adds to Snack');
    expect(h.text()).not.toContain('Snack 1');
  });

  it('says so when the new meal was not made, and keeps the destination', async () => {
    const h = loggerHarness({ dayGroups: [lunch] });
    h.addGroup.mockResolvedValueOnce(null);
    await h.render();
    await h.press('Adds to today. Change');
    await act(async () => { await h.captured.choices!.callback(2); });
    await h.flush();
    expect(h.error).toHaveBeenCalledOnce();
    expect(h.alert).toHaveBeenCalledWith('Not added', 'Check your connection and try again.');
    expect(h.captured.context!.when.groupId).toBeNull();
    expect(h.text()).toContain('Adds to today');
  });

  it('goes to the meal it made, even when the day’s meals arrive while it is made', async () => {
    const h = loggerHarness({ dayGroups: [lunch] });
    const made = deferred<NutritionGroup | null>();
    h.addGroup.mockImplementationOnce(() => made.promise);
    await h.render();
    await h.press('Adds to today. Change');
    await act(async () => { await h.captured.choices!.callback(2); });
    // Breakfast is made for the day (the sheet's default meals) before the new meal's answer.
    const breakfast: NutritionGroup = { id: 'breakfast', user_id: 'user-a', date: '2026-11-03', kind: 'meal', label: 'breakfast', sort_order: 0 };
    const meal: NutritionGroup = { id: 'meal-2', user_id: 'user-a', date: '2026-11-03', kind: 'meal', label: null, sort_order: 2 };
    const fuel = (h.imports['./fuel'] as { useFuelStore: { getState: () => { groups: NutritionGroup[] } } }).useFuelStore.getState();
    fuel.groups = [breakfast, ...fuel.groups, meal];
    await act(async () => { made.resolve(meal); });
    await h.flush();
    expect(h.captured.context!.when.groupId).toBe('meal-2');
  });

  it('keeps a meal or day chosen while New meal runs', async () => {
    const meal2: NutritionGroup = { id: 'meal-2', user_id: 'user-a', date: '2026-11-03', kind: 'meal', label: null, sort_order: 2 };
    // Fuel's store holds the new meal once it is made, as its addGroup does.
    const land = (harness: ReturnType<typeof loggerHarness>, answer: ReturnType<typeof deferred<NutritionGroup | null>>) => act(async () => {
      const fuel = (harness.imports['./fuel'] as { useFuelStore: { getState: () => { groups: NutritionGroup[] } } }).useFuelStore.getState();
      fuel.groups = [...fuel.groups, meal2];
      answer.resolve(meal2);
    });
    const h = loggerHarness({ dayGroups: [lunch] });
    const made = deferred<NutritionGroup | null>();
    h.addGroup.mockImplementationOnce(() => made.promise);
    await h.render();
    await h.press('Adds to today. Change');
    await act(async () => { await h.captured.choices!.callback(2); });
    // Lunch is chosen instead before the new meal's answer.
    await h.press('Adds to today. Change');
    await act(async () => { await h.captured.choices!.callback(1); });
    await land(h, made);
    await h.flush();
    expect(h.captured.context!.when.groupId).toBe('lunch');

    // Moved to yesterday meanwhile: today's new meal never attaches to it.
    const moved = loggerHarness({ dayGroups: [lunch] });
    const late = deferred<NutritionGroup | null>();
    moved.addGroup.mockImplementationOnce(() => late.promise);
    await moved.render();
    await moved.press('Adds to today. Change');
    await act(async () => { await moved.captured.choices!.callback(2); });
    await act(async () => { moved.captured.context!.setWhen({ date: new Date('2026-11-02T10:00:00'), time: '10:00', groupId: null }); });
    await land(moved, late);
    await moved.flush();
    expect(moved.captured.context!.when.groupId).toBeNull();
  });

  it('says only where food goes, with no running total, on a line 44 points tall to touch', async () => {
    // Lunch already holds a 120 kcal entry in the month Fuel holds.
    const h = loggerHarness({ dayGroups: [lunch], params: { group: 'lunch' }, entry: { ...loggedMilk, id: 'log-lunch', group_id: 'lunch' } });
    h.when.mockReturnValue({ date: new Date('2026-11-03T10:00:00'), time: '10:00', groupId: 'lunch' });
    await h.render();
    expect(h.text()).toContain('Adds to Lunch');
    expect(h.text()).not.toMatch(/kcal|120/);
    const line = h.captured.pressables['Adds to Lunch. Change'] as Press & { hitSlop?: unknown; style: (state: { pressed: boolean }) => Record<string, unknown> };
    // A real 44-point frame around the 18-point line, not a slop past a tight one;
    // the negative margins give the room back, so nothing on screen moves.
    expect(line.hitSlop).toBeUndefined();
    expect(line.style({ pressed: false })).toMatchObject({ paddingVertical: 13, marginVertical: -13, paddingHorizontal: 16, marginHorizontal: -16 });
  });

  it('offers no new meal for a day Fuel is not showing, where Fuel would make it', async () => {
    const h = loggerHarness({ dayGroups: [lunch], fuelDay: '2026-11-02' });
    await h.render();
    await h.press('Adds to today. Change');
    expect(h.captured.choices!.options.options).toEqual(['No meal', 'Lunch', 'Cancel']);
  });
});

// Snap a meal (lib/launch.ts): a press opens Log food with start=camera, or
// asks an open sheet, which answers through sheetSnap.
describe('native food logger: Snap a meal', () => {
  it.each([
    ['2026-11-03T10:29:50', '2026-11-03T10:30:10', 'breakfast'],
    ['2026-11-03T23:59:50', '2026-11-04T00:00:10', 'snack'],
  ])('keeps the press date, minute and meal after opening late from %s', async (pressed, opened, meal) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date(opened));
      const h = loggerHarness({ realClock: true, params: { start: 'camera', atMs: String(new Date(pressed).getTime()) } });
      await h.render();
      expect(h.captured.context!.selectedKey).toBe(pressed.slice(0, 10));
      expect(h.captured.context!.when).toMatchObject({ time: pressed.slice(11, 16), groupId: `${pressed.slice(0, 10)}:${meal}` });
    } finally { vi.useRealTimers(); }
  });

  it.each(['join', 'restart'])('keeps a delayed midnight press in an already open sheet (%s)', async (path) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const atMs = new Date('2026-11-03T23:59:50').getTime();
      vi.setSystemTime(new Date(path === 'join' ? '2026-11-03T23:59:00' : '2026-11-04T00:00:01'));
      const h = loggerHarness({ realClock: true });
      await h.render();
      await h.appear();
      if (path === 'join') {
        await h.tab('photo');
        await act(async () => { h.captured.ai!.setDraft((draft) => ({ ...draft, hint: 'Late snack' })); });
      }
      vi.setSystemTime(new Date('2026-11-04T00:00:10'));
      await h.ask(atMs);
      expect(h.captured.context!.selectedKey).toBe('2026-11-03');
      expect(h.captured.context!.when).toMatchObject({ time: '23:59', groupId: '2026-11-03:snack' });
      if (path === 'join') expect(h.captured.ai!.draft.hint).toBe('Late snack');
      expect(h.refusePress).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

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
    expect(h.when).toHaveBeenLastCalledWith(null, '2026-11-03', [], null, expect.any(Date));
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
    expect(h.when).toHaveBeenLastCalledWith(null, params.day ?? '2026-11-03', [], params.group ?? null, null);
    const reads = h.loadSaved.mock.calls.length;
    await h.ask();
    // a fresh session (it reads Saved again as it mounts): today, no meal param, straight into the camera
    expect(h.loadSaved).toHaveBeenCalledTimes(reads + 1);
    expect(h.captured.context!.selectedKey).toBe('2026-11-03');
    expect(h.when).toHaveBeenCalledTimes(2);
    expect(h.when).toHaveBeenLastCalledWith(null, '2026-11-03', [], null, expect.any(Date));
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
    expect(edit.captured.foodReview?.food).toEqual(milk);
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
    await h.render();
    await h.appear();
    const { pickFoodPhoto } = h.imports['~/fuel/PhotoTab'] as { pickFoodPhoto: (source: 'camera' | 'library') => Promise<unknown> };
    let picking!: Promise<unknown>;
    await act(async () => { picking = pickFoodPhoto('camera'); });
    expect(h.cameraUp()).toBe(true);
    await h.ask();
    expect(h.refusePress).not.toHaveBeenCalled();
    expect(h.captured.picker!.selection).toBe('recent');
    expect(h.captured.ai!.cameraRequest).toBe(0);
    await h.press('Close');
    await expect(picking).resolves.toBeNull();
  });

  it('takes the photo on the worker’s Photo tab and analyzes it without a tap', async () => {
    const h = loggerHarness({ worker: true, params: { start: 'camera' } });
    await h.render();
    expect(h.captured.picker!.selection).toBe('photo');
    expect(h.openCamera).not.toHaveBeenCalled();
    await h.appear();
    await settle();
    expect(h.openCamera).toHaveBeenCalledExactlyOnceWith('/food-camera');
    expect(h.analyze).not.toHaveBeenCalled();
    await h.shoot();
    expect(h.cameraUp()).toBe(false);
    expect(h.captured.photo!.draft.photos).toEqual({ top: { uri: 'cam', width: 10, height: 10 } });
    expect(h.analyze).toHaveBeenCalledOnce();
    expect(h.announce).toHaveBeenCalledWith('Analyzing meal');
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
    expect(h.when).toHaveBeenLastCalledWith(null, '2026-11-03', [], 'g-lunch', expect.any(Date));
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
    // a save holds the tabs still (Manual would unmount mid-save), so a press can't switch them
    ['a save running', (h) => act(async () => { h.captured.context!.beginSave(); })],
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

  it('refuses while a description typed in Manual’s Describe with AI would be lost (worker)', async () => {
    // Only the worker's Manual has its own Describe: with Gemini it is the door beside Manual.
    const h = loggerHarness({ worker: true });
    await h.render();
    await h.appear();
    await h.tab('manual');
    await h.press('Describe a meal or food');
    await act(async () => { h.captured.inputs['Describe the food'].onChangeText!('two eggs and toast'); });
    await h.ask();
    expect(h.refusePress).toHaveBeenCalledOnce();
    expect(h.captured.picker!.selection).toBe('manual');
    // cleared again, the sheet holds nothing and takes the press
    await act(async () => { h.captured.inputs['Describe the food'].onChangeText!(' '); });
    await h.ask();
    expect(h.refusePress).toHaveBeenCalledOnce();
    expect(h.captured.picker!.selection).toBe('photo');
    expect(h.captured.photo!.cameraRequest).toBe(1);
  });

  it('opens Manual straight on its fields with Gemini, which describes through its own door', async () => {
    const h = loggerHarness();
    await h.render();
    await h.tab('manual');
    expect(h.text()).not.toContain('Describe with AI');
    expect(h.captured.buttons['Describe a meal or food']).toBeUndefined();
    expect(h.captured.fields.Name).toBeDefined();
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

  it('opens the camera straight from Add photo, with no choices asked first, and holds a press off while it is up', async () => {
    const h = loggerHarness({ worker: true });
    await h.render();
    await h.appear();
    await h.tab('photo');
    await h.press('Add top view photo');
    expect(h.captured.choices).toBeUndefined();
    expect(h.openCamera).toHaveBeenCalledOnce();
    await h.ask();
    expect(h.refusePress).not.toHaveBeenCalled();
    expect(h.captured.photo!.cameraRequest).toBe(0);
    // closed with nothing taken: the tab is as it was, and the next press opens the camera again
    await h.press('Close');
    await h.flush();
    expect(h.captured.photo!.draft.photos).toEqual({});
    expect(h.text()).not.toContain('Camera');
    await h.ask();
    await h.flush();
    expect(h.captured.photo!.cameraRequest).toBe(1);
    expect(h.openCamera).toHaveBeenCalledTimes(2);
    await h.shoot();
    expect(h.analyze).toHaveBeenCalledOnce();
  });

  it('offers to replace or remove a photo already there, and holds a press off while it asks', async () => {
    const h = loggerHarness({ worker: true });
    await h.render();
    await h.appear();
    await h.tab('photo');
    await h.press('Add top view photo');
    await h.shoot();
    expect(h.captured.photo!.draft.photos).toEqual({ top: { uri: 'cam', width: 10, height: 10 } });
    await h.press('Top view, meal photo added');
    expect(h.captured.choices!.options.options).toEqual(['Replace photo', 'Remove photo', 'Cancel']);
    await h.ask();
    expect(h.refusePress).not.toHaveBeenCalled();
    expect(h.captured.photo!.cameraRequest).toBe(0);
    // Replace photo: the same camera, whose library gives the new one
    await act(async () => { await h.captured.choices!.callback(0); });
    expect(h.openCamera).toHaveBeenCalledTimes(2);
    await h.press('Photo library');
    await h.flush();
    expect(h.library).toHaveBeenCalledOnce();
    expect(h.cameraUp()).toBe(false);
    expect(h.captured.photo!.draft.photos).toEqual({ top: { uri: 'lib', width: 12, height: 9 } });
    await h.press('Top view, meal photo added');
    await act(async () => { await h.captured.choices!.callback(1); });
    expect(h.captured.photo!.draft.photos).toEqual({});
    expect(h.openCamera).toHaveBeenCalledTimes(2);
  });

  it('adds a photo from the camera screen’s library on AI, and stays on the camera when the library is cancelled', async () => {
    const h = loggerHarness({ realAi: true });
    await h.render();
    await h.appear();
    await h.tab('photo');
    await h.press('Add photo');
    expect(h.captured.choices).toBeUndefined();
    expect(h.cameraUp()).toBe(true);
    h.library.mockResolvedValueOnce({ canceled: true, assets: [] });
    await h.press('Photo library');
    await h.flush();
    expect(h.cameraUp()).toBe(true);
    await h.press('Photo library');
    await h.flush();
    expect(h.cameraUp()).toBe(false);
    expect(h.captured.ai!.draft.photos).toEqual([{ uri: 'lib', width: 12, height: 9 }]);
    // Add photo again: the camera's shot, retaken once before it is used
    await h.press('Add photo');
    await act(async () => { h.captured.viewfinder!.onCameraReady!(); });
    h.shutter.mockResolvedValueOnce({ uri: 'blurry', width: 10, height: 10 });
    await h.press('Take photo');
    await h.flush();
    expect(h.captured.viewfinder).toMatchObject({ active: false });
    await h.press('Retake');
    await h.press('Take photo');
    await h.flush();
    await h.press('Use Photo');
    await h.flush();
    expect(h.shutter).toHaveBeenCalledTimes(2);
    expect(h.captured.ai!.draft.photos).toEqual([{ uri: 'lib', width: 12, height: 9 }, { uri: 'cam', width: 10, height: 10 }]);
    // two is the most: Add photo goes
    expect(h.captured.pressables['Add photo']).toBeUndefined();
  });

  it('goes back once when Close is pressed while a library photo is still arriving', async () => {
    const h = loggerHarness({ realAi: true });
    await h.render();
    await h.appear();
    await h.tab('photo');
    await h.press('Add photo');
    expect(h.cameraUp()).toBe(true);
    // The picker has gone; the photo it chose is still being read.
    const picked = deferred<PickerResult>();
    h.library.mockReturnValueOnce(picked.promise);
    await h.press('Photo library');
    await h.press('Close');
    expect(h.cameraUp()).toBe(false);
    await act(async () => { picked.resolve({ canceled: false, assets: [{ uri: 'late', width: 12, height: 9, type: 'image' }] }); });
    await h.flush();
    // Back from the camera only, never from Log food under it.
    expect(h.cameraBack).toHaveBeenCalledOnce();
    expect(h.captured.ai!.draft.photos).toEqual([]);
  });

  it('switches the flash for the shot', async () => {
    const h = loggerHarness({ worker: true, params: { start: 'camera' } });
    await h.render();
    await h.appear();
    await settle();
    expect(h.captured.viewfinder!.flash).toBe('off');
    expect(h.captured.pressables.Flash.accessibilityValue).toEqual({ text: 'Off' });
    await h.press('Flash');
    expect(h.captured.viewfinder!.flash).toBe('on');
    expect(h.captured.pressables.Flash.accessibilityValue).toEqual({ text: 'On' });
  });

  // The real camera screen behind a snap on the worker's Photo tab.
  it('says the camera isn’t available on the simulator, with the library still there', async () => {
    const h = loggerHarness({ worker: true, device: false, params: { start: 'camera' } });
    await h.render();
    await h.appear();
    await settle();
    expect(h.cameraUp()).toBe(true);
    expect(h.permission).not.toHaveBeenCalled();
    expect(h.captured.viewfinder).toBeUndefined();
    expect(h.cameraText()).toContain('The camera isn’t available here.');
    expect(h.captured.pressables['Take photo'].disabled).toBe(true);
    expect(h.captured.pressables['Open Settings']).toBeUndefined();
    // closed: the tab says why there was no photo
    await h.press('Close');
    await h.flush();
    expect(h.text()).toContain('The camera isn’t available here.');
    expect(h.captured.buttons['Open Settings']).toBeUndefined();
    expect(h.analyze).not.toHaveBeenCalled();
  });

  it('puts Choose from library right under the words when there is no camera, beside the library button', async () => {
    const h = loggerHarness({ worker: true, device: false, params: { start: 'camera' } });
    await h.render();
    await h.appear();
    await settle();
    expect(h.captured.pressables['Photo library']).toBeDefined();
    await h.press('Choose from library');
    await h.flush();
    expect(h.library).toHaveBeenCalledOnce();
    expect(h.cameraUp()).toBe(false);
    expect(h.captured.photo!.draft.photos).toEqual({ top: { uri: 'lib', width: 12, height: 9 } });
  });

  it('picks from the library on the simulator, and analyzes that photo', async () => {
    const h = loggerHarness({ worker: true, device: false, params: { start: 'camera' } });
    await h.render();
    await h.appear();
    await settle();
    await h.press('Photo library');
    await h.flush();
    expect(h.captured.photo!.draft.photos).toEqual({ top: { uri: 'lib', width: 12, height: 9 } });
    expect(h.analyze).toHaveBeenCalledOnce();
  });

  it('asks for camera access as it opens, and when refused says so with Open Settings and the library', async () => {
    const h = loggerHarness({ worker: true, params: { start: 'camera' } });
    h.readAccess.mockResolvedValueOnce({ granted: false, status: 'undetermined', canAskAgain: true });
    h.permission.mockResolvedValueOnce({ granted: false, status: 'denied', canAskAgain: false });
    await h.render();
    await h.appear();
    await settle();
    expect(h.permission).toHaveBeenCalledOnce();
    expect(h.captured.viewfinder).toBeUndefined();
    expect(h.cameraText()).toContain('Camera access is off');
    expect(h.captured.pressables['Photo library']).toBeDefined();
    expect(h.captured.pressables['Choose from library']).toBeDefined();
    expect(h.captured.pressables['Take photo'].disabled).toBe(true);
    await h.press('Open Settings');
    expect(h.openSettings).toHaveBeenCalledOnce();
    await h.press('Close');
    await h.flush();
    expect(h.text()).toContain('Camera access is off. Allow Camera for hyPer in Settings, then try again.');
    await h.click('Open Settings');
    expect(h.openSettings).toHaveBeenCalledTimes(2);
    expect(h.analyze).not.toHaveBeenCalled();
    const { foodPickerUp } = h.imports['~/fuel/PhotoTab'] as { foodPickerUp: () => boolean };
    expect(foodPickerUp()).toBe(false);
  });

  it('opens the camera at once when access was given before', async () => {
    const h = loggerHarness({ worker: true, params: { start: 'camera' } });
    await h.render();
    await h.appear();
    await settle();
    expect(h.permission).not.toHaveBeenCalled();
    expect(h.captured.viewfinder).toBeDefined();
    expect(h.captured.pressables['Take photo'].disabled).toBe(true);
    await act(async () => { h.captured.viewfinder!.onCameraReady!(); });
    expect(h.captured.pressables['Take photo'].disabled).toBe(false);
  });

  it('turns away a video from the library and stays on the camera', async () => {
    const h = loggerHarness({ worker: true, params: { start: 'camera' } });
    h.library.mockResolvedValueOnce({ canceled: false, assets: [{ uri: 'clip', width: 10, height: 10, type: 'video' }] });
    await h.render();
    await h.appear();
    await settle();
    await h.press('Photo library');
    await h.flush();
    expect(h.cameraUp()).toBe(true);
    expect(h.cameraText()).toContain('Please choose an image file.');
    expect(h.captured.photo!.draft.photos).toEqual({});
    expect(h.analyze).not.toHaveBeenCalled();
  });

  it('keeps the camera open with a note when the shot fails', async () => {
    const h = loggerHarness({ worker: true, params: { start: 'camera' } });
    h.shutter.mockRejectedValueOnce(new Error('capture failed'));
    await h.render();
    await h.appear();
    await settle();
    await act(async () => { h.captured.viewfinder!.onCameraReady!(); });
    await h.press('Take photo');
    await h.flush();
    expect(h.cameraUp()).toBe(true);
    expect(h.cameraText()).toContain('Couldn’t take the photo. Try again.');
    expect(h.announce).toHaveBeenCalledWith('Couldn’t take the photo. Try again.');
  });
});

describe('native food logger amounts and replacements', () => {
  it('logs comma decimals in Manual as typed, as the iOS decimal pad types them in many regions', async () => {
    const h = loggerHarness();
    await h.render();
    await h.tab('manual');
    await act(async () => {
      h.captured.fields.Name.onChangeText('Oats');
      h.captured.fields.Calories.onChangeText('150,5');
      h.captured.fields.Protein.onChangeText('5,5');
      h.captured.inputs['Exact servings'].onChangeText!('0,5');
    });
    await h.click('Log entry');
    expect(h.resolveFood).toHaveBeenCalledWith(expect.objectContaining({ values: expect.objectContaining({ calories: 150.5, protein: 5.5 }) }));
    expect(h.saveFood).toHaveBeenCalledWith(expect.objectContaining({ servings: 0.5 }));
  });

  it('takes a comma decimal as a meal ingredient amount', async () => {
    const h = loggerHarness({ savedMeal: true });
    await h.render();
    await act(async () => { h.captured.inputs['Amount of Milk, ml'].onChangeText!('150,5'); });
    await h.click('Save changes');
    const [draft] = h.saveMeal.mock.lastCall as unknown as [composition.MealDraft];
    expect(draft.ingredients[0].servings).toBeCloseTo(150.5 / 240);
  });

  it('saves a comma decimal from the saved meal editor', async () => {
    const h = loggerHarness();
    await h.render();
    await h.tab('saved');
    await act(async () => { h.captured.saved!.onEditSavedMeal(savedMilk); });
    await h.openSavedEditor();
    await act(async () => { h.captured.fields.Calories.onChangeText('130,5'); });
    await h.click('Save');
    expect(h.replaceSimple).toHaveBeenCalledWith('user-a', savedMilk.id, expect.objectContaining({ calories: 130.5 }));
  });

  // A barcode a failed edit could not give back is kept by replaceSavedMeal for that meal, so a retry only has to name the same meal.
  it('retries a failed saved meal edit on the same meal', async () => {
    const h = loggerHarness();
    await h.render();
    await h.tab('saved');
    await act(async () => { h.captured.saved!.onEditSavedMeal(savedMilk); });
    await h.openSavedEditor();
    await act(async () => { h.captured.fields.Calories.onChangeText('130'); });
    h.replaceSimple.mockResolvedValueOnce({ id: null, retireFailed: false });
    await h.click('Save');
    expect(h.back).not.toHaveBeenCalled();

    await h.click('Save');
    expect(h.replaceSimple).toHaveBeenLastCalledWith('user-a', savedMilk.id, expect.objectContaining({ calories: 130 }));
    expect(h.back).toHaveBeenCalledOnce();
  });

  it('retries a failed Update saved meal on the same meal, after a tab switch too', async () => {
    const h = loggerHarness();
    await h.render();
    await h.tab('manual');
    await act(async () => {
      h.captured.manual!.setDraft((draft) => ({
        ...draft,
        fields: { name: savedMilk.name, calories: '130', protein: '8', carbs: '12', fat: '5' },
        selectedSavedMealId: savedMilk.id,
      }));
    });
    h.replaceSimple.mockResolvedValueOnce({ id: null, retireFailed: false });
    await h.click('Update saved meal');
    expect(h.captured.manual!.draft.selectedSavedMealId).toBe(savedMilk.id);

    await h.tab('recent');
    await h.tab('manual');
    await h.click('Update saved meal');
    expect(h.replaceSimple).toHaveBeenLastCalledWith('user-a', savedMilk.id, expect.objectContaining({ calories: 130 }));
    expect(h.captured.manual!.draft.selectedSavedMealId).toBe(`replacement-${savedMilk.id}`);
  });

  it('keeps a meal picked while Update saved meal runs, so a later update cannot write that meal over the first', async () => {
    const h = loggerHarness();
    await h.render();
    await h.tab('manual');
    const pick = async (meal: Food, calories: string) => {
      await act(async () => {
        h.captured.manual!.setDraft((draft) => ({
          ...draft,
          fields: { name: meal.name, calories, protein: '8', carbs: '12', fat: '5' },
          selectedSavedMealId: meal.id,
        }));
      });
    };
    await pick(savedMilk, '130');
    const reply = deferred<{ id: string | null; retireFailed: boolean }>();
    h.replaceSimple.mockImplementationOnce(() => reply.promise);
    await h.click('Update saved meal');
    // Another saved meal is picked before the answer arrives.
    await pick(recipe, '200');
    await act(async () => { reply.resolve({ id: `replacement-${savedMilk.id}`, retireFailed: false }); });
    await h.flush();
    expect(h.captured.manual!.draft.selectedSavedMealId).toBe(recipe.id);
    expect(h.captured.manual!.draft.fields.calories).toBe('200');
  });

  it('refuses to put several photo foods into one edited entry, unless they log as one meal', async () => {
    localStorage.setItem(photoReview.COMBINE_MEAL_KEY, '0');
    const h = loggerHarness({ editing: true, worker: true });
    await h.render();
    await h.changeFood();
    await h.tab('photo');
    const plate = [photoItem, { ...photoItem, id: 'photo-oats', name: 'Oats' }];
    await act(async () => { h.captured.photo!.setDraft((draft) => ({ ...draft, items: plate })); });
    // each item would be written onto the same entry, so all but the last were lost
    expect(h.captured.buttons['Log 2 items'].disabled).toBe(true);
    expect(h.saveFood).not.toHaveBeenCalled();
    await h.close();

    localStorage.setItem(photoReview.COMBINE_MEAL_KEY, '1');
    await h.render();
    await h.changeFood();
    await h.tab('photo');
    await act(async () => { h.captured.photo!.setDraft((draft) => ({ ...draft, items: plate })); });
    expect(h.captured.buttons['Log 1 meal'].disabled).not.toBe(true);
  });

  it('never offers Update saved meal for a built meal picked in Manual, which would replace its recipe', async () => {
    const h = loggerHarness();
    await h.render();
    await h.tab('manual');
    const pick = async (meal: Food) => {
      await act(async () => {
        h.captured.manual!.setDraft((draft) => ({
          ...draft,
          fields: { name: meal.name, calories: '200', protein: '8', carbs: '12', fat: '5' },
          selectedSavedMealId: meal.id,
        }));
      });
    };
    await pick(recipe);
    expect(h.captured.buttons['Update saved meal']).toBeUndefined();
    await pick(savedMilk);
    expect(h.captured.buttons['Update saved meal']).toBeDefined();
  });
});

describe('native food logger holds the sheet while a save runs', () => {
  const oats: foodTrial.TrialFoodItem & { key: string } = {
    key: 'oats', name: 'Oats', quantity: 1, unit: 'cup', basisQuantity: 1, calories: 300, protein: 10, carbs: 50, fat: 5,
    evidence: 'estimate', notes: '', sourceIndexes: [], amountConfirmed: true,
  };
  const oatsResult = {
    provider: 'gemini', model: 'test', modelVersion: null, responseId: null, summary: 'Oats',
    clarification: null, items: [oats], sources: [], searchSuggestionsHtml: null, originalText: '',
  } as unknown as foodTrial.FoodTrialResult;

  it('ignores a close while a new Manual entry saves, then closes once it is logged', async () => {
    const h = loggerHarness();
    const write = deferred<void>();
    h.saveFood.mockReturnValueOnce(write.promise);
    await h.render();
    await h.tab('manual');
    await act(async () => { h.captured.fields.Name.onChangeText('Oats'); });
    await h.click('Log entry');
    // Asking "Discard this entry?" here would close the sheet while the entry still lands.
    expect(h.captured.guard).toMatchObject({ on: true, busy: true });
    await act(async () => { write.resolve(); });
    expect(h.back).toHaveBeenCalledOnce();
    expect(h.captured.guard!.on).toBe(false);
  });

  it('keeps a failed entry edit on screen with its error, and asks again only once the save is over', async () => {
    const h = loggerHarness({ editing: true });
    const write = deferred<void>();
    h.saveFood.mockReturnValueOnce(write.promise);
    await h.render();
    await h.changeFood();
    await act(async () => { h.captured.fields.Calories.onChangeText('140'); });
    await h.click('Save changes');
    expect(h.captured.guard).toMatchObject({ on: true, busy: true });
    await act(async () => { write.reject(new Error('offline')); });
    expect(h.back).not.toHaveBeenCalled();
    expect(h.text()).toContain('Not logged. Try again.');
    expect(h.captured.guard).toMatchObject({ on: true, busy: false, message: { title: 'Discard your changes?' } });
  });

  it('holds a reviewed food while it logs, with Back off, and shows a failure instead of closing', async () => {
    const h = loggerHarness({ realReview: true });
    const write = deferred<void>();
    h.saveFood.mockReturnValueOnce(write.promise);
    await h.render();
    expect(h.captured.guard!.on).toBe(false);
    await act(async () => { h.captured.context!.chooseFood(milk); });
    await h.click('Log entry');
    expect(h.captured.guard).toMatchObject({ on: true, busy: true });
    expect(h.captured.buttons.Back.disabled).toBe(true);
    await act(async () => { write.reject(new Error('offline')); });
    expect(h.back).not.toHaveBeenCalled();
    expect(h.text()).toContain('Not logged. Try again.');
    expect(h.captured.foodReview!.food).toEqual(milk);
    // Nothing is left unsaved, so the sheet closes freely again.
    expect(h.captured.guard!.on).toBe(false);
    expect(h.captured.buttons.Back.disabled).toBe(false);
  });

  it('holds the sheet while an AI estimate logs', async () => {
    const h = loggerHarness({ realAi: true });
    const write = deferred<void>();
    h.saveFood.mockReturnValueOnce(write.promise);
    await h.render();
    await act(async () => { h.captured.ai!.setDraft((draft) => ({ ...draft, hint: 'a cup of oats', result: oatsResult, items: [oats] })); });
    await h.click('Log meal');
    expect(h.captured.guard).toMatchObject({ on: true, busy: true });
    await act(async () => { write.resolve(); });
    expect(h.back).toHaveBeenCalledOnce();
    expect(h.captured.guard!.on).toBe(false);
  });

  it('holds the sheet while a photo plate logs', async () => {
    const h = loggerHarness({ worker: true });
    const write = deferred<void>();
    h.saveFood.mockReturnValueOnce(write.promise);
    await h.render();
    await h.tab('photo');
    await act(async () => { h.captured.photo!.setDraft((draft) => ({ ...draft, items: [photoItem] })); });
    await h.click('Log 1 item');
    expect(h.captured.guard).toMatchObject({ on: true, busy: true });
    await act(async () => { write.resolve(); });
    expect(h.back).toHaveBeenCalledOnce();
  });

  it('holds the sheet while a built meal saves', async () => {
    const h = loggerHarness({ savedMeal: true });
    const write = deferred<void>();
    h.saveMeal.mockReturnValueOnce(write.promise);
    await h.render();
    await h.click('Save changes');
    expect(h.captured.guard).toMatchObject({ on: true, busy: true });
    await act(async () => { write.resolve(); });
    expect(h.back).toHaveBeenCalledOnce();
  });

  it('keeps a save holding the sheet when a lookup ends meanwhile', async () => {
    const h = loggerHarness();
    const write = deferred<void>();
    h.saveFood.mockReturnValueOnce(write.promise);
    await h.render();
    await h.tab('manual');
    let lookup!: () => void;
    await act(async () => { lookup = h.captured.context!.beginBusy(); });
    await act(async () => { h.captured.fields.Name.onChangeText('Oats'); });
    await h.click('Log entry');
    await act(async () => { lookup(); });
    expect(h.captured.guard).toMatchObject({ on: true, busy: true });
    await act(async () => { write.resolve(); });
    expect(h.captured.guard!.on).toBe(false);
  });

  it('offers no Discard or Add while a built meal checks its meal, and logs it once', async () => {
    const h = loggerHarness();
    const read = deferred<{ groupId: string | null; mealType: 'lunch' | null }>();
    h.resolveDestination.mockReturnValueOnce(read.promise);
    await h.render();
    await h.click('Build a meal');
    await act(async () => { h.captured.context!.addIngredients([composition.createMealIngredient(milk, 1)]); });
    await h.click('Review meal');
    await act(async () => { h.captured.review!.update({ name: 'Milk meal', groupId: 'lunch' }); });
    expect(h.captured.sections.Ingredients.action?.title).toBe('Add');
    // A Discard alert opened just before the save.
    await act(async () => { h.captured.pressables.Discard.onPress!(); });
    const [, , buttons] = h.alert.mock.lastCall as unknown as [string, string, AlertButton[]];
    await h.click('Log meal');
    expect(h.resolveDestination).toHaveBeenCalledOnce();
    expect(h.captured.guard).toMatchObject({ on: true, busy: true });
    expect(h.captured.pressables.Discard).toBeUndefined();
    expect(h.captured.sections.Ingredients.action).toBeUndefined();
    await act(async () => { buttons.find((button) => button.text === 'Discard')!.onPress!(); });
    // The meal being saved is not cleared from under its save.
    expect(composition.loadMealDraft('user-a', 'new')?.name).toBe('Milk meal');
    await act(async () => { read.resolve({ groupId: 'lunch', mealType: 'lunch' }); });
    expect(h.saveMeal).toHaveBeenCalledOnce();
    expect(h.saveMeal).toHaveBeenCalledWith(expect.objectContaining({ name: 'Milk meal' }), 'user-a', expect.objectContaining({ mealType: 'lunch' }));
    expect(h.back).toHaveBeenCalledOnce();
  });

  it('keeps Manual on screen while its entry saves, so a failure is not lost on another tab', async () => {
    const h = loggerHarness();
    const write = deferred<void>();
    h.saveFood.mockReturnValueOnce(write.promise);
    await h.render();
    // Build a meal shows on Recent and Saved only, so Manual offers no way into a meal mid-save.
    delete h.captured.buttons['Build a meal'];
    await h.tab('manual');
    await act(async () => { h.captured.fields.Name.onChangeText('Oats'); });
    await h.click('Log entry');
    // Another tab would unmount Manual with its error and retry-safe ids.
    expect(h.captured.picker!.disabled).toBe(true);
    expect(h.captured.buttons['Build a meal']).toBeUndefined();
    await act(async () => { h.captured.manual!.onGeminiHandoff!('a cup of oats'); });
    expect(h.captured.picker!.selection).toBe('manual');
    await act(async () => { write.reject(new Error('offline')); });
    expect(h.text()).toContain('Not logged. Try again.');
    expect(h.captured.picker!.disabled).toBe(false);
    await h.tab('recent');
    expect(h.captured.picker!.selection).toBe('recent');
    expect(h.captured.buttons['Build a meal'].disabled).toBe(false);
  });
});

describe('Snap a meal over a quick add that was not confirmed', () => {
  it('refuses, so the sheet keeps the failed save and its retry', async () => {
    const h = loggerHarness({ realLists: true });
    h.persistEntry.mockImplementationOnce(async () => { throw new Error('response lost'); });
    await h.render();
    await h.appear();
    await act(async () => { h.captured.pressables['Add Milk'].onPress!(); });
    expect(h.text()).toContain("Couldn't confirm. Tap + to try again.");
    await h.ask();
    expect(h.refusePress).toHaveBeenCalledOnce();
    expect(h.captured.picker!.selection).toBe('recent');
    expect(h.captured.ai!.cameraRequest).toBe(0);
    expect(h.text()).toContain("Couldn't confirm. Tap + to try again.");
  });
});

describe('real Recent and Saved quick-add', () => {
  it('refreshes the shown food and quick-add after its nutrition changes without a log changing', async () => {
    const oldLog = { ...loggedMilk, food_id: milk.id };
    const editedFood = { ...milk, calories: 180, protein: 12, carbs: 18, fat: 7 };
    const readRecent = vi.fn<typeof recentFoods.loadRecentLogs>()
      .mockResolvedValueOnce({ logs: [oldLog], error: null })
      .mockResolvedValue({ logs: [{ ...oldLog, food: editedFood }], error: null });
    const h = loggerHarness({ realLists: true, readRecent });
    await h.render();
    expect(h.text()).toContain('120');
    await h.close();
    await h.render();
    expect(readRecent).toHaveBeenCalledTimes(2);
    expect(h.text()).toContain('180');
    expect(h.text()).not.toContain('120');
    await h.press('Add Milk');
    expect(h.ensureFood).toHaveBeenCalledWith(editedFood);
    expect(h.persistEntry).toHaveBeenCalledWith(expect.objectContaining({ food_id: 'food-row', servings: 1 }), undefined, expect.any(String));
    expect(oldLog.food.calories).toBe(120);
  });

  it.each(['recent', 'saved'])('holds %s while writing and preserves a failed retry across tabs', async (tab) => {
    const h = loggerHarness({ realLists: true });
    const response = deferred<void>();
    h.persistEntry.mockImplementationOnce(async (payload, _editingId, retryId) => {
      // The server committed, but its response never reached the app.
      h.entries.set(retryId!, payload);
      await response.promise;
    });
    await h.render();
    if (tab === 'saved') await h.tab(tab);
    await act(async () => { h.captured.pressables['Add Milk'].onPress!(); });
    expect(h.persistEntry).toHaveBeenCalledOnce();
    expect(h.captured.guard).toMatchObject({ on: true, busy: true });
    expect(h.captured.picker!.disabled).toBe(true);
    // the list's way to make something holds still too
    expect(h.captured.buttons[tab === 'saved' ? 'New saved meal' : 'Build a meal'].disabled).toBe(true);
    await act(async () => {
      h.captured.picker!.onSelectionChange('manual');
      h.captured.context!.chooseFood(milk);
    });
    expect(h.captured.picker!.selection).toBe(tab);
    expect(h.captured.foodReview).toBeUndefined();
    await act(async () => { response.reject(new Error('response lost')); });
    expect(h.text()).toContain("Couldn't confirm. Tap + to try again.");
    expect(h.captured.guard).toMatchObject({ on: true, busy: false });
    await h.tab('manual');
    await h.tab(tab);
    expect(h.text()).toContain("Couldn't confirm. Tap + to try again.");
    await act(async () => { h.captured.pressables['Add Milk'].onPress!(); });
    expect(h.persistEntry).toHaveBeenCalledTimes(2);
    expect(h.persistEntry.mock.calls[1][2]).toBe(h.persistEntry.mock.calls[0][2]);
    expect(h.entries.size).toBe(1);
    expect(h.text()).toContain('Added');
    expect(h.captured.guard).toMatchObject({ on: false, busy: false });
    expect(h.captured.picker!.disabled).toBe(false);
    // A confirmed log must not stop this food being added to a new meal.
    if (tab === 'saved') await h.tab('recent');
    await h.click('Build a meal');
    expect(h.captured.pressables['Add Milk'].disabled).not.toBe(true);
    await act(async () => { h.captured.pressables['Add Milk'].onPress!(); });
    expect(h.text()).toContain('1 ingredient');
    expect(h.persistEntry).toHaveBeenCalledTimes(2);
  });
});


describe('quick add: each food to the meal it went to', () => {
  const lunch: NutritionGroup = { id: 'lunch', user_id: 'user-a', date: '2026-11-03', kind: 'meal', label: 'lunch', sort_order: 1 };
  type Harness = ReturnType<typeof loggerHarness>;
  /** Changes the destination from the line under the title: 0 is No meal, then the day's meals. */
  const sendTo = async (h: Harness, line: string, index: number) => {
    await h.press(`${line}. Change`);
    await act(async () => { await h.captured.choices!.callback(index); });
  };

  it('ticks a food for the meal it went to only, and adds it to another meal as its own entry', async () => {
    const h = loggerHarness({ realLists: true, dayGroups: [lunch] });
    await h.render();
    await h.press('Add Milk');
    expect(h.captured.pressables['Milk added. Take it out']).toBeDefined();
    await sendTo(h, 'Adds to today', 1);
    expect(h.text()).toContain('Adds to Lunch');
    expect(h.text()).not.toContain('Added');
    expect(h.captured.pressables['Milk added. Take it out']).toBeUndefined();
    expect(h.captured.pressables['Add Milk'].disabled).not.toBe(true);
    await h.press('Add Milk');
    expect(h.persistEntry).toHaveBeenCalledTimes(2);
    const [first, second] = h.persistEntry.mock.calls;
    expect(first[0]).toMatchObject({ group_id: null });
    expect(second[0]).toMatchObject({ group_id: 'lunch' });
    expect(second[2]).not.toBe(first[2]);
    expect(h.entries.size).toBe(2);
    // Back where it first went: still done, and it can't go there twice.
    await sendTo(h, 'Adds to Lunch', 0);
    expect(h.captured.pressables['Milk added. Take it out']).toBeDefined();
    expect(h.persistEntry).toHaveBeenCalledTimes(2);
  });

  it('takes a quick add back out with a tap on its tick, and the + returns', async () => {
    const h = loggerHarness({ realLists: true });
    await h.render();
    await h.press('Add Milk');
    const written = h.persistEntry.mock.calls[0][2];
    await h.press('Milk added. Take it out');
    const fuel = (h.imports['~/lib/fuel'] as { useFuelStore: { getState: () => { deleteEntry: ReturnType<typeof vi.fn> } } }).useFuelStore.getState();
    // The entry the + wrote, by the id it wrote under.
    expect(written).toBeTruthy();
    expect(fuel.deleteEntry).toHaveBeenCalledWith(written);
    expect(h.captured.pressables['Add Milk']).toBeDefined();
    expect(h.persistEntry).toHaveBeenCalledTimes(1);
  });

  /** The food row's VoiceOver actions (its hold menu's and swipe's), and a way to run one. */
  const rowActions = (h: Harness, food: string) => {
    const [, row] = savedRow(h, food);
    const actions = row.accessibilityActions ?? [];
    return {
      labels: actions.map((action) => action.label),
      run: (label: string) => {
        const action = actions.find((candidate) => candidate.label === label)!;
        return act(async () => { row.onAccessibilityAction!({ nativeEvent: { actionName: action.name } }); });
      },
    };
  };
  const deleteEntryOf = (h: Harness) =>
    (h.imports['~/lib/fuel'] as { useFuelStore: { getState: () => { deleteEntry: ReturnType<typeof vi.fn> } } }).useFuelStore.getState().deleteEntry;

  it.each([['recent', 'Log 240 ml now'], ['saved', 'Log one serving now']])('offers %s’s Log only until the food is added, then Take it out, and Log never removes it', async (tab, log) => {
    const h = loggerHarness({ realLists: true, rowActions: true });
    await h.render();
    if (tab === 'saved') await h.tab(tab);
    const before = rowActions(h, 'Milk');
    expect(before.labels).toContain(log);
    expect(before.labels).not.toContain('Take it out');
    await before.run(log);
    expect(h.persistEntry).toHaveBeenCalledOnce();
    const written = h.persistEntry.mock.calls[0][2];

    const added = rowActions(h, 'Milk');
    expect(added.labels).not.toContain(log);
    expect(added.labels).toContain('Take it out');
    // A Log from a menu drawn before the add (still open) logs nothing and removes nothing.
    await before.run(log);
    expect(deleteEntryOf(h)).not.toHaveBeenCalled();
    expect(h.persistEntry).toHaveBeenCalledOnce();
    expect(h.text()).toContain('Added');

    await added.run('Take it out');
    expect(deleteEntryOf(h)).toHaveBeenCalledWith(written);
    expect(rowActions(h, 'Milk').labels).toContain(log);
    expect(h.captured.pressables['Add Milk']).toBeDefined();
  });

  it('logs nothing while a removal is on its way, so its answer can’t clear a new entry’s tick', async () => {
    const h = loggerHarness({ realLists: true, rowActions: true });
    await h.render();
    const removal = deferred<boolean>();
    deleteEntryOf(h).mockImplementationOnce(() => removal.promise);
    const log = rowActions(h, 'Milk');
    await h.press('Add Milk');
    await act(async () => { h.captured.pressables['Milk added. Take it out'].onPress!(); });
    expect(deleteEntryOf(h)).toHaveBeenCalledOnce();

    // A Log from an older menu writes nothing meanwhile, and the menu offers neither Log nor Take it out.
    await log.run('Log 240 ml now');
    expect(h.persistEntry).toHaveBeenCalledOnce();
    const removing = rowActions(h, 'Milk');
    expect(removing.labels).not.toContain('Log 240 ml now');
    expect(removing.labels).not.toContain('Take it out');

    await act(async () => { removal.resolve(true); });
    expect(h.captured.pressables['Add Milk']).toBeDefined();
    expect(h.text()).not.toContain('Added');
    // Logged again afterwards, it is a new entry of its own.
    await h.press('Add Milk');
    expect(h.persistEntry).toHaveBeenCalledTimes(2);
    expect(h.persistEntry.mock.calls[1][2]).not.toBe(h.persistEntry.mock.calls[0][2]);
  });

  it('takes one write for a second tap that lands before the row redraws', async () => {
    const h = loggerHarness({ realLists: true });
    const response = deferred<void>();
    h.persistEntry.mockImplementationOnce(async (payload, _editingId, retryId) => {
      h.entries.set(retryId!, payload);
      await response.promise;
    });
    await h.render();
    const plus = h.captured.pressables['Add Milk'];
    await act(async () => { plus.onPress!(); plus.onPress!(); });
    await h.flush();
    expect(h.persistEntry).toHaveBeenCalledOnce();
    await act(async () => { response.resolve(); });
    expect(h.text()).toContain('Added');
    expect(h.entries.size).toBe(1);
  });

  it('says only what is known after a failed add, and retries it as the entry it first sent', async () => {
    const h = loggerHarness({ realLists: true, dayGroups: [lunch] });
    h.persistEntry.mockImplementationOnce(async () => { throw new Error('response lost'); });
    await h.render();
    await h.press('Add Milk');
    expect(h.text()).toContain("Couldn't confirm. Tap + to try again.");
    expect(h.text()).not.toContain('Not saved');
    expect(h.captured.pressables["Milk, Couldn't confirm. Use Add to try again., 120 kcal"]).toBeDefined();
    expect(h.announce).toHaveBeenCalledWith("Couldn't confirm Milk");
    // The way out says the same: it may be logged, and + tries again.
    expect(h.captured.guard).toMatchObject({
      on: true,
      message: { title: 'Leave without confirming?', message: "A food couldn't be confirmed and may already be in your log. Tap its + to try again." },
    });
    // Another meal is a new add; the unconfirmed one waits under its own.
    await sendTo(h, 'Adds to today', 1);
    expect(h.text()).not.toContain("Couldn't confirm");
    expect(h.captured.guard!.on).toBe(true);
    await sendTo(h, 'Adds to Lunch', 0);
    expect(h.text()).toContain("Couldn't confirm. Tap + to try again.");
    // A time changed since doesn't move the entry the retry confirms.
    const sheet = () => h.captured.context as unknown as { when: { date: Date; time: string; groupId: string | null }; setWhen: (when: object) => void };
    await act(async () => { sheet().setWhen({ ...sheet().when, time: '12:30' }); });
    await h.press('Add Milk');
    expect(h.persistEntry).toHaveBeenCalledTimes(2);
    const [first, retry] = h.persistEntry.mock.calls;
    expect(retry[2]).toBe(first[2]);
    expect(retry[0]).toEqual(first[0]);
    expect(h.entries.size).toBe(1);
    expect(h.text()).toContain('Added');
    expect(h.captured.guard!.on).toBe(false);
  });
});

describe('Log food lists: one header each, no column label', () => {
  it('labels no kcal column over Recent', async () => {
    const h = loggerHarness({ realLists: true });
    await h.render();
    expect(h.text()).toContain('Milk');
    expect(h.text()).toContain('120');
    expect(h.text()).not.toContain('kcal');
  });

  it('gives Saved no Edit mode: the list, then New saved meal', async () => {
    const h = loggerHarness({ realLists: true });
    await h.render();
    await h.tab('saved');
    expect(h.text()).toContain('Protein shake');
    expect(h.text()).toContain('Milk');
    for (const name of ['Edit', 'Done', 'New', 'Delete Milk', 'Delete Protein shake']) expect(h.captured.pressables[name]).toBeUndefined();
    expect(h.text()).not.toContain('Edit');
    expect(h.captured.buttons['New saved meal']).toBeDefined();
    // a tap on a meal opens it to log, never to edit
    await act(async () => { savedRow(h, 'Milk')[1].onPress!(); });
    expect(h.captured.foodReview?.food.id).toBe(savedMilk.id);
    expect(h.push).not.toHaveBeenCalled();
  });

  it('still offers each saved meal’s Edit and Delete to VoiceOver, as its swipe and hold do', async () => {
    const h = loggerHarness({ realLists: true, rowActions: true });
    await h.render();
    await h.tab('saved');
    for (const meal of ['Milk', 'Protein shake']) {
      const labels = (savedRow(h, meal)[1].accessibilityActions ?? []).map((action) => action.label);
      // the hold menu's items, and the swipe's Edit (its Delete is the menu's)
      expect(labels).toEqual(expect.arrayContaining(['Review and log', 'Edit saved meal', 'Delete', 'Edit']));
      expect(labels.filter((label) => label === 'Delete')).toHaveLength(1);
    }
    const act11y = (meal: string, label: string) => {
      const [, row] = savedRow(h, meal);
      const action = row.accessibilityActions!.find((candidate) => candidate.label === label)!;
      return act(async () => { row.onAccessibilityAction!({ nativeEvent: { actionName: action.name } }); });
    };
    // Edit opens the saved food's own editor; a built meal opens in its builder
    await act11y('Milk', 'Edit');
    expect(h.push).toHaveBeenCalledWith({ pathname: '/saved-meal', params: { id: savedMilk.id } });
    await act11y('Milk', 'Edit saved meal');
    expect(h.push).toHaveBeenCalledTimes(2);
    // Delete takes the meal out at once, as a swipe does
    await act11y('Milk', 'Delete');
    await h.flush();
    expect(h.retire).toHaveBeenCalledWith('user-a', savedMilk.id);
    expect(h.alert).not.toHaveBeenCalled();
    expect(savedRow(h, 'Milk', false)).toBeUndefined();
    await act11y('Protein shake', 'Edit');
    expect(h.text()).toContain('Edit saved meal');
  });
});

/** A saved meal's row as VoiceOver names it ("Milk, 240 ml · 8 g protein, 120 kcal"). */
function savedRow(h: ReturnType<typeof loggerHarness>, meal: string, present = true): [string, Press] {
  const found = Object.entries(h.captured.pressables).find(([name]) => name.startsWith(`${meal}, `));
  if (present) expect(found).toBeDefined();
  return found!;
}

describe('Log food: the pinned head', () => {
  /** Whether an element tree holds a component of this type. */
  const holds = (node: ReactNode, type: unknown): boolean =>
    Children.toArray(node).some((child) => isValidElement<PropsWithChildren>(child) && (child.type === type || holds(child.props.children, type)));
  /** The scroll view's children as React Native lays them out (empty ones dropped), and the one it pins. */
  const head = (h: ReturnType<typeof loggerHarness>) => {
    const scroll = h.captured.scroll!;
    const children = Children.toArray(scroll.children);
    expect(scroll.stickyHeaderIndices).toEqual([0]);
    const parts = (node: ReactNode) => ({
      search: holds(node, (h.imports['~/fuel/FoodLists'] as NativeModule).SearchField),
      segments: holds(node, (h.imports['@expo/ui/swift-ui'] as NativeModule).Picker),
      methods: holds(node, (h.imports['~/fuel/EntryMethods'] as NativeModule).EntryMethods),
      reviewMeal: holds(node, (h.imports['~/components/Capsule'] as NativeModule).Capsule),
    });
    return { pinned: parts(children[0]), title: textOf(children[0]), next: parts(children[1]) };
  };

  it('pins the title, Search foods, Recent | Saved and the entry methods at the standard sizes', async () => {
    const h = loggerHarness();
    await h.render();
    const { pinned, title, next } = head(h);
    expect(title).toContain('Log food');
    expect(title).toContain('Adds to today');
    expect(pinned).toEqual({ search: true, segments: true, methods: true, reviewMeal: false });
    expect(next).toEqual({ search: false, segments: false, methods: false, reviewMeal: false });
    await h.click('Build a meal');
    expect(head(h).pinned).toEqual({ search: true, segments: true, methods: true, reviewMeal: true });
  });

  it('pins only the title and Search foods at the accessibility sizes; the lists, methods and meal line scroll', async () => {
    const h = loggerHarness({ large: true });
    await h.render();
    const { pinned, title, next } = head(h);
    expect(title).toContain('Log food');
    expect(title).toContain('Adds to today');
    expect(title).not.toContain('Recent');
    expect(pinned).toEqual({ search: true, segments: false, methods: false, reviewMeal: false });
    // right under the pinned head, before the list they open
    expect(next).toEqual({ search: false, segments: true, methods: true, reviewMeal: false });
    // they still work from there
    await h.tab('manual');
    expect(h.captured.manual).toBeDefined();
    await h.tab('recent');
    await h.click('Build a meal');
    expect(head(h).pinned).toEqual({ search: true, segments: false, methods: false, reviewMeal: false });
    expect(head(h).next).toEqual({ search: false, segments: true, methods: true, reviewMeal: true });
    // while searching only the field shows, still pinned, with the meal line under it
    await h.search('milk');
    expect(head(h).pinned).toEqual({ search: true, segments: false, methods: false, reviewMeal: false });
    expect(head(h).next).toEqual({ search: false, segments: false, methods: false, reviewMeal: true });
  });

  it('adds no unpinned head at the accessibility sizes when nothing goes in it', async () => {
    const h = loggerHarness({ large: true });
    await h.render();
    await h.search('milk');
    const children = Children.toArray(h.captured.scroll!.children);
    expect(holds(children[0], (h.imports['~/fuel/FoodLists'] as NativeModule).SearchField)).toBe(true);
    // the results come straight after the pinned head
    expect(holds(children[1], (h.imports['~/fuel/FoodLists'] as NativeModule).SearchTab)).toBe(true);
  });
});


describe('food writes invalidate old reminder totals', () => {
  it.each(['log', 'edit', 'quick-add', 'built meal'])('keeps %s successful but blocks stale reminders when its refresh fails', async (path) => {
    const real = nativeFuelStore('user-a');
    real.read.mockResolvedValue({ data: [{ ...loggedMilk, user_id: 'user-a', food_id: loggedMilk.food.id }], error: null });
    await real.useFuelStore.getState().loadToday('2026-11-03');
    expect(real.useFuelStore.getState().totalsNeedRefresh).toBe(false);
    real.read.mockResolvedValue({ data: null, error: new Error('offline') });
    const h = loggerHarness({ editing: path === 'edit', realLists: path === 'quick-add', fuelActions: real.useFuelStore.getState() });
    await h.render();
    if (path === 'quick-add') {
      await act(async () => { h.captured.pressables['Add Milk'].onPress!(); });
      expect(h.persistEntry).toHaveBeenCalledOnce();
      expect(h.text()).toContain('Added');
    } else if (path === 'built meal') {
      await h.click('Build a meal');
      await act(async () => { h.captured.context!.addIngredients([composition.createMealIngredient(milk, 1)]); });
      await h.click('Review meal');
      await act(async () => { h.captured.review!.update({ name: 'Milk meal' }); });
      await h.click('Log meal');
      expect(h.saveMeal).toHaveBeenCalledOnce();
      expect(h.back).toHaveBeenCalledOnce();
    } else {
      if (path === 'log') await h.tab('manual');
      if (path === 'edit') await h.changeFood();
      await act(async () => { h.captured.fields.Name.onChangeText('Milk'); });
      await h.click(path === 'edit' ? 'Save changes' : 'Log entry');
      expect(h.saveFood).toHaveBeenCalledOnce();
      expect(h.back).toHaveBeenCalledOnce();
    }
    expect(real.useFuelStore.getState().totalsNeedRefresh).toBe(true);
    expect(real.useFuelStore.getState().todayTotals.calories).toBeGreaterThan(0);
  });
});
