import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, TextInput, View, type ViewStyle } from 'react-native';
import Animated, { LayoutAnimationConfig } from 'react-native-reanimated';

import { ensureFoodRow } from '@/lib/foodPersistence';
import { formatMeasurementAmount } from '@/lib/foodUnits';
import { createMealIngredient, decodeMealComposition } from '@/lib/mealComposition';
import { servingLabel } from '@/lib/nutritionLedger';
import { createPendingEntryId } from '@/lib/pendingEntryId';
import { chosenFoodLogSource } from '@/lib/saveNutritionEntry';
import { filterSavedMeals, retireSavedMeal } from '@/lib/savedMeals';
import { getSessionUserId } from '@/lib/sessionUser';
import { searchUsdaFoodsSecureStrict, withUsdaPortion } from '@/lib/usdaClient';
import type { Food } from '@/types';
import { BlancText } from '~/components/BlancText';
import { Capsule } from '~/components/Capsule';
import { HoldMenu, hasHoldMenu, menuAccessibility, showActionSheet, type MenuAction } from '~/components/HoldMenu';
import { Label } from '~/components/Label';
import { Hairline } from '~/components/Row';
import { closeOpenSwipeRow, SwipeRow, useSwipeActions } from '~/components/SwipeRow';
import { formatWhole } from '~/lib/format';
import { saveFoodEntry, type When } from '~/lib/foodLogger';
import { announce, speak, useAnnounce, useLargeText } from '~/lib/accessibility';
import { useFuelStore } from '~/lib/fuel';
import { haptics } from '~/lib/haptics';
import { blockExit, rowEnter, rowExit, rowLayout } from '~/lib/motion';
import { type as typeScale, useBlanc } from '~/theme/blanc';

import { useLogger, type QuickAddState } from './context';

export type AddState = QuickAddState;

/** A quick add whose save did not answer: it may have landed, and + retries the same entry. */
const QUICK_ADD_UNCONFIRMED = "Couldn't confirm. Tap + to try again.";

/** How many USDA searches and portions this session keeps. */
const USDA_CACHE_LIMIT = 50;
/** USDA results by the exact query sent, so typing back to a query needs no new lookup. */
const usdaResults = new Map<string, Food[]>();
/** A result with its household portion, by fdc_id, with the result it was read for. */
const usdaPortions = new Map<string, { food: Food; full: Food }>();

