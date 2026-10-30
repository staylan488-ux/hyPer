import { Host, Picker, Text as SwiftText } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { format, isToday } from 'date-fns';
import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActionSheetIOS, Alert, Pressable, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

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
import { readSavedFoodsCache, writeSavedFoodsCache } from '@/lib/savedFoodsCache';
import { loadSavedMeals } from '@/lib/savedMeals';
import { getSessionUserId } from '@/lib/sessionUser';
import { useAuthStore } from '@/stores/authStore';
import type { Food, NutritionGroup } from '@/types';
import { BlancText } from '~/components/BlancText';
import { Capsule } from '~/components/Capsule';
import { GlassButton } from '~/components/GlassButton';
import { Label } from '~/components/Label';
import { Row } from '~/components/Row';
import { dismissOpenSwipeRow } from '~/components/SwipeRow';
import { formatWhole } from '~/lib/format';
import { initialWhen, usesDayGroups, type When } from '~/lib/foodLogger';
import { groupsForDay, loadDayGroups, suggestedGroup, today, useFuelStore, type FoodLog } from '~/lib/fuel';
import { haptics } from '~/lib/haptics';
import { useLeaveGuard } from '~/lib/leaveGuard';
import { loadYouMeals, useYouMealsStore } from '~/lib/you';
import { LoggerContext, type ChosenMeta, type LoggerContextValue } from '~/fuel/context';
import { Empty, SavedTab, SearchTab } from '~/fuel/FoodLists';
import { FoodReview } from '~/fuel/FoodReview';
import { emptyManual, manualFromFood, manualHasChanges, ManualTab, type ManualDraft } from '~/fuel/ManualTab';
import { MealReview } from '~/fuel/MealReview';
import { aiHasDraft, AiTab, emptyAi, type AiDraft } from '~/fuel/AiTab';
import { emptyPhoto, PhotoTab, type PhotoDraft } from '~/fuel/PhotoTab';
import { ScanTab } from '~/fuel/ScanTab';
import { useBlanc } from '~/theme/blanc';

type Tab = 'saved' | 'search' | 'scan' | 'manual' | 'photo';

/**
 * Log food, or edit an entry: Saved, Search (USDA), Scan, Manual and Photo,
 * a review for a chosen food, and the meal builder, by the web logger's rules.
 * Params: `entry` (an entry id to edit), `day` (yyyy-MM-dd, default today),
 * `group` (the meal to add to).
 */
export default function LogFoodSheet() {
  const params = useLocalSearchParams<{ entry?: string; day?: string; group?: string; savedMeal?: string }>();
  const userId = useAuthStore((state) => state.user?.id) ?? '';
  // read once: the entry being edited stays as it was when the sheet opened
  const [editing] = useState<FoodLog | null>(() => (params.entry ? useFuelStore.getState().logs.find((log) => log.id === params.entry) ?? null : null));
  // A built meal opened from You's Saved meals, to change for future logs.
  const [savedMeal] = useState<Food | null>(() =>
    params.savedMeal ? useYouMealsStore.getState().meals?.find((meal) => meal.id === params.savedMeal) ?? null : null,
  );
  const selectedKey = editing?.date ?? params.day ?? today();
  if (!userId) return <Empty text="Sign in to log food." />;
  return (
    <LoggerSession
      key={`${userId}:${editing?.id ?? savedMeal?.id ?? 'new'}`}
      userId={userId}
      editing={editing}
      savedMeal={savedMeal}
      selectedKey={selectedKey}
      groupParam={params.group ?? null}
    />
  );
}

