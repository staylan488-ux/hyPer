import { Host, Picker, Text as SwiftText } from '@expo/ui/swift-ui';
import { disabled, pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { format, isToday } from 'date-fns';
import { router, useFocusEffect, useLocalSearchParams, useNavigation, type NativeStackNavigationProp } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ActionSheetIOS, Alert, Keyboard, Pressable, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

import { toLocalTimeInput } from '@/lib/foodLoggerUtils';
import { getCompatibleMeasurementUnits } from '@/lib/foodUnits';
import {
  clearMealDraft,
  decodeMealComposition,
  expandMealIngredients,
  getMealTotals,
  loadMealDraft,
  saveMealDraft,
  scaleMealIngredients,
  type MealDraft,
  type MealIngredient,
} from '@/lib/mealComposition';
import { getFoodAnalysisMode } from '@/lib/foodTrial';
import { NO_MEAL, nutritionGroupTitle } from '@/lib/nutritionGroups';
import { readSavedFoodsCache, writeSavedFoodsCache } from '@/lib/savedFoodsCache';
import { mealFromLoggedFoods } from '@/lib/savedMealFromLog';
import { loadSavedMeals } from '@/lib/savedMeals';
import { getSessionUserId } from '@/lib/sessionUser';
import { useAuthStore } from '@/stores/authStore';
import type { Food, NutritionGroup } from '@/types';
import { BlancText } from '~/components/BlancText';
import { Capsule } from '~/components/Capsule';
import { GlassButton } from '~/components/GlassButton';
import { Label } from '~/components/Label';
import { RollingText } from '~/components/RollingText';
import { Row } from '~/components/Row';
import { dismissOpenSwipeRow } from '~/components/SwipeRow';
import { announce, useLargeText } from '~/lib/accessibility';
import { formatWhole } from '~/lib/format';
import { initialWhen, usesDayGroups, type When } from '~/lib/foodLogger';
import { groupsForDay, loadDayGroups, suggestedGroup, today, useFuelStore, useTodayKey, type FoodLog } from '~/lib/fuel';
import { haptics } from '~/lib/haptics';
import { refusePress } from '~/lib/launch';
import { sheetSnap, snapMealDate, useLaunchStore } from '~/lib/launchActions';
import { useLeaveGuard } from '~/lib/leaveGuard';
import { loadYouMeals, useYouMealsStore } from '~/lib/you';
import { LoggerContext, type AddedQuickAdd, type ChosenMeta, type LoggerContextValue, type PendingQuickAdd, type QuickAddState } from '~/fuel/context';
import { Empty, SavedTab, SearchField, SearchTab } from '~/fuel/FoodLists';
import { FoodReview } from '~/fuel/FoodReview';
import { EntryMethods, type EntryMethod } from '~/fuel/EntryMethods';
import { emptyManual, manualFromFood, manualHasChanges, ManualTab, type ManualDraft } from '~/fuel/ManualTab';
import { MealReview } from '~/fuel/MealReview';
import { aiHasDraft, AiTab, aiTakesPhoto, emptyAi, type AiDraft } from '~/fuel/AiTab';
import { emptyPhoto, foodPickerUp, PhotoTab, photoTakesPhoto, type PhotoDraft } from '~/fuel/PhotoTab';
import { RecentTab } from '~/fuel/RecentTab';
import { ScanTab } from '~/fuel/ScanTab';
import { useBlanc } from '~/theme/blanc';

type Tab = 'recent' | 'saved' | 'search' | 'scan' | 'manual' | 'photo';
/** Recent and Saved are the segments' lists to pick from; Scan, Manual and Photo/Describe are ways to enter a food. */
type BrowseTab = 'recent' | 'saved';
const isBrowse = (tab: Tab): tab is BrowseTab => tab === 'recent' || tab === 'saved';
/** Search foods takes the sheet over from the field above the segments: neither a segment nor an entry method. */
const isList = (tab: Tab): tab is BrowseTab | 'search' => isBrowse(tab) || tab === 'search';
/** The segmented control's value while an entry method shows: no segment has it, so none is chosen. */
const NO_LIST = 'none';

/** The destination line's reach past its 18-point footnote line: 44 points tall to touch, and 16 more each side. */
const DESTINATION_REACH = { vertical: 13, horizontal: 16 } as const;

/** Fuel's alert for a write that did not go through, as its own report() says it. */
const CHECK_CONNECTION = 'Check your connection and try again.';

/** A meal's ingredients and amounts, to tell whether it changed. */
const mealPartsKey = (draft: MealDraft) => draft.ingredients.map((part) => `${part.id}:${part.servings}`).join('|');

/**
 * A new entry today goes to the meal that fits the clock; on another day the
 * clock says nothing about the meal, so it starts in no meal.
 * A Snap press supplies the clock and day it actually happened on.
 */
const suggestFor = (selectedKey: string, list: NutritionGroup[], pressedAt: Date | null = null) =>
  (selectedKey === (pressedAt ? format(pressedAt, 'yyyy-MM-dd') : today()) ? suggestedGroup(list, pressedAt ?? undefined)?.id ?? null : null);

/** The same groups as far as the sheet reads them (destination, labels, order). */
const sameGroups = (a: NutritionGroup[], b: NutritionGroup[]) =>
  a.length === b.length &&
  a.every((group, index) => {
    const other = b[index];
    return group.id === other.id && group.date === other.date && group.kind === other.kind && group.label === other.label && group.sort_order === other.sort_order;
  });

/** The same saved foods, field for field, in the same order. */
const sameFoods = (a: Food[], b: Food[]) => a.length === b.length && JSON.stringify(a) === JSON.stringify(b);

/** Claims that owners take and let go of: each cleanup releases only its own claim, once. */
function useClaims(): [number, () => () => void] {
  const [claims, setClaims] = useState(0);
  const begin = useCallback(() => {
    setClaims((count) => count + 1);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      setClaims((count) => count - 1);
    };
  }, []);
  return [claims, begin];
}