/** Keeps the newest entries; a Map lists keys oldest first. */
function remember<V>(cache: Map<string, V>, key: string, value: V) {
  cache.delete(key);
  cache.set(key, value);
  if (cache.size > USDA_CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
}

/** USDA search, from this session's results when the same query found foods before. */
function searchUsda(query: string): Promise<Food[]> {
  const kept = usdaResults.get(query);
  if (kept) return Promise.resolve(kept);
  return searchUsdaFoodsSecureStrict(query).then((foods) => {
    // A failed lookup throws; an empty answer may be a failure too, so only found foods are kept.
    if (foods.length > 0) remember(usdaResults, query, foods);
    return foods;
  });
}

/** A result with its household portion, read once per food this session. */
async function usdaWithPortion(food: Food): Promise<Food> {
  const key = food.fdc_id;
  const kept = key ? usdaPortions.get(key) : undefined;
  if (kept && JSON.stringify(kept.food) === JSON.stringify(food)) return kept.full;
  const full = await withUsdaPortion(food);
  // Only a portion found is kept: a failed or empty detail read is tried again next time.
  if (key && full !== food) remember(usdaPortions, key, { food, full });
  return full;
}

/**
 * Saves a quick add: the food's row, then the entry. False when either fails.
 * The try lives out here because the React Compiler can't compile a hook that
 * throws inside one.
 */
async function saveQuickAdd(food: Food, entry: Omit<Parameters<typeof saveFoodEntry>[0], 'foodId'>): Promise<boolean> {
  try {
    // Exactly what the row shows (one serving of its basis, or the amount it
    // names), never a portion it did not show.
    const foodId = await ensureFoodRow(food);
    if (!foodId) return false;
    await saveFoodEntry({ ...entry, foodId });
    return true;
  } catch {
    return false;
  }
}

/**
 * Macros as VoiceOver should say them: "250 calories, protein 20 grams,
 * carbs 30 grams, fat 8 grams" for the "250 kcal · P 20 · C 30 · F 8" on screen.
 */
export function spokenMacros(
  totals: { calories: number; protein: number; carbs: number; fat: number },
  round: (value: number) => number | string = Math.round,
): string {
  return speak(`${round(totals.calories)} kcal · protein ${round(totals.protein)} g · carbs ${round(totals.carbs)} g · fat ${round(totals.fat)} g`);
}

/**
 * A search or filter field in the quiet fill capsule, iOS 26's rounded search
 * field. `style` places it (it sits 16 points in and 12 down by default).
 */
export function SearchField({ value, onChange, placeholder, onSubmit, onFocus, editable, style }: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  onSubmit?: () => void;
  onFocus?: () => void;
  editable?: boolean;
  style?: ViewStyle;
}) {
  const c = useBlanc();
  const large = useLargeText();
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          // The field's text grows at the accessibility sizes; the capsule grows with it.
          ...(large ? { minHeight: 44, paddingVertical: 8 } : { height: 44 }),
          marginHorizontal: 16,
          marginTop: 12,
          paddingHorizontal: 14,
          borderRadius: 22,
          borderCurve: 'continuous',
          backgroundColor: c.fill,
          opacity: editable === false ? 0.4 : 1,
        },
        style,
      ]}>
      {/* The field is named for VoiceOver; the glyph is only its look. */}
      <SymbolView name="magnifyingglass" size={16} weight="medium" tintColor={c.graphite} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
      <TextInput
        selectionColor={c.ink}
        value={value}
        onChangeText={onChange}
        onSubmitEditing={onSubmit}
        onFocus={onFocus}
        editable={editable}
        placeholder={placeholder}
        placeholderTextColor={c.graphite}
        returnKeyType="search"
        clearButtonMode="while-editing"
        autoCorrect={false}
        accessibilityRole="search"
        accessibilityLabel={placeholder}
        lineBreakModeIOS="tail"
        style={[typeScale.field, { flex: 1, color: c.ink, padding: 0 }]}
      />
    </View>
  );
}

/**
 * "150 g · 31 g protein": the amount (left out when it is only "1 serving")
 * and its protein, as Fuel's entries write a food. Kcal sits on the right.
 * `composed` says whether it is a built meal when the caller has decoded it.
 */
export function foodLine(food: Food, servings = 1, amount?: string | null, composed?: boolean): string {
  const unit = food.serving_unit?.trim().toLowerCase();
  const measured = Boolean(unit && unit !== 'serving');
  const shown = amount ?? ((composed ?? Boolean(decodeMealComposition(food.description))) ? 'Meal' : measured || servings !== 1 ? servingLabel({ servings, food }) : null);
  const protein = Math.round(food.protein * servings);
  return [shown, protein > 0 ? `${protein} g protein` : null].filter(Boolean).join(' · ');
}

