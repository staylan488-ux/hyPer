import { Host, Picker, Text as SwiftText } from '@expo/ui/swift-ui';
import { accessibilityLabel, disabled, pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { format, isToday } from 'date-fns';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { ActionSheetIOS, Alert, Pressable, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import Animated from 'react-native-reanimated';

import { toLocalTimeInput } from '@/lib/foodLoggerUtils';
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
import { nutritionGroupLabel } from '@/lib/nutritionGroups';
import { logMacro } from '@/lib/nutritionMacros';
import type { PendingEntryId } from '@/lib/pendingEntryId';
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
import { announce, speak, useLargeText } from '~/lib/accessibility';
import { formatWhole } from '~/lib/format';
import { initialWhen, usesDayGroups, type When } from '~/lib/foodLogger';
import { groupsForDay, loadDayGroups, suggestedGroup, today, useFuelStore, useTodayKey, type FoodLog } from '~/lib/fuel';
import { haptics } from '~/lib/haptics';
import { useLeaveGuard } from '~/lib/leaveGuard';
import { figureLayout } from '~/lib/motion';
import { loadYouMeals, useYouMealsStore } from '~/lib/you';
import { LoggerContext, type ChosenMeta, type LoggerContextValue, type QuickAddState } from '~/fuel/context';
import { Empty, SavedTab, SearchTab } from '~/fuel/FoodLists';
import { FoodReview } from '~/fuel/FoodReview';
import { emptyManual, manualFromFood, manualHasChanges, ManualTab, type ManualDraft } from '~/fuel/ManualTab';
import { MealReview } from '~/fuel/MealReview';
import { aiHasDraft, AiTab, emptyAi, type AiDraft } from '~/fuel/AiTab';
import { emptyPhoto, PhotoTab, type PhotoDraft } from '~/fuel/PhotoTab';
import { RecentTab } from '~/fuel/RecentTab';
import { ScanTab } from '~/fuel/ScanTab';
import { useBlanc } from '~/theme/blanc';

type Tab = 'recent' | 'saved' | 'search' | 'scan' | 'manual' | 'photo';

/** A meal's ingredients and amounts, to tell whether it changed. */
const mealPartsKey = (draft: MealDraft) => draft.ingredients.map((part) => `${part.id}:${part.servings}`).join('|');

/**
 * A new entry today goes to the meal that fits the clock; on another day the
 * clock says nothing about the meal, so it starts Unassigned, as on the web.
 */
const suggestFor = (selectedKey: string, list: NutritionGroup[]) => (selectedKey === today() ? suggestedGroup(list)?.id ?? null : null);

/** The same groups as far as the sheet reads them (destination, labels, order). */
const sameGroups = (a: NutritionGroup[], b: NutritionGroup[]) =>
  a.length === b.length &&
  a.every((group, index) => {
    const other = b[index];
    return group.id === other.id && group.date === other.date && group.kind === other.kind && group.label === other.label && group.sort_order === other.sort_order;
  });

/** The same saved foods, field for field, in the same order. */
const sameFoods = (a: Food[], b: Food[]) => a.length === b.length && JSON.stringify(a) === JSON.stringify(b);

/**
 * Log food, or edit an entry: Recent, Saved, Search (USDA), Scan, Manual and Photo,
 * a review for a chosen food, and the meal builder, by the web logger's rules.
 * Params: `entry` (an entry id to edit), `day` (yyyy-MM-dd, default today),
 * `group` (the meal to add to), `savedMeal` (a built saved meal to change),
 * `saveEntries` (comma-separated logged entries to keep as a new saved meal).
 */
export default function LogFoodSheet() {
  const params = useLocalSearchParams<{ entry?: string; day?: string; group?: string; savedMeal?: string; saveEntries?: string }>();
  const userId = useAuthStore((state) => state.user?.id) ?? '';
  // read once: the entry being edited stays as it was when the sheet opened
  const [editing] = useState<FoodLog | null>(() => (params.entry ? useFuelStore.getState().logs.find((log) => log.id === params.entry) ?? null : null));
  // A built meal opened from You's Saved meals, to change for future logs.
  const [savedMeal] = useState<Food | null>(() =>
    params.savedMeal ? useYouMealsStore.getState().meals?.find((meal) => meal.id === params.savedMeal) ?? null : null,
  );
  // Fuel's "Save as meal": logged entries, in the day's order, to keep as a new saved meal.
  const [saveFrom] = useState<FoodLog[] | null>(() => {
    if (!params.saveEntries) return null;
    const logs = useFuelStore.getState().logs;
    const found = params.saveEntries.split(',').flatMap((id) => logs.filter((log) => log.id === id));
    return found.length > 0 ? found : null;
  });
  const selectedKey = editing?.date ?? saveFrom?.[0].date ?? params.day ?? today();
  if (!userId) return <Empty text="Sign in to log food." />;
  if (params.saveEntries && !saveFrom) return <Empty text="Those foods are no longer in your log." />;
  return (
    <LoggerSession
      key={`${userId}:${editing?.id ?? savedMeal?.id ?? (saveFrom ? `save:${params.saveEntries}` : 'new')}`}
      userId={userId}
      editing={editing}
      savedMeal={savedMeal}
      saveFrom={saveFrom}
      selectedKey={selectedKey}
      groupParam={params.group ?? null}
    />
  );
}

/** Counts one claim on the sheet; the returned cleanup lets go of only that claim, once. */
function claim(setCount: Dispatch<SetStateAction<number>>) {
  setCount((count) => count + 1);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    setCount((count) => count - 1);
  };
}

function LoggerSession({ userId, editing, savedMeal, saveFrom, selectedKey, groupParam }: {
  userId: string;
  editing: FoodLog | null;
  savedMeal: Food | null;
  /** Logged entries the meal builder opens with, to save as a meal without logging it. */
  saveFrom: FoodLog[] | null;
  selectedKey: string;
  groupParam: string | null;
}) {
  const c = useBlanc();
  const large = useLargeText();
  // Save as meal names the entries' day; read each render so it follows midnight.
  const todayKey = useTodayKey();
  const [groups, setGroups] = useState<NutritionGroup[]>(() => useFuelStore.getState().groups.filter((group) => group.date === selectedKey));
  const [when, setWhenState] = useState<When>(() =>
    initialWhen(editing, selectedKey, groups, groupParam ?? suggestFor(selectedKey, groups)),
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
      const groupId = suggestFor(selectedKey, loaded);
      setWhenState((value) => (value.groupId === groupId ? value : { ...value, groupId }));
    });
    return () => {
      current = false;
    };
  }, [selectedKey]);

  // The day's groups can land after the sheet opened (the month was still
  // loading): pick them up instead of offering only Unassigned.
  const storeGroups = useFuelStore((state) => state.groups);
  useEffect(() => {
    const fromStore = groupsForDay(selectedKey);
    if (fromStore.length === 0) return;
    setGroups((current) => (current.map((group) => group.id).join() === fromStore.map((group) => group.id).join() ? current : fromStore));
    if (groupTouched.current) return;
    const groupId = suggestFor(selectedKey, fromStore);
    setWhenState((value) => (value.groupId || value.groupId === groupId ? value : { ...value, groupId }));
  }, [storeGroups, selectedKey]);

  const [tab, setTab] = useState<Tab>(editing ? 'manual' : 'recent');
  const [chosen, setChosen] = useState<{ food: Food; meta: ChosenMeta; servings?: number } | null>(null);
  const [manual, setManual] = useState<ManualDraft>(() =>
    editing?.food ? { ...emptyManual, fields: manualFromFood(editing.food), servings: String(editing.servings) } : emptyManual,
  );
  // What the sheet itself last put in Manual: typing away from it is work to keep.
  const [manualBase, setManualBase] = useState(manual);
  const loadManual = useCallback((next: ManualDraft) => {
    setManual(next);
    setManualBase(next);
  }, []);
  const [photo, setPhoto] = useState<PhotoDraft>(emptyPhoto);
  // The owner logs food with Gemini; the worker photo flow stays for a device set to it.
  const [analysisMode] = useState(getFoodAnalysisMode);
  const gemini = analysisMode === 'gemini';
  const [ai, setAi] = useState<AiDraft>(() => emptyAi());
  // A photo, describe or barcode lookup running. Each tab claims the sheet
  // while its own lookup runs and lets go when it ends, so a tab opening or
  // finishing never clears another tab's lookup.
  const [busyClaims, setBusyClaims] = useState(0);
  const busy = busyClaims > 0;
  const beginBusy = useCallback(() => claim(setBusyClaims), []);
  // A food save running holds the sheet until it lands or fails: a close then
  // could not stop the entry, and a failure would show nowhere. Saves claim
  // apart from lookups, so a lookup ending never lets go of a save.
  const [saveClaims, setSaveClaims] = useState(0);
  const saving = saveClaims > 0;
  const beginSave = useCallback(() => claim(setSaveClaims), []);
  const [quickAddStates, setQuickAddStates] = useState<Record<string, QuickAddState>>({});
  const [pendingQuickAdds] = useState(() => new Map<string, PendingEntryId>());
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

  // ── Meal builder (web MealLogger) ──
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
  const [mealReview, setMealReview] = useState(Boolean(meal));
  const [paused, setPaused] = useState(false);
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
    void useFuelStore.getState().refresh();
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
      // the capture starts fresh for the next ingredient, as the web logger remounts
      setChosen(null);
      loadManual(emptyManual);
      setPhoto(emptyPhoto());
      setAi(emptyAi());
      setCaptureKey((key) => key + 1);
      setMealError('');
    },
    [meal, updateMeal, loadManual],
  );

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
      complete,
      beginBusy,
      beginSave,
      quickAddStates,
      setQuickAddStates,
      pendingQuickAdds,
    }),
    [purpose, editing, savedTarget, selectedKey, groups, when, setWhen, savedMeals, reloadSavedMeals, addIngredients, startMeal, complete, beginBusy, beginSave, saving, quickAddStates, pendingQuickAdds],
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
      ? { title: 'Leave this unconfirmed save?', message: 'The food may already be in your log. Retry its + button to confirm it, or check your log before adding it again.' }
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
  const chooseDestination = () => {
    haptics.tap();
    const options = ['Unassigned', ...groups.map((group) => nutritionGroupLabel(group, groups)), 'Cancel'];
    ActionSheetIOS.showActionSheetWithOptions({ title: 'Add to', options, cancelButtonIndex: options.length - 1 }, (index) => {
      if (index === options.length - 1) return;
      haptics.select();
      setWhen({ ...when, groupId: index === 0 ? null : groups[index - 1].id });
    });
  };

  const inMeal = Boolean(meal) && !paused;
  const title = inMeal
    ? savedTarget
      ? 'Edit saved meal'
      : saveFrom
        ? 'Save as meal'
        : editing
          ? 'Edit meal'
          : 'Build a meal'
    : editing
      ? 'Edit entry'
      : 'Log food';
  const subtitle = inMeal
    ? capturing
      ? 'Add ingredients'
      : saveFrom && !savedTarget
        ? `From ${saveFrom[0].date === todayKey ? 'today' : format(new Date(`${saveFrom[0].date}T12:00:00`), 'EEE, MMM d')}`
        : null
    : !sameDay
      ? `Unassigned on ${format(when.date, 'MMM d')}`
      : `${editing ? 'In' : 'Adds to'} ${destination ? nutritionGroupLabel(destination, groups) : 'Unassigned'}`;
  // The meal's running total, from the day Fuel holds: it rolls up as foods are logged into it.
  const dayLogs = useFuelStore((state) => (state.loadedMonth === selectedKey.slice(0, 7) ? state.logs : null));
  const groupIds = new Set(groups.map((group) => group.id));
  const mealKcal =
    dayLogs && sameDay && !inMeal && !editing
      ? dayLogs
          .filter((log) => log.date === selectedKey && (destination ? log.group_id === destination.id : !log.group_id || !groupIds.has(log.group_id)))
          .reduce((sum, log) => sum + (logMacro(log, 'calories') ?? 0), 0)
      : 0;
  const spokenSubtitle = mealKcal > 0 ? `${subtitle}, ${speak(`${formatWhole(mealKcal)} kcal`)}` : subtitle;

  const openTab = (next: Tab) => {
    if (saving) return;
    haptics.select();
    setTab(next);
    setChosen(null);
    // a barcode binding only survives the guided miss → manual path
    if (next !== 'manual') setManual((current) => (current.barcodeBinding ? { ...current, barcodeBinding: null } : current));
  };

  const mealTotals = meal ? getMealTotals(meal.ingredients) : null;
  const mealCount = meal && mealTotals ? `${meal.ingredients.length} ingredient${meal.ingredients.length === 1 ? '' : 's'} · ${formatWhole(mealTotals.calories)} kcal` : '';

  // Each tab is built on its own, so typing in one never rebuilds another.
  // Starting a meal is offered with the foods it is built from; a pending meal shows on every tab.
  const buildMeal = !editing && (meal ? paused : tab === 'recent' || tab === 'saved') ? (
    <View style={{ marginTop: 14 }}>
      <Label>
        <Row
          title={paused ? 'Resume pending meal' : 'Build a meal'}
          detail={paused ? 'Finish saving the meal you built' : 'Combine several foods into one entry'}
          chevron
          disabled={busy || saving}
          onPress={() => (paused ? setPaused(false) : startMeal())}
        />
      </Label>
    </View>
  ) : null;
  const recentTab = tab === 'recent' ? <RecentTab userId={userId} /> : null;
  const savedTab = tab === 'saved' ? (
    <SavedTab
      onNewSavedMeal={() => {
        if (saving) return;
        loadManual({ ...emptyManual, saveAsReusable: true });
        setTab('manual');
      }}
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
  const searchTab = tab === 'search' ? <SearchTab /> : null;
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

  return (
    <LoggerContext.Provider value={context}>
      <KeyboardAwareScrollView
        bottomOffset={24}
        style={{ flex: 1, backgroundColor: c.ground }}
        contentContainerStyle={{ paddingBottom: 48 }}
        stickyHeaderIndices={[0]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        // Scrolling closes a row left swiped open, as iOS lists do.
        onScrollBeginDrag={() => dismissOpenSwipeRow()}>
        <View style={{ backgroundColor: c.ground, paddingBottom: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 16 }}>
            {chosen ? (
              <GlassButton symbol="chevron.left" accessibilityLabel="Back" disabled={saving} onPress={() => setChosen(null)} />
            ) : (
              <GlassButton symbol="xmark" accessibilityLabel="Close" onPress={() => router.back()} />
            )}
            <View style={{ alignItems: 'center', flex: 1 }}>
              <BlancText variant="headline" accessibilityRole="header" numberOfLines={large ? undefined : 1} style={large ? { textAlign: 'center' } : undefined}>
                {title}
              </BlancText>
              {subtitle ? (
                // The line re-centres on the figure's spring when the total gains a digit.
                <Animated.View layout={figureLayout}>
                  <Pressable
                    accessibilityRole={sameDay && !inMeal ? 'button' : 'text'}
                    accessibilityLabel={sameDay && !inMeal ? `${spokenSubtitle}. Change` : spokenSubtitle ?? undefined}
                    disabled={!sameDay || inMeal}
                    // a 13-point line, 44 points to touch
                    hitSlop={{ top: 13, bottom: 13, left: 16, right: 16 }}
                    onPress={chooseDestination}
                    style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', opacity: pressed ? 0.5 : 1 })}>
                    <BlancText variant="footnote" tone="graphite">
                      {subtitle}
                    </BlancText>
                    {mealKcal > 0 ? (
                      <RollingText variant="footnote" tone="graphite" style={{ fontVariant: ['tabular-nums'] }}>
                        {` · ${formatWhole(mealKcal)}`}
                      </RollingText>
                    ) : null}
                    <Animated.View layout={figureLayout} style={{ flexDirection: 'row', alignItems: 'center' }}>
                      {mealKcal > 0 ? (
                        <BlancText variant="footnote" tone="graphite">
                          {' kcal'}
                        </BlancText>
                      ) : null}
                      {sameDay && !inMeal ? <SymbolView name="chevron.down" size={10} weight="semibold" tintColor={c.graphite} style={{ marginLeft: 4 }} /> : null}
                    </Animated.View>
                  </Pressable>
                </Animated.View>
              ) : null}
            </View>
            {/* Save as meal has one way out: closing it cancels. */}
            {inMeal && !meal?.locked && keepsDraft && !saving ? (
              <Pressable
                accessibilityRole="button"
                hitSlop={8}
                onPress={() => {
                  haptics.tap();
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

          {!chosen && !(meal && mealReview && !paused) ? (
            <Host matchContents={{ vertical: true }} style={{ marginHorizontal: 16, marginTop: 14 }}>
              {/* Keep a save's result visible on its original tab. */}
              <Picker
                selection={tab}
                onSelectionChange={(value: Tab) => openTab(value)}
                modifiers={[pickerStyle('segmented'), disabled(saving)]}>
                <SwiftText modifiers={[tag('recent')]}>Recent</SwiftText>
                <SwiftText modifiers={[tag('saved')]}>Saved</SwiftText>
                <SwiftText modifiers={[tag('search')]}>Search</SwiftText>
                <SwiftText modifiers={[tag('scan')]}>Scan</SwiftText>
                <SwiftText modifiers={[tag('manual')]}>Manual</SwiftText>
                <SwiftText modifiers={[tag('photo'), ...(!gemini && photoWaiting ? [accessibilityLabel('Photo, estimate waiting')] : [])]}>
                  {gemini ? 'AI' : photoWaiting ? 'Photo •' : 'Photo'}
                </SwiftText>
              </Picker>
            </Host>
          ) : null}

          {capturing && meal && mealTotals && !chosen ? (
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
          ) : null}
          {mealError ? (
            <BlancText variant="footnote" tone="live" style={{ marginHorizontal: 20, marginTop: 8 }}>
              {mealError}
            </BlancText>
          ) : null}
        </View>

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
          <FoodReview food={chosen.food} meta={chosen.meta} servings={chosen.servings} />
        ) : (
          <View key={captureKey}>
            {buildMeal}
            {recentTab}
            {savedTab}
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
            <AiTab draft={ai} setDraft={(update) => setAi(update)} />
          </View>
        ) : (
          <View key={`photo-${captureKey}`} style={!chosen && !(meal && mealReview && !paused) && tab === 'photo' ? undefined : { display: 'none' }}>
            <PhotoTab draft={photo} setDraft={(update) => setPhoto(update)} />
          </View>
        )}
      </KeyboardAwareScrollView>
    </LoggerContext.Provider>
  );
}