/**
 * Log food, or edit an entry: Search foods (USDA) above Recent and Saved to
 * pick from; Barcode, Manual, Photo and Describe (Photo alone on the worker)
 * to enter a food; a review for a chosen food, and the meal builder.
 * Params: `entry` (an entry id to edit), `day` (yyyy-MM-dd, default today),
 * `group` (the meal to add to), `savedMeal` (a built saved meal to change),
 * `saveEntries` (comma-separated logged entries to keep as a new saved meal),
 * `newSavedMeal=1` (an empty meal to build and keep as a saved meal, nothing logged),
 * `start=camera`, `atMs` (Snap a meal: press time, straight into the camera).
 */
export default function LogFoodSheet() {
  const params = useLocalSearchParams<{ entry?: string; day?: string; group?: string; savedMeal?: string; saveEntries?: string; newSavedMeal?: string; start?: string; atMs?: string }>();
  const userId = useAuthStore((state) => state.user?.id) ?? '';
  // read once: the entry being edited stays as it was when the sheet opened
  const [editing] = useState<FoodLog | null>(() => (params.entry ? useFuelStore.getState().logs.find((log) => log.id === params.entry) ?? null : null));
  // A built meal opened from You's Saved meals, to change for future logs.
  const [savedMeal] = useState<Food | null>(() =>
    params.savedMeal ? useYouMealsStore.getState().meals?.find((meal) => meal.id === params.savedMeal) ?? null : null,
  );
  // Fuel's "Save as meal": logged entries, in the day's order, to keep as a new saved meal.
  // You's "New saved meal" starts the same save-only meal with no foods yet.
  const [saveFrom] = useState<FoodLog[] | null>(() => {
    if (params.newSavedMeal) return [];
    if (!params.saveEntries) return null;
    const logs = useFuelStore.getState().logs;
    const found = params.saveEntries.split(',').flatMap((id) => logs.filter((log) => log.id === id));
    return found.length > 0 ? found : null;
  });
  // The sheet has finished sliding up; iOS can't present the camera before that.
  const navigation = useNavigation<NativeStackNavigationProp<Record<string, object | undefined>>>();
  const [appeared, setAppeared] = useState(false);
  useLayoutEffect(
    () =>
      navigation.addListener('transitionEnd', (event) => {
        if (!event.data.closing) setAppeared(true);
      }),
    [navigation],
  );
  // Snap a meal pressed over this sheet while it holds nothing: start over for now.
  const [snapRestart, setSnapRestart] = useState(0);
  const [pressedAt, setPressedAt] = useState<Date | null>(() => params.start === 'camera' ? snapMealDate(params.atMs) : null);
  // Snap a meal (lib/launch.ts): a new entry, straight into the camera.
  const startCamera = !editing && !savedMeal && !saveFrom && (snapRestart > 0 || params.start === 'camera');
  const selectedKey = editing?.date ?? saveFrom?.[0]?.date ?? (pressedAt ? format(pressedAt, 'yyyy-MM-dd') : params.day ?? today());
  // A sheet with nothing to log into still answers Snap a meal pressed over it: it can't take it.
  const blank = !userId || (Boolean(params.saveEntries) && !saveFrom);
  useEffect(() => {
    if (!blank) return;
    return useLaunchStore.subscribe((state, previous) => {
      if (state.cameraAsks !== previous.cameraAsks) refusePress();
    });
  }, [blank]);
  if (!userId) return <Empty text="Sign in to log food." />;
  if (params.saveEntries && !saveFrom) return <Empty text="Those foods are no longer in your log." />;
  return (
    <LoggerSession
      key={`${userId}:${editing?.id ?? savedMeal?.id ?? (saveFrom ? `save:${params.saveEntries ?? 'new'}` : snapRestart > 0 ? `snap:${snapRestart}` : 'new')}`}
      userId={userId}
      editing={editing}
      savedMeal={savedMeal}
      saveFrom={saveFrom}
      selectedKey={selectedKey}
      groupParam={snapRestart > 0 ? null : params.group ?? null}
      startCamera={startCamera}
      pressedAt={pressedAt}
      appeared={appeared}
      onSnapRestart={(at) => { setPressedAt(at); setSnapRestart((count) => count + 1); }}
    />
  );
}