/** One food: tap to review it; the round button logs it at once (one serving unless `servings` says). */
export function FoodRow({ food, state, opening, onOpen, onAdd, onTakeOut, menu, onLongPress, showBasis, detail, composed, servings = 1 }: {
  food: Food;
  state?: AddState;
  /** A built meal, when the list has already decoded it. */
  composed?: boolean;
  /** The quiet line in place of the food's amount and protein. */
  detail?: string;
  /** What + logs, in servings of the food, for the line once it is added. */
  servings?: number;
  /** Tapped and loading its review: the round button spins meanwhile. */
  opening?: boolean;
  /** Search results: say what one serving is, since + logs exactly that. */
  showBasis?: boolean;
  onOpen: () => void;
  onAdd?: () => void;
  /** The tick's tap once it is added: takes that entry back out. */
  onTakeOut?: () => void;
  /** What a hold offers, as iOS's context menu. */
  menu?: MenuAction[];
  onLongPress?: () => void;
}) {
  const c = useBlanc();
  const large = useLargeText();
  // VoiceOver offers the hold menu's items (or the long-press action) and
  // the swipe actions the menu does not cover as the row's own.
  const held = menu && menu.length > 0 ? menuAccessibility(menu) : null;
  const heldLabels = new Set(held ? ['More', ...held.actions.map((action) => action.label)] : []);
  const swipe = (useSwipeActions() ?? []).filter((action) => !heldLabels.has(action.label));
  const actions = [
    ...(held ? held.actions : onLongPress ? [{ name: 'longpress', label: 'More actions' }] : []),
    ...swipe.map((action) => ({ name: `swipe:${action.label}`, label: action.label })),
  ];
  const longPress = held ? (hasHoldMenu ? undefined : () => showActionSheet(food.name, menu ?? [])) : onLongPress;
  const kcal = formatWhole(food.calories * servings);
  // The highlight takes the whole row, the round button's end too, as an iOS cell's does.
  const [pressed, setPressed] = useState(false);
  // A failed quick add may still have landed, so the row says only what is
  // known; its retry reuses the same entry id, so it can't log twice.
  const line = state === 'error'
    ? QUICK_ADD_UNCONFIRMED
    : state === 'done'
      ? 'Added'
      : detail
        ? detail
        : foodLine(food, servings, showBasis ? food.serving_label ?? `${formatMeasurementAmount(food.serving_size || 100)} ${food.serving_unit || 'g'}` : null, composed);
  // The same line in words: "150 g · 31 g protein" as "150 grams, 31 grams protein", "+" as Add.
  const spokenLine = state === 'error' ? "Couldn't confirm. Use Add to try again." : speak(line);
  const row = (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingRight: 16, backgroundColor: pressed ? c.pressed : c.label }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={[food.name, spokenLine, speak(`${kcal} kcal`)].filter(Boolean).join(', ')}
        accessibilityActions={actions.length > 0 ? actions : undefined}
        onAccessibilityAction={(event) => {
          const name = event.nativeEvent.actionName;
          if (held?.run(name)) return;
          if (name === 'longpress') onLongPress?.();
          else swipe.find((action) => `swipe:${action.label}` === name)?.onPress();
        }}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
        onPress={() => {
          // a tap while another row stands open only closes that row, as in Mail
          if (closeOpenSwipeRow()) return;
          haptics.tap();
          onOpen();
        }}
        onLongPress={
          longPress
            ? () => {
                if (closeOpenSwipeRow()) return;
                haptics.select();
                longPress();
              }
            : undefined
        }
        style={{
          flex: 1,
          minWidth: 0,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          minHeight: 60,
          paddingVertical: 10,
          paddingLeft: 18,
          // with no round button the row keeps its 32 points, so kcal stays in its column
          paddingRight: onAdd || opening ? 12 : 44,
        }}>
        {/* At the accessibility sizes the lines wrap and the kcal goes under them instead of squeezing them. */}
        <View style={{ flex: 1, minWidth: 0 }}>
          <BlancText variant="bodyStrong" numberOfLines={large ? undefined : 1}>
            {food.name}
          </BlancText>
          {line ? (
            <BlancText variant="secondary" tone={state === 'error' ? 'live' : 'graphite'} style={{ marginTop: 1 }} numberOfLines={large ? undefined : 1}>
              {line}
            </BlancText>
          ) : null}
          {large ? (
            <BlancText variant="secondary" tone="graphite" style={{ marginTop: 1, fontVariant: ['tabular-nums'] }}>
              {`${kcal} kcal`}
            </BlancText>
          ) : null}
        </View>
        {/* On the food name's line, as Fuel's day list sets it. */}
        {large ? null : (
          <BlancText variant="secondary" tone="graphite" style={[{ fontVariant: ['tabular-nums'] }, line ? { alignSelf: 'flex-start', marginTop: 2 } : null]}>
            {kcal}
          </BlancText>
        )}
      </Pressable>
      {onAdd || opening ? (
        <RoundButton
          symbol={state === 'done' ? 'checkmark' : 'plus'}
          label={opening ? `Opening ${food.name}` : state === 'done' ? `${food.name} added. Take it out` : `Add ${food.name}`}
          busy={state === 'saving' || opening}
          done={state === 'done'}
          onPress={() => (state === 'done' ? onTakeOut?.() : onAdd?.())}
        />
      ) : null}
    </View>
  );
  return held && hasHoldMenu ? (
    <HoldMenu actions={menu ?? []} backdrop={c.label}>
      {row}
    </HoldMenu>
  ) : (
    row
  );
}