function LoggerSession({ userId, editing, savedMeal, selectedKey, groupParam }: {
  userId: string;
  editing: FoodLog | null;
  savedMeal: Food | null;
  selectedKey: string;
  groupParam: string | null;
}) {
  const c = useBlanc();
  const [groups, setGroups] = useState<NutritionGroup[]>(() => useFuelStore.getState().groups.filter((group) => group.date === selectedKey));
  // A new entry today goes to the meal that fits the clock; on another day the
  // clock says nothing about the meal, so it starts Unassigned, as on the web.
  const suggest = (list: NutritionGroup[]) => (selectedKey === today() ? suggestedGroup(list)?.id ?? null : null);
  const [when, setWhenState] = useState<When>(() =>
    initialWhen(editing, selectedKey, groups, groupParam ?? suggest(groups)),
  );
  const groupTouched = useRef(Boolean(editing || groupParam));
  const setWhen = useCallback((next: When) => {
    groupTouched.current = true;
    setWhenState(next);
  }, []);

  // The day's groups (Breakfast, Lunch and Dinner are created if missing);
  // a new entry then goes to the meal that fits the time.
  useEffect(() => {
    let current = true;
    void loadDayGroups(selectedKey).then((loaded) => {
      if (!current) return;
      setGroups(loaded);
      if (!groupTouched.current) setWhenState((value) => ({ ...value, groupId: suggest(loaded) }));
    });
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey]);

  // The day's groups can land after the sheet opened (the month was still
  // loading): pick them up instead of offering only Unassigned.
  const storeGroups = useFuelStore((state) => state.groups);
  useEffect(() => {
    const fromStore = groupsForDay(selectedKey);
    if (fromStore.length === 0) return;
    setGroups((current) => (current.map((group) => group.id).join() === fromStore.map((group) => group.id).join() ? current : fromStore));
    if (!groupTouched.current) setWhenState((value) => (value.groupId ? value : { ...value, groupId: suggest(fromStore) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeGroups, selectedKey]);

  const [tab, setTab] = useState<Tab>(editing ? 'manual' : 'saved');
  const [chosen, setChosen] = useState<{ food: Food; meta: ChosenMeta } | null>(null);
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
  const [busy, setBusy] = useState(false);
  // A confirmed save (or a discarded meal edit) closes the sheet without
  // asking about the work it settled: the guard sees `closing` first, then an
  // effect closes.
  const [closing, setClosing] = useState(false);
  const photoWaiting = tab !== 'photo' && photo.items.length > 0 && getFoodAnalysisMode() !== 'gemini';

  // Saved meals: the last list at once, refetched on open.
  const [savedMeals, setSavedMeals] = useState<Food[] | null>(() => readSavedFoodsCache(userId));
  const reloadSavedMeals = useCallback(async () => {
    const id = await getSessionUserId();
    if (!id) return;
    const { meals, error } = await loadSavedMeals(id);
    if (error) {
      setSavedMeals((current) => current ?? []);
      return;
    }
    setSavedMeals(meals);
    writeSavedFoodsCache(id, meals);
  }, []);
  useEffect(() => {
    void reloadSavedMeals();
  }, [reloadSavedMeals]);

  // ── Meal builder (web MealLogger) ──
  const [savedTarget, setSavedTarget] = useState<Food | undefined>();
  const draftKey = editing ? `edit:${editing.id}` : savedTarget ? `saved:${savedTarget.id}` : 'new';
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
  const [meal, setMeal] = useState<MealDraft | null>(() =>
    loadMealDraft(userId, editing ? `edit:${editing.id}` : 'new') ??
    (editing?.food && decodeMealComposition(editing.food.description) ? makeDraft(editing.food, editing.servings) : null),
  );
  const [mealReview, setMealReview] = useState(Boolean(meal));
  const [paused, setPaused] = useState(false);
  const [storageFailed, setStorageFailed] = useState(false);
  const [captureKey, setCaptureKey] = useState(0);
  const [mealError, setMealError] = useState('');

  const updateMeal = useCallback(
    (patch: Partial<MealDraft>) => {
      setMeal((current) => {
        if (!current) return current;
        const next = { ...current, ...patch };
        setStorageFailed(!saveMealDraft(userId, next, draftKey));
        return next;
      });
    },
    [userId, draftKey],
  );

  const startMeal = useCallback(
    (food?: Food, editSaved = false) => {
      const next = makeDraft(food);
      next.saveAsReusableMeal = editSaved;
      const targetKey = editSaved && food ? `saved:${food.id}` : 'new';
      setSavedTarget(editSaved ? food : undefined);
      const value = loadMealDraft(userId, targetKey) ?? next;
      setMeal(value);
      setStorageFailed(!saveMealDraft(userId, value, targetKey));
      setMealReview(Boolean(food) || value !== next);
      setChosen(null);
    },
    [makeDraft, userId],
  );
  // Opened from You to change a built meal: straight into its builder.
  const openedSaved = useRef(false);
  useEffect(() => {
    if (!savedMeal || openedSaved.current || !decodeMealComposition(savedMeal.description)) return;
    openedSaved.current = true;
    startMeal(savedMeal, true);
  }, [savedMeal, startMeal]);

  const discardMeal = () => {
    if (meal?.locked) return;
    clearMealDraft(userId, draftKey);
    setMeal(null);
    setSavedTarget(undefined);
    setMealReview(false);
    setMealError('');
    if (editing || savedMeal) setClosing(true);
  };

  const capturing = Boolean(meal) && !mealReview && !paused;
  const purpose: LoggerContextValue['purpose'] = capturing ? 'ingredients' : 'log';

  const complete = useCallback(() => {
    void useFuelStore.getState().refresh();
    setClosing(true);
  }, []);

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
      editing,
      selectedKey,
      groups,
      when,
      setWhen,
      savedMeals,
      reloadSavedMeals,
      chooseFood: (food, meta = null) => setChosen({ food, meta }),
      addIngredients,
      composeMeal: (food, editSaved) => startMeal(food, editSaved),
      complete,
      setBusy,
    }),
    [purpose, editing, selectedKey, groups, when, setWhen, savedMeals, reloadSavedMeals, addIngredients, startMeal, complete],
  );

  // Closing (✕, swipe down) with work that is not logged yet asks first: an
  // analysis running, an estimate, typed or changed Manual fields, or a meal
  // this device could not keep. A built meal is kept for next time anyway.
  const estimate = ai.items.length > 0 || photo.items.length > 0;
  const unsaved =
    busy ||
    aiHasDraft(ai) ||
    (!gemini && (photo.items.length > 0 || Boolean(photo.photos.top || photo.photos.side))) ||
    manualHasChanges(manual, manualBase, savedMeals) ||
    (Boolean(meal) && storageFailed);
  useLeaveGuard(
    unsaved && !closing,
    busy
      ? { title: 'Stop the analysis?', message: 'The result is lost if you close now.' }
      : estimate
        ? { title: 'Discard this estimate?', message: 'You have not logged it yet.' }
        : editing
          ? { title: 'Discard your changes?', message: 'The entry stays as it was.' }
          : { title: 'Discard this entry?', message: 'It has not been logged yet.' },
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
  const title = inMeal ? (savedTarget ? 'Edit saved meal' : editing ? 'Edit meal' : 'Build a meal') : editing ? 'Edit entry' : 'Log food';
  const subtitle = inMeal
    ? capturing
      ? 'Add ingredients'
      : null
    : !sameDay
      ? `Unassigned on ${format(when.date, 'MMM d')}`
      : `Adds to ${destination ? nutritionGroupLabel(destination, groups) : 'Unassigned'}`;

  const openTab = (next: Tab) => {
    haptics.select();
    setTab(next);
    setChosen(null);
    // a barcode binding only survives the guided miss → manual path
    if (next !== 'manual') setManual((current) => (current.barcodeBinding ? { ...current, barcodeBinding: null } : current));
  };

  const mealTotals = meal ? getMealTotals(meal.ingredients) : null;

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
              <GlassButton symbol="chevron.left" accessibilityLabel="Back" onPress={() => setChosen(null)} />
            ) : (
              <GlassButton symbol="xmark" accessibilityLabel="Close" onPress={() => router.back()} />
            )}
            <View style={{ alignItems: 'center', flex: 1 }}>
              <BlancText variant="headline" accessibilityRole="header" numberOfLines={1}>
                {title}
              </BlancText>
              {subtitle ? (
                <Pressable
                  accessibilityRole={sameDay && !inMeal ? 'button' : 'text'}
                  accessibilityLabel={sameDay && !inMeal ? `${subtitle}. Change` : subtitle}
                  disabled={!sameDay || inMeal}
                  // a 13-point line, 44 points to touch
                  hitSlop={{ top: 13, bottom: 13, left: 16, right: 16 }}
                  onPress={chooseDestination}
                  style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 4, opacity: pressed ? 0.5 : 1 })}>
                  <BlancText variant="footnote" tone="graphite">
                    {subtitle}
                  </BlancText>
                  {sameDay && !inMeal ? <SymbolView name="chevron.down" size={10} weight="semibold" tintColor={c.graphite} /> : null}
                </Pressable>
              ) : null}
            </View>
            {inMeal && !meal?.locked ? (
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
                <BlancText variant="bodyStrong" size={15}>
                  Discard
                </BlancText>
              </Pressable>
            ) : (
              <View style={{ width: 44 }} />
            )}
          </View>

          {!chosen && !(meal && mealReview && !paused) ? (
            <Host matchContents={{ vertical: true }} style={{ marginHorizontal: 16, marginTop: 14 }}>
              <Picker selection={tab} onSelectionChange={(value: Tab) => openTab(value)} modifiers={[pickerStyle('segmented')]}>
                <SwiftText modifiers={[tag('saved')]}>Saved</SwiftText>
                <SwiftText modifiers={[tag('search')]}>Search</SwiftText>
                <SwiftText modifiers={[tag('scan')]}>Scan</SwiftText>
                <SwiftText modifiers={[tag('manual')]}>Manual</SwiftText>
                <SwiftText modifiers={[tag('photo')]}>{gemini ? 'AI' : photoWaiting ? 'Photo •' : 'Photo'}</SwiftText>
              </Picker>
            </Host>
          ) : null}

          {capturing && meal && mealTotals && !chosen ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 20, marginTop: 12 }}>
              <BlancText variant="secondary" tone="graphite" style={{ flex: 1 }}>
                {meal.ingredients.length} ingredient{meal.ingredients.length === 1 ? '' : 's'} · {formatWhole(mealTotals.calories)} kcal
              </BlancText>
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
            editingEntryId={editing?.id}
            storageFailed={storageFailed}
            onAddIngredients={() => setMealReview(false)}
            onPause={() => setPaused(true)}
            onSaved={() => {
              clearMealDraft(userId, draftKey);
              if (savedTarget) {
                void reloadSavedMeals();
                void loadYouMeals();
              }
              complete();
            }}
          />
        ) : chosen ? (
          <FoodReview food={chosen.food} meta={chosen.meta} onBack={() => setChosen(null)} />
        ) : (
          <View key={captureKey}>
            {!editing && (!meal || paused) ? (
              <View style={{ marginTop: 14 }}>
                <Label>
                  <Row
                    title={paused ? 'Resume pending meal' : 'Build a meal'}
                    detail={paused ? 'Finish saving the meal you built' : 'Combine several foods into one entry'}
                    chevron
                    disabled={busy}
                    onPress={() => (paused ? setPaused(false) : startMeal())}
                  />
                </Label>
              </View>
            ) : null}
            {tab === 'saved' ? (
              <SavedTab
                onNewSavedMeal={() => {
                  loadManual({ ...emptyManual, saveAsReusable: true });
                  setTab('manual');
                }}
                onEditSavedMeal={(saved) => {
                  if (decodeMealComposition(saved.description)) {
                    startMeal(saved, true);
                    return;
                  }
                  loadManual({ ...emptyManual, fields: manualFromFood(saved), selectedSavedMealId: saved.id });
                  setTab('manual');
                }}
              />
            ) : null}
            {tab === 'search' ? <SearchTab /> : null}
            {tab === 'scan' ? (
              <ScanTab
                onCreateProduct={(barcode) => {
                  loadManual({ ...emptyManual, saveAsReusable: true, barcodeBinding: barcode });
                  setTab('manual');
                }}
              />
            ) : null}
            {tab === 'manual' ? (
              <ManualTab
                draft={manual}
                setDraft={(update) => setManual(update)}
                onGeminiHandoff={
                  gemini
                    ? (description) => {
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
            ) : null}
            {tab === 'photo' && !gemini ? <PhotoTab draft={photo} setDraft={(update) => setPhoto(update)} /> : null}
          </View>
        )}
        {/* Stays mounted while hidden, as on the web: an analysis in flight and
            each food's retry-safe ids survive a tab switch or a food review. */}
        {gemini ? (
          <View key={`ai-${captureKey}`} style={!chosen && !(meal && mealReview && !paused) && tab === 'photo' ? undefined : { display: 'none' }}>
            <AiTab draft={ai} setDraft={(update) => setAi(update)} />
          </View>
        ) : null}
      </KeyboardAwareScrollView>
    </LoggerContext.Provider>
  );
}