function LoggerSession({ userId, editing, savedMeal, saveFrom, selectedKey, groupParam, startCamera, pressedAt, appeared, onSnapRestart }: {
  userId: string;
  editing: FoodLog | null;
  savedMeal: Food | null;
  /** Logged entries the meal builder opens with, to save as a meal without logging it. */
  saveFrom: FoodLog[] | null;
  selectedKey: string;
  groupParam: string | null;
  /** Snap a meal: open on the analysis tab and bring up the camera once the sheet is up. */
  startCamera: boolean;
  /** Validated time of the press that opened this session. */
  pressedAt: Date | null;
  /** The sheet has finished sliding up. */
  appeared: boolean;
  /** Snap a meal over this sheet while it holds nothing: a fresh session for now. */
  onSnapRestart: (at: Date) => void;
}) {
  const c = useBlanc();
  const large = useLargeText();
  // Save as meal names the entries' day; read each render so it follows midnight.
  const todayKey = useTodayKey();
  const [snapAt, setSnapAt] = useState(pressedAt);
  const [groups, setGroups] = useState<NutritionGroup[]>(() => useFuelStore.getState().groups.filter((group) => group.date === selectedKey));
  const [when, setWhenState] = useState<When>(() =>
    initialWhen(editing, selectedKey, groups, groupParam ?? suggestFor(selectedKey, groups, snapAt), snapAt),
  );
  const groupTouched = useRef(Boolean(editing || groupParam));
  const setWhen = useCallback((next: When) => {
    groupTouched.current = true;
    setWhenState(next);
  }, []);

  // The day's groups (Breakfast, Lunch and Dinner are created if missing);
  // a new entry then goes to the meal that fits the time. Groups and a meal
  // that did not change keep their values, so the lists don't redraw.
  useEffect(() => {
    let current = true;
    void loadDayGroups(selectedKey).then((loaded) => {
      if (!current) return;
      setGroups((existing) => (sameGroups(existing, loaded) ? existing : loaded));
      if (groupTouched.current) return;
      const groupId = suggestFor(selectedKey, loaded, snapAt);
      setWhenState((value) => (value.groupId === groupId ? value : { ...value, groupId }));
    });
    return () => {
      current = false;
    };
  }, [selectedKey, snapAt]);

  // The day's groups can land after the sheet opened (the month was still
  // loading): pick them up instead of offering only No meal.
  const storeGroups = useFuelStore((state) => state.groups);
  useEffect(() => {
    const fromStore = groupsForDay(selectedKey);
    if (fromStore.length === 0) return;
    setGroups((current) => (current.map((group) => group.id).join() === fromStore.map((group) => group.id).join() ? current : fromStore));
    if (groupTouched.current) return;
    const groupId = suggestFor(selectedKey, fromStore, snapAt);
    setWhenState((value) => (value.groupId || value.groupId === groupId ? value : { ...value, groupId }));
  }, [storeGroups, selectedKey, snapAt]);

  const [tab, setTab] = useState<Tab>(editing ? 'manual' : startCamera ? 'photo' : 'recent');
  const [chosen, setChosen] = useState<{ food: Food; meta: ChosenMeta; servings?: number } | null>(() =>
    editing?.food && !decodeMealComposition(editing.food.description) && getCompatibleMeasurementUnits(editing.food.serving_unit).length > 1
      ? { food: editing.food, meta: null, servings: editing.servings }
      : null,
  );
  // An entry opened to edit shows its own food's review first: ✕ closes it, and
  // Change food (under the name) goes to the lists, where ‹ alone said neither.
  const editingOwnFood = Boolean(editing && chosen && editing.food?.id === chosen.food.id);
  const [manual, setManual] = useState<ManualDraft>(() =>
    editing?.food ? { ...emptyManual, fields: manualFromFood(editing.food), servings: String(editing.servings) } : emptyManual,
  );
  // What the sheet itself last put in Manual: typing away from it is work to keep.
  const [manualBase, setManualBase] = useState(manual);
  const loadManual = useCallback((next: ManualDraft) => {
    setManual(next);
    setManualBase(next);
  }, []);
  // Text typed in Manual's Describe with AI, which only ManualTab keeps (Snap a meal must not drop it).
  const manualDescribed = useRef(false);
  const describedInManual = useCallback((typed: boolean) => {
    manualDescribed.current = typed;
  }, []);
  const [photo, setPhoto] = useState<PhotoDraft>(emptyPhoto);
  // The owner logs food with Gemini; the worker photo flow stays for a device set to it.
  const [analysisMode] = useState(getFoodAnalysisMode);
  const gemini = analysisMode === 'gemini';
  const [ai, setAi] = useState<AiDraft>(() => emptyAi());
  // A photo, describe or barcode lookup running. Each tab claims the sheet
  // while its own lookup runs and lets go when it ends, so a tab opening or
  // finishing never clears another tab's lookup.
  const [busyClaims, beginBusy] = useClaims();
  const busy = busyClaims > 0;
  // A Search result's portion read: it holds Snap a meal off (the review is
  // about to open), but closing loses nothing, so the sheet closes as before.
  const [readClaims, beginRead] = useClaims();
  // A food save running holds the sheet until it lands or fails: a close then
  // could not stop the entry, and a failure would show nowhere. Saves claim
  // apart from lookups, so a lookup ending never lets go of a save.
  const [saveClaims, beginSave] = useClaims();
  const saving = saveClaims > 0;
  const [quickAddStates, setQuickAddStates] = useState<Record<string, QuickAddState>>({});
  const [pendingQuickAdds] = useState(() => new Map<string, PendingQuickAdd>());
  const [addedQuickAdds] = useState(() => new Map<string, AddedQuickAdd>());
  const quickAddFailed = Object.values(quickAddStates).some((state) => state === 'error');
  // A confirmed save (or a discarded meal edit) closes the sheet without
  // asking about the work it settled: the guard sees `closing` first, then an
  // effect closes.
  const [closing, setClosing] = useState(false);
  const photoWaiting = tab !== 'photo' && photo.items.length > 0 && !gemini;

  // Saved meals: the last list at once, refetched on open.
  const [savedMeals, setSavedMeals] = useState<Food[] | null>(() => readSavedFoodsCache(userId));
  const savedMealsRead = useRef(0);
  const reloadSavedMeals = useCallback(async () => {
    const request = ++savedMealsRead.current;
    const id = await getSessionUserId();
    if (!id || request !== savedMealsRead.current) return;
    const { meals, error } = await loadSavedMeals(id);
    if (request !== savedMealsRead.current) return;
    if (error) {
      setSavedMeals((current) => current ?? []);
      return;
    }
    // An unchanged list keeps its array, so Saved doesn't redraw on every focus.
    setSavedMeals((current) => (current && sameFoods(current, meals) ? current : meals));
    writeSavedFoodsCache(id, meals);
  }, []);
  useFocusEffect(useCallback(() => {
    // A separate saved-food editor returns here without remounting the logger.
    void reloadSavedMeals();
  }, [reloadSavedMeals]));

  // ── Meal builder ──
  const [savedTarget, setSavedTarget] = useState<Food | undefined>();
  // Saving logged entries as a meal starts from those entries every time:
  // closing it is cancelling, so nothing is kept for next time.
  const saveKey = saveFrom ? `save:${saveFrom.map((log) => log.id).join(',')}` : null;
  // Opening Saved → Edit changes the meal's target, even when this sheet
  // started from a logged entry. Its draft and save must use that same target.
  const editingMealEntryId = savedTarget ? undefined : editing?.id;
  const draftKey = savedTarget ? `saved:${savedTarget.id}` : editingMealEntryId ? `edit:${editingMealEntryId}` : saveKey ?? 'new';
  const keepsDraft = draftKey !== saveKey;
  const makeDraft = useCallback(
    (food?: { name: string; description?: string | null }, servings = 1): MealDraft => {
      const day = editing?.date ?? selectedKey;
      const dayDate = new Date(`${day}T00:00:00`);
      return {
        name: food?.name || '',
        ingredients: food ? scaleMealIngredients(decodeMealComposition(food.description)!.ingredients, servings) : [],
        date: day,
        time: toLocalTimeInput(editing?.logged_at ?? null, isToday(dayDate) ? new Date() : dayDate),
        groupId: editing?.group_id ?? (isToday(dayDate) ? when.groupId : null),
        method: 'barcode',
        entryId: crypto.randomUUID(),
        saveAsReusableMeal: false,
        locked: false,
      };
    },
    [editing, selectedKey, when.groupId],
  );
  const [meal, setMeal] = useState<MealDraft | null>(() => {
    if (saveFrom) return { ...makeDraft(), ...mealFromLoggedFoods(saveFrom), saveAsReusableMeal: true };
    const kept = loadMealDraft(userId, editing ? `edit:${editing.id}` : 'new');
    if (kept) return kept;
    if (editing?.food && decodeMealComposition(editing.food.description)) return makeDraft(editing.food, editing.servings);
    return null;
  });
  // what Save as meal opened with, so closing asks only once it was changed
  const [savingFrom] = useState(() => (saveFrom ? meal : null));
  // A new saved meal opens on its foods to add; anything else with a meal opens on its review.
  const [mealReview, setMealReview] = useState(Boolean(meal) && !(saveFrom && saveFrom.length === 0));
  // Snap a meal over a meal kept from last time: the meal waits under Resume pending meal.
  const [paused, setPaused] = useState(() => startCamera && meal !== null);
  const [storageFailed, setStorageFailed] = useState(false);
  const [captureKey, setCaptureKey] = useState(0);
  const [mealError, setMealError] = useState('');
  const settledMealIds = useRef(new Set<string>());

  const updateMeal = useCallback(
    (patch: Partial<MealDraft>) => {
      setMeal((current) => {
        if (!current) return current;
        const next = { ...current, ...patch };
        // React may run this updater after an immediately successful save or
        // discard cleared storage. Never recreate a draft that was settled.
        if (keepsDraft && !settledMealIds.current.has(next.entryId)) setStorageFailed(!saveMealDraft(userId, next, draftKey));
        return next;
      });
    },
    [userId, draftKey, keepsDraft],
  );

  const startMeal = useCallback(
    (food?: Food, editSaved = false) => {
      const next = makeDraft(food);
      next.saveAsReusableMeal = editSaved;
      // A saved meal opened to log is already saved: its review offers no second save.
      if (food) next.method = 'saved';
      const target = editSaved ? food : undefined;
      const targetKey = target ? `saved:${target.id}` : editing ? `edit:${editing.id}` : 'new';
      setSavedTarget(target);
      const value = loadMealDraft(userId, targetKey) ?? next;
      setMeal(value);
      setStorageFailed(!saveMealDraft(userId, value, targetKey));
      setMealReview(Boolean(food) || value !== next);
      setChosen(null);
    },
    [makeDraft, userId, editing],
  );
  // Opened from You to change a built meal: straight into its builder.
  const openedSaved = useRef(false);
  useEffect(() => {
    if (!savedMeal || openedSaved.current || !decodeMealComposition(savedMeal.description)) return;
    openedSaved.current = true;
    startMeal(savedMeal, true);
  }, [savedMeal, startMeal]);

  // Read when pressed: a Discard alert opened just before a save must not
  // clear the meal that save is writing.
  const mealHeld = useRef(false);
  useLayoutEffect(() => {
    mealHeld.current = saving || Boolean(meal?.locked);
  });
  const discardMeal = () => {
    if (mealHeld.current) return;
    if (meal) settledMealIds.current.add(meal.entryId);
    clearMealDraft(userId, draftKey);
    setMeal(null);
    setSavedTarget(undefined);
    setMealReview(false);
    setMealError('');
    if (editing || savedMeal || saveFrom) setClosing(true);
  };

  const capturing = Boolean(meal) && !mealReview && !paused;
  const purpose: LoggerContextValue['purpose'] = capturing ? 'ingredients' : 'log';

  const complete = useCallback(() => {
    void useFuelStore.getState().refreshAfterWrite();
    // The sheet closes on a save: VoiceOver says it went through.
    announce(savedTarget ? 'Saved meal updated' : editing ? 'Changes saved' : 'Logged');
    setClosing(true);
  }, [savedTarget, editing]);

  const addIngredients = useCallback(
    (ingredients: MealIngredient[]) => {
      if (!meal) return;
      const next = expandMealIngredients(ingredients);
      try {
        getMealTotals([...meal.ingredients, ...next]);
      } catch (failure) {
        setMealError(failure instanceof Error ? failure.message : 'Could not add ingredient.');
        throw failure;
      }
      haptics.success();
      updateMeal({ ingredients: [...meal.ingredients, ...next] });
      // The capture starts over below, so VoiceOver loses its place: say what was added.
      announce(next.length === 1 ? `${next[0].food.name} added to the meal` : `${next.length} ingredients added to the meal`);
      // the capture starts fresh for the next ingredient
      setChosen(null);
      loadManual(emptyManual);
      setPhoto(emptyPhoto());
      setAi(emptyAi());
      setCaptureKey((key) => key + 1);
      setMealError('');
    },
    [meal, updateMeal, loadManual],
  );

  // Search's "Enter manually": the latest Manual draft decides whether the
  // name is filled in, read through a ref so the context stays the same.
  const enterManuallyNow = useRef<(name: string) => void>(() => {});
  useLayoutEffect(() => {
    enterManuallyNow.current = (name: string) => {
      if (saving) return;
      if (!manualHasChanges(manual, manualBase, savedMeals)) loadManual({ ...emptyManual, fields: { ...emptyManual.fields, name: name.trim().slice(0, 120) } });
      showTab('manual');
    };
  });

  const context = useMemo<LoggerContextValue>(
    () => ({
      purpose,
      editing: savedTarget ? null : editing,
      selectedKey,
      groups,
      when,
      setWhen,
      savedMeals,
      reloadSavedMeals,
      chooseFood: (food, meta = null, servings) => {
        if (!saving) setChosen({ food, meta, servings });
      },
      addIngredients,
      composeMeal: (food, editSaved) => {
        if (!saving) startMeal(food, editSaved);
      },
      enterManually: (name) => enterManuallyNow.current(name),
      complete,
      beginBusy,
      beginRead,
      beginSave,
      quickAddStates,
      setQuickAddStates,
      pendingQuickAdds,
      addedQuickAdds,
    }),
    [purpose, editing, savedTarget, selectedKey, groups, when, setWhen, savedMeals, reloadSavedMeals, addIngredients, startMeal, complete, beginBusy, beginRead, beginSave, saving, quickAddStates, pendingQuickAdds, addedQuickAdds],
  );

  // Closing (✕, swipe down) with work that is not logged yet asks first: an
  // analysis running, an estimate, typed or changed Manual fields, a meal
  // this device could not keep, or a changed Save as meal. A built meal is
  // kept for next time anyway. While a save runs, a close does nothing.
  const estimate = ai.items.length > 0 || photo.items.length > 0;
  const savingChanged =
    !keepsDraft &&
    meal !== null &&
    savingFrom !== null &&
    (meal.name.trim() !== savingFrom.name.trim() || mealPartsKey(meal) !== mealPartsKey(savingFrom));
  const unsaved =
    savingChanged ||
    quickAddFailed ||
    busy ||
    aiHasDraft(ai) ||
    (!gemini && (photo.items.length > 0 || Boolean(photo.photos.top || photo.photos.side))) ||
    manualHasChanges(manual, manualBase, savedMeals) ||
    (Boolean(meal) && storageFailed);
  useLeaveGuard(
    (unsaved || saving) && !closing,
    quickAddFailed
      ? { title: 'Leave without confirming?', message: "A food couldn't be confirmed and may already be in your log. Tap its + to try again." }
      : busy
        ? { title: 'Stop the analysis?', message: 'The result is lost if you close now.' }
        : estimate
          ? { title: 'Discard this estimate?', message: 'You have not logged it yet.' }
          : savingChanged
            ? { title: 'Discard this meal?', message: 'It has not been saved.' }
            : editing
              ? { title: 'Discard your changes?', message: 'The entry stays as it was.' }
              : { title: 'Discard this entry?', message: 'It has not been logged yet.' },
    { busy: saving },
  );
  // Closes once the guard has seen `closing`, as the other sheets do.
  useEffect(() => {
    if (closing) router.back();
  }, [closing]);

  const sameDay = usesDayGroups(when, selectedKey);
  const destination = sameDay ? groups.find((group) => group.id === when.groupId) ?? null : null;
  // Fuel's addGroup makes the meal on the day Fuel shows, so New meal and New
  // snack are offered only for that day.
  const fuelDay = useFuelStore((state) => state.selected);
  const canAddGroup = sameDay && selectedKey === fuelDay;
  const addingGroup = useRef(false);
  // A new meal or snack, made as Fuel makes one, becomes the destination.
  const addDestination = async (kind: 'meal' | 'snack') => {
    if (addingGroup.current) return;
    addingGroup.current = true;
    const before = new Set(groupsForDay(selectedKey).map((group) => group.id));
    const ok = await useFuelStore.getState().addGroup(kind).catch(() => false);
    addingGroup.current = false;
    if (!ok) {
      haptics.error();
      Alert.alert('Not added', CHECK_CONNECTION);
      return;
    }
    haptics.success();
    const list = groupsForDay(selectedKey);
    const created = list.find((group) => !before.has(group.id) && group.kind === kind);
    if (!created) return;
    setGroups(list);
    groupTouched.current = true;
    setWhenState((value) => ({ ...value, groupId: created.id }));
    // The line changes under VoiceOver's focus without a word: say where food now goes.
    announce(`${editing ? 'In' : 'Adds to'} ${nutritionGroupTitle(created, list)}`);
  };
  const chooseDestination = () => {
    haptics.tap();
    const added = canAddGroup ? ['New meal', 'New snack'] : [];
    const options = [NO_MEAL, ...groups.map((group) => nutritionGroupTitle(group, groups)), ...added, 'Cancel'];
    ActionSheetIOS.showActionSheetWithOptions({ title: 'Add to', options, cancelButtonIndex: options.length - 1 }, (index) => {
      if (index === options.length - 1) return;
      if (index > groups.length) {
        void addDestination(index === groups.length + 1 ? 'meal' : 'snack');
        return;
      }
      haptics.select();
      setWhen({ ...when, groupId: index === 0 ? null : groups[index - 1].id });
    });
  };
  /** "today", or the day as "Nov 3". */
  const dayWords = (date: Date) => (format(date, 'yyyy-MM-dd') === todayKey ? 'today' : format(date, 'MMM d'));

  const inMeal = Boolean(meal) && !paused;
  const title = inMeal
    ? savedTarget
      ? 'Edit saved meal'
      : saveFrom
        ? saveFrom.length > 0 ? 'Save as meal' : 'New saved meal'
        : editing
          ? 'Edit meal'
          : 'Build a meal'
    : editing
      ? 'Edit entry'
      : 'Log food';
  const subtitle = inMeal
    ? capturing
      ? 'Add ingredients'
      : saveFrom?.[0] && !savedTarget
        ? `From ${saveFrom[0].date === todayKey ? 'today' : format(new Date(`${saveFrom[0].date}T12:00:00`), 'EEE, MMM d')}`
        : null
    : // Where the food goes, said positively: the meal set (suggestFor's, or
      // the one chosen), else the day itself; the line adds no guess of its own.
      !sameDay
      ? `${editing ? 'Moves to' : 'Adds to'} ${dayWords(when.date)}`
      : destination
        ? `${editing ? 'In' : 'Adds to'} ${nutritionGroupTitle(destination, groups)}`
        : editing
          ? NO_MEAL
          : `Adds to ${dayWords(when.date)}`;
  // The line says only where food goes; a tap on it changes that.
  const changesDestination = sameDay && !inMeal;

  // ── Search foods: the field above the segments takes the sheet over ──
  // Its words live here, so a food's review or an ingredient added keeps them.
  const [query, setQuery] = useState('');
  // What showed when Search took over (a list or an entry method), for Cancel to return to.
  const [beforeSearch, setBeforeSearch] = useState<Tab>('recent');
  const searching = tab === 'search';

  const showTab = (next: Tab) => {
    setTab(next);
    setChosen(null);
    // Leaving Search by any way (Cancel, Snap a meal) empties its field and puts the keyboard away.
    if (next !== 'search') {
      setQuery('');
      if (tab === 'search') Keyboard.dismiss();
    }
    // a barcode binding only survives the guided miss → manual path
    if (next !== 'manual') setManual((current) => (current.barcodeBinding ? { ...current, barcodeBinding: null } : current));
  };
  const openTab = (next: Tab) => {
    if (saving) return;
    haptics.select();
    showTab(next);
  };
  // Focusing the field (or typing into it) starts a search; a save running holds the tabs still.
  const startSearch = () => {
    if (saving || tab === 'search') return;
    setBeforeSearch(tab);
    showTab('search');
  };
  const cancelSearch = () => {
    if (saving) return;
    haptics.tap();
    showTab(beforeSearch);
  };

  // ── Photo and Describe: two doors into the one meal view ──
  // Photo opens the camera and adds what it takes; Describe puts the cursor in
  // Your meal. Either can be combined with the other before Analyze meal; only
  // Snap a meal (below) estimates on its own.
  const [door, setDoor] = useState<'photo' | 'describe'>('photo');
  const [addPhotoRequest, setAddPhotoRequest] = useState(0);
  const [focusRequest, setFocusRequest] = useState(0);
  const chooseMethod = (method: EntryMethod) => {
    if (saving) return;
    if (method === 'photo' || method === 'describe') {
      if (tab !== 'photo') openTab('photo');
      else haptics.select();
      setDoor(method);
      if (method === 'describe') setFocusRequest((count) => count + 1);
      else if (gemini ? aiTakesPhoto(ai) : photoTakesPhoto(photo)) setAddPhotoRequest((count) => count + 1);
      return;
    }
    if (tab !== method) openTab(method);
  };

  // ── Snap a meal (lib/launch.ts) ──
  // The camera comes up once the sheet has (iOS can't present it mid-slide),
  // and again when Snap a meal is pressed with this sheet on top.
  const [cameraRequest, setCameraRequest] = useState(0);
  const cameraPending = useRef(startCamera);
  const requestCamera = useEffectEvent(() => {
    cameraPending.current = false;
    // only while the analysis tab is the one on screen
    if (tab !== 'photo' || chosen || (meal && !paused)) return;
    setCameraRequest((count) => count + 1);
  });
  useEffect(() => {
    if (appeared && cameraPending.current) requestCamera();
  }, [appeared]);
  const cameraAsks = useLaunchStore((state) => state.cameraAsks);
  const seenAsks = useRef(cameraAsks);
  const snapAsked = useEffectEvent(() => {
    const at = snapMealDate(useLaunchStore.getState().cameraAtMs);
    const pressDay = format(at, 'yyyy-MM-dd');
    const answer = sheetSnap({
      newEntry: !editing && !savedMeal && !saveFrom,
      pickerUp: foodPickerUp(),
      // a save running holds the tabs still (Manual would unmount mid-save): refused, never switched
      occupied: closing || busy || saving || readClaims > 0 || Boolean(chosen) || Boolean(meal && !paused) || tab === 'scan' || manualDescribed.current,
      holdsWork: unsaved,
      // a quick add left unconfirmed is work too: logging the meal would close the sheet past its retry
      analysisDraftOnly:
        (gemini ? aiTakesPhoto(ai) : photoTakesPhoto(photo)) && !manualHasChanges(manual, manualBase, savedMeals) && !(meal && storageFailed) && !quickAddFailed,
      forNow: selectedKey === pressDay && !groupTouched.current,
    });
    if (answer === 'ignore') return;
    if (answer === 'refuse') {
      refusePress();
      return;
    }
    if (answer === 'restart') {
      onSnapRestart(at);
      return;
    }
    // Use the press, including its meal, even if opening crossed midnight.
    setSnapAt(at);
    setWhenState(initialWhen(null, selectedKey, groups, suggestFor(selectedKey, groups, at), at));
    showTab('photo');
    setDoor('photo');
    if (appeared) setCameraRequest((count) => count + 1);
    else cameraPending.current = true;
  });
  useEffect(() => {
    if (cameraAsks === seenAsks.current) return;
    seenAsks.current = cameraAsks;
    snapAsked();
  }, [cameraAsks]);

  const mealTotals = meal ? getMealTotals(meal.ingredients) : null;
  const mealCount = meal && mealTotals ? `${meal.ingredients.length} ingredient${meal.ingredients.length === 1 ? '' : 's'} · ${formatWhole(mealTotals.calories)} kcal` : '';

  // Each tab is built on its own, so typing in one never rebuilds another.
  // Each list offers one way to make something, under its foods: Recent builds
  // a meal from them (several foods logged as one entry), Saved makes a new
  // saved meal. A pending meal takes Recent's place and shows on every tab.
  const listRow = (title: string, detail: string, onPress: () => void) => (
    <View style={{ marginTop: 14 }}>
      <Label>
        <Row title={title} detail={detail} chevron disabled={busy || saving} onPress={onPress} />
      </Label>
    </View>
  );
  const buildMeal = !editing && !meal && tab === 'recent' ? listRow('Build a meal', 'Combine several foods into one entry', () => startMeal()) : null;
  const newSavedMeal = !editing && purpose === 'log' && tab === 'saved'
    ? listRow('New saved meal', 'Macros you enter once, to log in a tap', () => {
        if (saving) return;
        loadManual({ ...emptyManual, saveAsReusable: true });
        setTab('manual');
      })
    : null;
  const pendingMeal = !editing && meal && paused ? listRow('Resume pending meal', 'Finish saving the meal you built', () => setPaused(false)) : null;
  const recentTab = tab === 'recent' ? <RecentTab userId={userId} /> : null;
  const savedTab = tab === 'saved' ? (
    <SavedTab
      onEditSavedMeal={(saved) => {
        if (saving) return;
        if (decodeMealComposition(saved.description)) {
          startMeal(saved, true);
          return;
        }
        // Editing saved macros has its own sheet, as in You. Loading
        // them into Manual would keep this sheet's logged-entry target.
        // Seed the selected row because You may not have loaded yet.
        useYouMealsStore.setState((state) => {
          const meals = state.meals ?? [];
          return { meals: meals.some((candidate) => candidate.id === saved.id)
            ? meals.map((candidate) => candidate.id === saved.id ? saved : candidate)
            : [...meals, saved] };
        });
        router.push({ pathname: '/saved-meal', params: { id: saved.id } });
      }}
    />
  ) : null;
  const searchTab = tab === 'search' ? <SearchTab query={query} /> : null;
  const scanTab = tab === 'scan' ? (
    <ScanTab
      onCreateProduct={(barcode) => {
        loadManual({ ...emptyManual, saveAsReusable: true, barcodeBinding: barcode });
        setTab('manual');
      }}
    />
  ) : null;
  const manualTab = tab === 'manual' ? (
    <ManualTab
      draft={manual}
      setDraft={(update) => setManual(update)}
      onDescribeText={describedInManual}
      onGeminiHandoff={
        gemini
          ? (description) => {
              // the hand-off is a tab switch too
              if (saving) return;
              if (busy) {
                Alert.alert('Analysis still running', 'Wait for the current AI analysis to finish, then try again.');
                return;
              }
              const handOff = () => {
                setAi(emptyAi(description));
                setTab('photo');
                // the words arrive through Describe's door
                setDoor('describe');
              };
              if (!aiHasDraft(ai)) {
                handOff();
                return;
              }
              Alert.alert('Replace the current AI meal?', 'Unsaved work on the AI tab will be discarded.', [
                { text: 'Keep', style: 'cancel' },
                { text: 'Replace', style: 'destructive', onPress: handOff },
              ]);
            }
          : undefined
      }
    />
  ) : null;

  // ── The sheet's head: Search foods, then the lists and the entry methods ──
  // Search foods, as iOS's search field: focusing it or typing takes the
  // sheet over, with Cancel beside it to go back.
  const picking = !chosen && !(meal && mealReview && !paused);
  const searchRow = picking ? (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <SearchField
        value={query}
        onChange={(text) => {
          setQuery(text);
          startSearch();
        }}
        onFocus={startSearch}
        // A save holds the tabs still, so the field can't start a search
        // then; while searching it stays live (a quick add keeps the keyboard up).
        editable={!saving || searching}
        placeholder="Search foods"
        style={{ flex: 1, marginHorizontal: 0, marginTop: 0 }}
      />
      {searching ? (
        <Pressable
          accessibilityRole="button"
          accessibilityHint="Ends the search"
          disabled={saving}
          hitSlop={8}
          onPress={cancelSearch}
          style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', opacity: saving ? 0.4 : pressed ? 0.45 : 1 })}>
          {/* Capped like a bar button, so the field keeps its room. */}
          <BlancText variant="body" maxFontSizeMultiplier={1.3} numberOfLines={1}>
            Cancel
          </BlancText>
        </Pressable>
      ) : null}
    </View>
  ) : null;
  // While searching, the results sit right under the field.
  const lists = picking && !searching ? (
    <>
      {/* The lists to pick from. While an entry method is on screen no
          segment is chosen, so the control never claims a list that
          isn't showing; a tap on one goes back to it. */}
      <Host matchContents={{ vertical: true }}>
        {/* Keep a save's result visible on its original tab. */}
        <Picker
          selection={isBrowse(tab) ? tab : NO_LIST}
          onSelectionChange={(value: BrowseTab | typeof NO_LIST) => {
            if (value !== NO_LIST) openTab(value);
          }}
          modifiers={[pickerStyle('segmented'), disabled(saving)]}>
          <SwiftText modifiers={[tag('recent')]}>Recent</SwiftText>
          <SwiftText modifiers={[tag('saved')]}>Saved</SwiftText>
        </Picker>
      </Host>
      {/* The ways to enter a food that isn't listed. */}
      <EntryMethods
        selected={isList(tab) ? null : tab === 'photo' && gemini ? door : tab}
        gemini={gemini}
        photoWaiting={photoWaiting}
        disabled={saving}
        onSelect={chooseMethod}
      />
    </>
  ) : null;
  const mealLine = capturing && meal && mealTotals && !chosen ? (
    <View
      style={
        // At the accessibility sizes Review meal goes under the count instead of squeezing it.
        large ? { alignItems: 'flex-start', gap: 8, marginHorizontal: 20, marginTop: 12 } : { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 20, marginTop: 12 }
      }>
      {/* The total rolls on one line; at the accessibility sizes it wraps instead. */}
      {large ? (
        <BlancText variant="secondary" tone="graphite">
          {mealCount}
        </BlancText>
      ) : (
        <RollingText variant="secondary" tone="graphite" style={{ flex: 1 }}>
          {mealCount}
        </RollingText>
      )}
      <Capsule title="Review meal" disabled={meal.ingredients.length === 0 || busy} onPress={() => setMealReview(true)} />
    </View>
  ) : null;
  const errorLine = mealError ? (
    <BlancText variant="footnote" tone="live" style={{ marginHorizontal: 20, marginTop: 8 }}>
      {mealError}
    </BlancText>
  ) : null;
  // At the accessibility sizes the segments and the four methods (stacked as
  // rows) would pin most of the sheet, leaving little for a list, a meal or
  // results under the keyboard. Only the title and Search foods stay pinned
  // then; the rest scrolls with what it opens, spaced as when pinned.
  const scrollsWithContent = large && Boolean(lists || mealLine || errorLine);

  return (
    <LoggerContext.Provider value={context}>
      <KeyboardAwareScrollView
        // On Barcode the typed digits' Look up barcode sits under the field:
        // the pad's bar covered it, so the field rises with room for it.
        bottomOffset={tab === 'scan' && !chosen ? 24 + 12 + 54 : 24}
        style={{ flex: 1, backgroundColor: c.ground }}
        contentContainerStyle={{ paddingBottom: 48 }}
        stickyHeaderIndices={[0]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        // Scrolling closes a row left swiped open, as iOS lists do.
        onScrollBeginDrag={() => dismissOpenSwipeRow()}>
        <View style={{ backgroundColor: c.ground, paddingBottom: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 16 }}>
            {chosen && !editingOwnFood ? (
              <GlassButton symbol="chevron.left" accessibilityLabel="Back" disabled={saving} onPress={() => setChosen(null)} />
            ) : (
              <GlassButton symbol="xmark" accessibilityLabel="Close" onPress={() => router.back()} />
            )}
            <View style={{ alignItems: 'center', flex: 1 }}>
              <BlancText variant="headline" accessibilityRole="header" numberOfLines={large ? undefined : 1} style={large ? { textAlign: 'center' } : undefined}>
                {title}
              </BlancText>
              {subtitle ? (
                <Pressable
                  accessibilityRole={changesDestination ? 'button' : 'text'}
                  accessibilityLabel={changesDestination ? `${subtitle}. Change` : subtitle}
                  disabled={!changesDestination}
                  onPress={chooseDestination}
                  // The pressable itself is 44 points tall around the 18-point line
                  // (and 16 wider each side); the negative margins give the room
                  // back, so the line and the title stay where they sit.
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingVertical: DESTINATION_REACH.vertical,
                    marginVertical: -DESTINATION_REACH.vertical,
                    paddingHorizontal: DESTINATION_REACH.horizontal,
                    marginHorizontal: -DESTINATION_REACH.horizontal,
                    opacity: pressed ? 0.5 : 1,
                  })}>
                  <BlancText variant="footnote" tone="graphite">
                    {subtitle}
                  </BlancText>
                  {changesDestination ? <SymbolView name="chevron.down" size={10} weight="semibold" tintColor={c.graphite} style={{ marginLeft: 4 }} /> : null}
                </Pressable>
              ) : null}
            </View>
            {/* Save as meal has one way out: closing it cancels. */}
            {inMeal && !meal?.locked && keepsDraft && !saving ? (
              <Pressable
                accessibilityRole="button"
                hitSlop={8}
                onPress={() => {
                  haptics.tap();
                  // A meal with nothing in it has nothing to lose: no question first.
                  if (!meal || meal.ingredients.length === 0) {
                    discardMeal();
                    return;
                  }
                  Alert.alert('Discard this meal?', 'The meal you are building is cleared.', [
                    { text: 'Keep', style: 'cancel' },
                    { text: 'Discard', style: 'destructive', onPress: discardMeal },
                  ]);
                }}
                style={({ pressed }) => ({ width: 64, height: 44, alignItems: 'flex-end', justifyContent: 'center', opacity: pressed ? 0.45 : 1 })}>
                {/* Capped like a bar button, so the word stays on one line in its 64-point box. */}
                <BlancText variant="bodyStrong" size={15} maxFontSizeMultiplier={1.2}>
                  Discard
                </BlancText>
              </Pressable>
            ) : (
              <View style={{ width: 44 }} />
            )}
          </View>

          {searchRow ? (
            <View style={{ marginHorizontal: 16, marginTop: 14, gap: 10 }}>
              {searchRow}
              {large ? null : lists}
            </View>
          ) : null}
          {large ? null : mealLine}
          {large ? null : errorLine}
        </View>
        {/* Unpinned at the accessibility sizes. The negative margin gives back
            the pinned head's 8-point foot, so each part keeps its pinned spacing. */}
        {scrollsWithContent ? (
          <View style={{ marginTop: -8, paddingBottom: 8 }}>
            {lists ? <View style={{ marginHorizontal: 16, marginTop: 10, gap: 10 }}>{lists}</View> : null}
            {mealLine}
            {errorLine}
          </View>
        ) : null}

        {meal && mealReview && !paused ? (
          <MealReview
            draft={meal}
            update={updateMeal}
            userId={userId}
            savedTarget={savedTarget}
            saveOnly={Boolean(saveFrom) && !savedTarget}
            editingEntryId={editingMealEntryId}
            storageFailed={storageFailed}
            onAddIngredients={() => setMealReview(false)}
            onPause={() => setPaused(true)}
            onSaved={() => {
              settledMealIds.current.add(meal.entryId);
              clearMealDraft(userId, draftKey);
              if (savedTarget || saveFrom) {
                void reloadSavedMeals();
                void loadYouMeals();
              }
              // a meal saved for later leaves the day's log as it was
              if (saveFrom && !savedTarget) {
                announce('Meal saved');
                setClosing(true);
              } else complete();
            }}
          />
        ) : chosen ? (
          <FoodReview
            food={chosen.food}
            meta={chosen.meta}
            servings={chosen.servings}
            onAmountChange={editing?.food?.id === chosen.food.id
              ? (servings) => setManual((draft) => ({ ...draft, servings: servings === null ? '' : String(servings) }))
              : undefined}
            onChangeFood={editingOwnFood && !saving ? () => setChosen(null) : undefined}
          />
        ) : (
          <View key={captureKey}>
            {/* The foods to repeat come first; the list's way to make something follows them. */}
            {recentTab}
            {savedTab}
            {buildMeal}
            {newSavedMeal}
            {pendingMeal}
            {searchTab}
            {scanTab}
            {manualTab}
          </View>
        )}
        {/* Both analysis tabs stay mounted while hidden: work in flight and
            retry-safe ids survive a tab switch or a food review. Only starting
            the next ingredient capture drops the old analysis. */}
        {gemini ? (
          <View key={`ai-${captureKey}`} style={!chosen && !(meal && mealReview && !paused) && tab === 'photo' ? undefined : { display: 'none' }}>
            <AiTab draft={ai} setDraft={(update) => setAi(update)} cameraRequest={cameraRequest} addPhotoRequest={addPhotoRequest} focusRequest={focusRequest} />
          </View>
        ) : (
          <View key={`photo-${captureKey}`} style={!chosen && !(meal && mealReview && !paused) && tab === 'photo' ? undefined : { display: 'none' }}>
            <PhotoTab draft={photo} setDraft={(update) => setPhoto(update)} cameraRequest={cameraRequest} addPhotoRequest={addPhotoRequest} />
          </View>
        )}
      </KeyboardAwareScrollView>
    </LoggerContext.Provider>
  );
}