/** A quiet disc with an ink mark; the food just logged gets the ink disc and its tick. */
function RoundButton({ symbol, label, busy, done, onPress }: {
  symbol: 'plus' | 'checkmark';
  label: string;
  busy?: boolean;
  /** Already logged: the ink tick, and a tap on it takes the entry back out (it never logs twice). */
  done?: boolean;
  onPress: () => void;
}) {
  const c = useBlanc();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={busy}
      accessibilityState={{ disabled: Boolean(busy), busy: Boolean(busy) }}
      // a 32-point disc, 44 points to touch
      hitSlop={6}
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      style={({ pressed }) => ({
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: done ? c.capsule : c.fill,
        opacity: pressed ? 0.6 : 1,
        transform: [{ scale: pressed ? 0.92 : 1 }],
      })}>
      {busy ? (
        <ActivityIndicator size="small" color={c.ink} />
      ) : (
        <SymbolView name={symbol} size={14} weight="bold" tintColor={done ? c.onCapsule : c.ink} />
      )}
    </Pressable>
  );
}

/** A quick add's key: where it lands (the entry's day and meal), then the food's own key. */
function quickAddKey(when: When, food: string): string {
  const day = when.date;
  return `${day.getFullYear()}-${day.getMonth() + 1}-${day.getDate()}:${when.groupId ?? ''}|${food}`;
}

/**
 * The hold menu's quick add (VoiceOver offers it too), saying what it does
 * now: log the food, or take back out the entry its tick stands for. None
 * while either runs, as the round button is busy then.
 */
export function quickAddMenu({ purpose, state, logTitle, onAdd, onTakeOut }: {
  purpose: 'log' | 'ingredients';
  state?: AddState;
  logTitle: string;
  onAdd: () => void;
  onTakeOut: () => void;
}): MenuAction[] {
  if (purpose === 'ingredients') return [{ title: 'Add as ingredient', symbol: 'plus.circle', run: onAdd }];
  if (state === 'saving') return [];
  if (state === 'done') return [{ title: 'Take it out', symbol: 'minus.circle', destructive: true, run: onTakeOut }];
  return [{ title: logTitle, symbol: 'plus.circle', run: onAdd }];
}

/**
 * One-tap logging from a list: one serving now (or the amount given), into the
 * sheet's meal. Each food keeps its state per destination, so one added to
 * Breakfast can still go to Lunch, and keeps its retry-safe id and first
 * destination until its save is confirmed. A confirmed one stays done, and
 * can't be logged there again, until `takeOut` takes its entry back out.
 */
export function useQuickAdd() {
  const logger = useLogger();
  const { quickAddStates: states, setQuickAddStates: setStates, pendingQuickAdds: pendingAdds, addedQuickAdds: addedEntries } = logger;
  // The rows see only this destination's states, by food.
  const here = quickAddKey(logger.when, '');
  const added: Record<string, AddState> = {};
  if (logger.purpose === 'log') {
    for (const [key, state] of Object.entries(states)) if (key.startsWith(here)) added[key.slice(here.length)] = state;
  }
  // `add` and `takeOut` read the sheet as last drawn from here, so each stays
  // one function and a list redraws only the row whose state changed.
  const drawn = useRef(logger);
  useLayoutEffect(() => {
    drawn.current = logger;
  });

  const add = useCallback(async (foodKey: string, food: Food, options: { servings?: number; source?: string } = {}) => {
    const sheet = drawn.current;
    const servings = options.servings ?? 1;
    if (sheet.purpose === 'ingredients') {
      try {
        sheet.addIngredients([createMealIngredient(food, servings)]);
      } catch (cause) {
        // No FormNote on this path: the sheet's error line is all a sighted person gets.
        announce(cause instanceof Error ? cause.message : 'Could not add ingredient.');
        throw cause;
      }
      return;
    }
    const key = quickAddKey(sheet.when, foodKey);
    const kept = pendingAdds.get(key);
    // One write at a time for a food and meal, read now rather than as drawn,
    // so a second tap before the redraw can't start another; a confirmed one
    // (its removal running or not) is not logged again.
    if (kept?.inFlight || addedEntries.has(key)) return;
    // A retry after an unconfirmed save writes that same entry: its id (the
    // write upserts on it, so it can't log twice), its time and its meal.
    const attempt = kept ?? { pending: createPendingEntryId(), when: sheet.when, groups: sheet.groups, inFlight: false };
    attempt.inFlight = true;
    pendingAdds.set(key, attempt);
    // The id this save writes under (the same one a retry reuses), kept for taking it back.
    const entryId = attempt.pending.take();
    const release = sheet.beginSave();
    setStates((state) => ({ ...state, [key]: 'saving' }));
    const saved = await saveQuickAdd(food, {
      servings,
      source: options.source ?? chosenFoodLogSource(food),
      when: attempt.when,
      groups: attempt.groups,
      pending: attempt.pending,
    });
    attempt.inFlight = false;
    if (!saved) {
      haptics.error();
      setStates((state) => ({ ...state, [key]: 'error' }));
      release();
      announce(`Couldn't confirm ${food.name}`);
      return;
    }
    pendingAdds.delete(key);
    addedEntries.set(key, { id: entryId, name: food.name, removing: false });
    haptics.success();
    setStates((state) => ({ ...state, [key]: 'done' }));
    release();
    // The row says so too, but VoiceOver stays on the + it pressed.
    announce(`${food.name} added`);
    // Fuel, Today and the widgets show it at once, whether or not the sheet stays open.
    void useFuelStore.getState().refreshAfterWrite();
  }, [pendingAdds, addedEntries, setStates]);

  // Takes back what a quick add logged (a mis-tapped +), and the + comes back.
  // Its removal holds the food and meal as an add does: nothing logs it again
  // until the removal has answered.
  const takeOut = useCallback(async (foodKey: string) => {
    const sheet = drawn.current;
    const key = quickAddKey(sheet.when, foodKey);
    const logged = addedEntries.get(key);
    if (!logged || logged.removing) return;
    logged.removing = true;
    const release = sheet.beginSave();
    setStates((state) => ({ ...state, [key]: 'saving' }));
    const removed = await useFuelStore.getState().deleteEntry(logged.id).catch(() => false);
    logged.removing = false;
    release();
    if (!removed) {
      haptics.error();
      setStates((state) => ({ ...state, [key]: 'done' }));
      announce(`Couldn't take out ${logged.name}`);
      return;
    }
    addedEntries.delete(key);
    haptics.success();
    setStates((state) => {
      const next = { ...state };
      delete next[key];
      return next;
    });
    announce(`${logged.name} taken out`);
    void useFuelStore.getState().refreshAfterWrite();
  }, [addedEntries, setStates]);

  return { added, add, takeOut, enabled: !logger.editing };
}

/**
 * Saved meals: review, quick add; each meal swipes (or holds) for Edit and
 * Delete, which VoiceOver offers as the row's own actions. A new saved meal is
 * the sheet's row under the list, as Build a meal is under Recent.
 */
export function SavedTab({ onEditSavedMeal }: { onEditSavedMeal: (meal: Food) => void }) {
  const logger = useLogger();
  const { added, add: quickAdd, takeOut: quickTakeOut, enabled } = useQuickAdd();
  const meals = logger.savedMeals;

  const open = (meal: Food) => {
    if (logger.purpose === 'log' && decodeMealComposition(meal.description)) logger.composeMeal(meal);
    else logger.chooseFood(meal);
  };
  const add = (meal: Food) => void quickAdd(meal.id, meal);
  const takeOut = (meal: Food) => void quickTakeOut(meal.id);

  // A deleted meal slides away at once (no question, as a swipe in Mail; past
  // logs keep it) and comes back if retiring it fails.
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const retire = async (meal: Food) => {
    setHidden((current) => new Set(current).add(meal.id));
    const userId = await getSessionUserId();
    const { error } = userId
      ? await retireSavedMeal(userId, meal.id).catch((failure: unknown) => ({ error: failure }))
      : { error: new Error('signed out') };
    if (error) {
      haptics.error();
      setHidden((current) => {
        const next = new Set(current);
        next.delete(meal.id);
        return next;
      });
      Alert.alert('Not deleted', userId ? 'Check your connection and try again.' : 'Please sign in again to delete saved meals.');
      return;
    }
    haptics.success();
    await logger.reloadSavedMeals();
  };
  const remove = (meal: Food) => void retire(meal);

  // The sheet's Search foods field finds saved meals as well, so this list has no filter of its own.
  const visible = (meals ?? []).filter((meal) => !hidden.has(meal.id));
  const rows = visible.map((meal, index) => (
    <SavedRow
      key={meal.id}
      meal={meal}
      divided={index > 0}
      state={added[meal.id]}
      purpose={logger.purpose}
      quickAdd={enabled}
      onOpen={open}
      onAdd={add}
      onTakeOut={takeOut}
      onEdit={onEditSavedMeal}
      onRemove={remove}
    />
  ));

  // Leaving the tab drops the list at once; only a deleted meal slides away.
  return (
    <LayoutAnimationConfig skipEntering skipExiting>
      <View>
        {visible.length > 0 ? (
          // 14 points down, where Recent's card starts.
          <Label style={{ marginTop: 14, overflow: 'hidden' }} entering={rowEnter} exiting={blockExit} layout={rowLayout}>
            {rows}
          </Label>
        ) : null}
        {meals === null ? <ActivityIndicator style={{ marginTop: 32 }} /> : null}
        {meals !== null && visible.length === 0 ? (
          <Animated.View entering={rowEnter} layout={rowLayout}>
            <Empty text="No saved meals yet." />
          </Animated.View>
        ) : null}
      </View>
    </LayoutAnimationConfig>
  );
}

/** One saved meal; drawn again only when its own meal or state changes. */
function SavedRow({ meal, divided, state, purpose, quickAdd, onOpen, onAdd, onTakeOut, onEdit, onRemove }: {
  meal: Food;
  divided: boolean;
  state?: AddState;
  purpose: 'log' | 'ingredients';
  quickAdd: boolean;
  onOpen: (meal: Food) => void;
  onAdd: (meal: Food) => void;
  onTakeOut: (meal: Food) => void;
  onEdit: (meal: Food) => void;
  onRemove: (meal: Food) => void;
}) {
  // Decoded once for the quick add, the menu and the row's line.
  const composed = Boolean(decodeMealComposition(meal.description));
  const canQuickAdd = quickAdd && !composed;
  const menu: MenuAction[] = [
    ...(canQuickAdd
      ? quickAddMenu({ purpose, state, logTitle: 'Log one serving now', onAdd: () => onAdd(meal), onTakeOut: () => onTakeOut(meal) })
      : []),
    { title: 'Review and log', symbol: 'list.bullet.rectangle', run: () => onOpen(meal) },
    ...(purpose === 'log'
      ? [
          { title: 'Edit saved meal', symbol: 'pencil', run: () => onEdit(meal) },
          { title: 'Delete', subtitle: 'Past logged entries stay', symbol: 'trash', destructive: true, removes: true, run: () => onRemove(meal) },
        ]
      : []),
  ];
  const row = (
    <FoodRow
      food={meal}
      composed={composed}
      state={state}
      onOpen={() => onOpen(meal)}
      onAdd={canQuickAdd ? () => onAdd(meal) : undefined}
      onTakeOut={() => onTakeOut(meal)}
      menu={menu}
    />
  );
  return (
    <Animated.View entering={rowEnter} exiting={rowExit} layout={rowLayout}>
      {divided ? <Hairline /> : null}
      {purpose === 'log' ? (
        <SwipeRow
          name={meal.name}
          actions={[
            { label: 'Edit', onPress: () => onEdit(meal) },
            { label: 'Delete', destructive: true, onPress: () => onRemove(meal) },
          ]}>
          {row}
        </SwipeRow>
      ) : (
        row
      )}
    </Animated.View>
  );
}

/**
 * USDA search results for the words in Log food's Search foods field (two
 * letters or more), with Retry on failure. The sheet owns the field and its
 * words, so they outlast a food's review and an ingredient added.
 */
export function SearchTab({ query }: { query: string }) {
  const logger = useLogger();
  // USDA's last answer, with the words it answers (no foods: the search failed).
  const [found, setFound] = useState<{ query: string; foods: Food[] | null } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [opening, setOpening] = useState<string | null>(null);
  const { added, add: quickAdd, takeOut: quickTakeOut, enabled } = useQuickAdd();
  const trimmed = query.trim();
  // A result's portion read claims the sheet until the review opens, so Snap a
  // meal can't hide that review behind the camera. Closing meanwhile loses
  // nothing, so it is not held (beginRead, not beginBusy).
  const { beginRead } = logger;
  useEffect(() => {
    if (!opening) return;
    return beginRead();
  }, [opening, beginRead]);
  // Only an answer to the words in the field shows. Once they change, the
  // last words' results give way to the spinner, so no row on screen (or its +)
  // belongs to other words.
  const answer = trimmed.length >= 2 && found?.query === trimmed ? found : null;
  const results = answer?.foods ?? null;
  const failed = answer !== null && answer.foods === null;
  const searching = trimmed.length >= 2 && answer === null;
  // Results land a moment after typing stops: VoiceOver says how many.
  useAnnounce(
    failed
      ? 'The search failed.'
      : results !== null
        ? results.length === 0
          ? 'No USDA matches.'
          : `${results.length} result${results.length === 1 ? '' : 's'}`
        : null,
  );

  useEffect(() => {
    if (trimmed.length < 2) return;
    let current = true;
    const timer = setTimeout(() => {
      searchUsda(trimmed)
        .then((foods) => {
          if (current) setFound({ query: trimmed, foods });
        })
        .catch(() => {
          if (current) setFound({ query: trimmed, foods: null });
        });
    }, 350);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [trimmed, attempt]);

  // Your own saved meals that match come first, found as you type; USDA's follow.
  const saved = trimmed.length >= 2 ? filterSavedMeals(logger.savedMeals ?? [], trimmed) : [];
  const openSaved = (meal: Food) => {
    if (logger.purpose === 'log' && decodeMealComposition(meal.description)) logger.composeMeal(meal);
    else logger.chooseFood(meal);
  };

  const open = async (food: Food) => {
    if (opening) return;
    setOpening(food.fdc_id || food.id);
    // without its portion, the food opens as listed
    logger.chooseFood(await usdaWithPortion(food).catch(() => food));
    setOpening(null);
  };
  const add = (key: string, food: Food) => void quickAdd(key, food);
  const takeOut = (key: string) => void quickTakeOut(key);

  // Named only while both kinds show, so a list of one kind carries no heading.
  const both = saved.length > 0 && Boolean(results && results.length > 0);
  return (
    <View>
      {saved.length > 0 ? (
        <>
          {both ? <GroupCaption>Saved</GroupCaption> : null}
          <Label style={{ marginTop: 6, overflow: 'hidden' }}>
            {saved.map((meal, index) => {
              const composed = Boolean(decodeMealComposition(meal.description));
              return (
                <View key={meal.id}>
                  {index > 0 ? <Hairline /> : null}
                  <FoodRow
                    food={meal}
                    composed={composed}
                    state={added[meal.id]}
                    onOpen={() => openSaved(meal)}
                    onAdd={enabled && !composed ? () => add(meal.id, meal) : undefined}
                    onTakeOut={() => takeOut(meal.id)}
                  />
                </View>
              );
            })}
          </Label>
        </>
      ) : null}
      {both ? <GroupCaption>Foods</GroupCaption> : null}
      {results && results.length > 0 ? (
        // 14 points under the field, past the sheet header's own 8.
        <Label style={{ marginTop: 6, overflow: 'hidden' }}>
          {results.map((food, index) => {
            const key = food.fdc_id || food.id;
            return (
              <SearchRow
                key={key}
                food={food}
                rowKey={key}
                divided={index > 0}
                state={added[key]}
                opening={opening === key}
                dimmed={Boolean(opening) && opening !== key}
                quickAdd={enabled}
                onOpen={open}
                onAdd={add}
                onTakeOut={takeOut}
              />
            );
          })}
        </Label>
      ) : null}
      {searching ? <ActivityIndicator style={{ marginTop: 32 }} /> : null}
      {trimmed.length === 1 ? <Empty text="Type at least 2 characters." /> : null}
      {results !== null && results.length === 0 && saved.length === 0 ? (
        <>
          <Empty text="No USDA matches." />
          {/* Not a dead end: the food can still go in by hand, with its name already typed. */}
          {logger.purpose === 'log' && logger.enterManually ? (
            <Capsule title="Enter it manually" variant="quiet" onPress={() => logger.enterManually?.(trimmed)} style={{ alignSelf: 'center', marginTop: 14 }} />
          ) : null}
        </>
      ) : null}
      {failed ? (
        <View style={{ alignItems: 'center', gap: 14, marginTop: 32 }}>
          <BlancText variant="secondary" tone="graphite">
            The search failed. Check your connection.
          </BlancText>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10 }}>
            <Capsule
              title="Retry"
              variant="quiet"
              onPress={() => {
                // the spinner, not the failure, while it tries again
                setFound(null);
                setAttempt((value) => value + 1);
              }}
            />
            {/* Offline, typing it in is the way on. */}
            {logger.purpose === 'log' && logger.enterManually ? (
              <Capsule title="Enter it manually" variant="quiet" onPress={() => logger.enterManually?.(trimmed)} />
            ) : null}
          </View>
        </View>
      ) : null}
    </View>
  );
}

/** The small heading over saved matches and USDA's, in the sheet's column-label style. */
function GroupCaption({ children }: { children: string }) {
  return (
    <BlancText variant="footnote" tone="graphite" accessibilityRole="header" style={{ marginTop: 14, marginHorizontal: 20 }}>
      {children}
    </BlancText>
  );
}

/** One USDA result; drawn again only when its own state changes or another opens. */
function SearchRow({ food, rowKey, divided, state, opening, dimmed, quickAdd, onOpen, onAdd, onTakeOut }: {
  food: Food;
  rowKey: string;
  divided: boolean;
  state?: AddState;
  opening: boolean;
  /** Another result is opening. */
  dimmed: boolean;
  quickAdd: boolean;
  onOpen: (food: Food) => Promise<void>;
  onAdd: (key: string, food: Food) => void;
  onTakeOut: (key: string) => void;
}) {
  return (
    <View style={{ opacity: dimmed ? 0.5 : 1 }}>
      {divided ? <Hairline /> : null}
      <FoodRow
        food={food}
        state={state}
        opening={opening}
        showBasis
        onOpen={() => void onOpen(food)}
        onAdd={quickAdd ? () => onAdd(rowKey, food) : undefined}
        onTakeOut={() => onTakeOut(rowKey)}
      />
    </View>
  );
}

export function Empty({ text }: { text: string }) {
  return (
    <BlancText variant="secondary" tone="graphite" style={{ textAlign: 'center', marginTop: 32, marginHorizontal: 32 }}>
      {text}
    </BlancText>
  );
}
