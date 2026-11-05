import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, TextInput, View } from 'react-native';
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
import { saveFoodEntry } from '~/lib/foodLogger';
import { announce, speak, useAnnounce, useLargeText } from '~/lib/accessibility';
import { useFuelStore } from '~/lib/fuel';
import { haptics } from '~/lib/haptics';
import { blockExit, rowEnter, rowExit, rowLayout } from '~/lib/motion';
import { type as typeScale, useBlanc } from '~/theme/blanc';

import { useLogger, type QuickAddState } from './context';

export type AddState = QuickAddState;

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

/** A search or filter field in the quiet fill capsule. */
export function SearchField({ value, onChange, placeholder, onSubmit, autoFocus }: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  onSubmit?: () => void;
  /** Picking the tab means typing next. */
  autoFocus?: boolean;
}) {
  const c = useBlanc();
  const large = useLargeText();
  return (
    <View
      style={{
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
      }}>
      <SymbolView name="magnifyingglass" size={16} weight="medium" tintColor={c.graphite} />
      <TextInput
        value={value}
        onChangeText={onChange}
        onSubmitEditing={onSubmit}
        autoFocus={autoFocus}
        placeholder={placeholder}
        placeholderTextColor={c.graphite}
        returnKeyType="search"
        clearButtonMode="while-editing"
        autoCorrect={false}
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
export function FoodRow({ food, state, opening, onOpen, onAdd, editing, onEdit, onDelete, menu, onLongPress, showBasis, detail, composed, servings = 1 }: {
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
  editing?: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
  /** What a hold offers, as iOS's context menu (not while editing). */
  menu?: MenuAction[];
  onLongPress?: () => void;
}) {
  const c = useBlanc();
  const large = useLargeText();
  // VoiceOver offers the hold menu's items (or the long-press action) and
  // the swipe actions the menu does not cover as the row's own.
  const held = menu && menu.length > 0 && !editing ? menuAccessibility(menu) : null;
  const heldLabels = new Set(held ? ['More', ...held.actions.map((action) => action.label)] : []);
  const swipe = (useSwipeActions() ?? []).filter((action) => !heldLabels.has(action.label));
  const actions = [
    ...(held ? held.actions : onLongPress && !editing ? [{ name: 'longpress', label: 'More actions' }] : []),
    ...swipe.map((action) => ({ name: `swipe:${action.label}`, label: action.label })),
  ];
  const longPress = held ? (hasHoldMenu ? undefined : () => showActionSheet(food.name, menu ?? [])) : editing ? undefined : onLongPress;
  const kcal = formatWhole(food.calories * servings);
  // The highlight takes the whole row, the round button's end too, as an iOS cell's does.
  const [pressed, setPressed] = useState(false);
  const line = state === 'error'
    ? 'Not saved. Tap + to try again.'
    : state === 'done'
      ? 'Added'
      : detail
        ? detail
        : foodLine(food, servings, showBasis ? food.serving_label ?? `${formatMeasurementAmount(food.serving_size || 100)} ${food.serving_unit || 'g'}` : null, composed);
  // The same line in words: "150 g · 31 g protein" as "150 grams, 31 grams protein", "+" as Add.
  const spokenLine = state === 'error' ? 'Not saved. Add it again to retry.' : speak(line);
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
          (editing ? onEdit : onOpen)?.();
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
          paddingRight: editing || onAdd || opening ? 12 : 44,
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
        {large ? null : (
          <BlancText variant="secondary" tone="graphite" style={{ fontVariant: ['tabular-nums'] }}>
            {kcal}
          </BlancText>
        )}
      </Pressable>
      {editing ? (
        <RoundButton symbol="trash" label={`Delete ${food.name}`} onPress={() => onDelete?.()} />
      ) : onAdd || opening ? (
        <RoundButton
          symbol={state === 'done' ? 'checkmark' : 'plus'}
          label={opening ? `Opening ${food.name}` : state === 'done' ? `${food.name} added` : `Add ${food.name}`}
          busy={state === 'saving' || opening}
          done={state === 'done'}
          onPress={() => onAdd?.()}
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
  symbol: 'plus' | 'checkmark' | 'trash';
  label: string;
  busy?: boolean;
  /** Already logged: the tick stays put so a second tap can't log it twice. */
  done?: boolean;
  onPress: () => void;
}) {
  const c = useBlanc();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={busy || done}
      accessibilityState={{ disabled: Boolean(busy || done), busy: Boolean(busy) }}
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

/**
 * One-tap logging from a list: one serving now (or the amount given), into the
 * sheet's meal. Each food keeps its retry-safe id until its save is confirmed.
 */
export function useQuickAdd() {
  const logger = useLogger();
  const { quickAddStates: added, setQuickAddStates: setAdded, pendingQuickAdds: pendingIds } = logger;
  // `add` reads the sheet as last drawn from here, so it stays one function
  // and a list redraws only the row whose state changed.
  const drawn = useRef({ added, logger });
  useLayoutEffect(() => {
    drawn.current = { added, logger };
  });

  const add = useCallback(async (key: string, food: Food, options: { servings?: number; source?: string } = {}) => {
    const { added: states, logger: sheet } = drawn.current;
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
    const current = states[key];
    if (current === 'saving' || current === 'done') return;
    const release = sheet.beginSave();
    const pending = pendingIds.get(key) ?? createPendingEntryId();
    pendingIds.set(key, pending);
    setAdded((state) => ({ ...state, [key]: 'saving' }));
    const saved = await saveQuickAdd(food, {
      servings,
      source: options.source ?? chosenFoodLogSource(food),
      when: sheet.when,
      groups: sheet.groups,
      pending,
    });
    if (!saved) {
      haptics.error();
      setAdded((state) => ({ ...state, [key]: 'error' }));
      release();
      announce(`${food.name} not saved`);
      return;
    }
    pendingIds.delete(key);
    haptics.success();
    setAdded((state) => ({ ...state, [key]: 'done' }));
    release();
    // The row says so too, but VoiceOver stays on the + it pressed.
    announce(`${food.name} added`);
    // Fuel, Today and the widgets show it at once, whether or not the sheet stays open.
    void useFuelStore.getState().refresh();
  }, [pendingIds, setAdded]);
  return { added: logger.purpose === 'ingredients' ? {} : added, add, enabled: !logger.editing };
}

/** Saved meals: filter, review, quick add; Edit to change or delete them. */
export function SavedTab({ onNewSavedMeal, onEditSavedMeal }: {
  onNewSavedMeal: () => void;
  onEditSavedMeal: (meal: Food) => void;
}) {
  const logger = useLogger();
  const large = useLargeText();
  const [filter, setFilter] = useState('');
  const [managing, setManaging] = useState(false);
  const { added, add: quickAdd, enabled } = useQuickAdd();
  const meals = logger.savedMeals;

  const open = (meal: Food) => {
    if (logger.purpose === 'log' && decodeMealComposition(meal.description)) logger.composeMeal(meal);
    else logger.chooseFood(meal);
  };
  const add = (meal: Food) => void quickAdd(meal.id, meal);

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
  // The Edit list's small trash button is one tap with no swipe behind it, so it asks.
  const confirmRetire = (meal: Food) => {
    Alert.alert(`Delete ${meal.name}?`, 'It leaves your saved meals. Past logged entries stay unchanged.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void retire(meal) },
    ]);
  };

  const visible = filterSavedMeals(meals ?? [], filter).filter((meal) => !hidden.has(meal.id));
  const canManage = Boolean(meals && meals.length > 0) && logger.purpose === 'log';
  const canCreate = logger.purpose === 'log' && !logger.editing;
  const rows = visible.map((meal, index) => (
    <SavedRow
      key={meal.id}
      meal={meal}
      divided={index > 0}
      state={added[meal.id]}
      purpose={logger.purpose}
      quickAdd={enabled}
      managing={managing}
      onOpen={open}
      onAdd={add}
      onEdit={onEditSavedMeal}
      onRemove={remove}
      onConfirmRemove={confirmRetire}
    />
  ));

  // Leaving the tab drops the list at once; only a deleted meal slides away.
  return (
    <LayoutAnimationConfig skipEntering skipExiting>
      <View>
        <SearchField value={filter} onChange={setFilter} placeholder="Filter saved meals" />
        {canManage || canCreate ? (
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'flex-end',
              alignItems: 'center',
              gap: 20,
              paddingHorizontal: 20,
              marginTop: 4,
              minHeight: 44,
              // the two words wrap rather than squeeze at the accessibility sizes
              ...(large ? { flexWrap: 'wrap' } : null),
            }}>
            {canManage ? <TextAction title={managing ? 'Done' : 'Edit'} onPress={() => setManaging(!managing)} /> : null}
            {canCreate ? <TextAction title="New" onPress={onNewSavedMeal} /> : null}
          </View>
        ) : null}
        {/* A new filter swaps the rows without motion; a deleted meal slides away. */}
        <LayoutAnimationConfig key={filter} skipEntering skipExiting>
          <View>
            {visible.length > 0 ? (
              <Label style={{ marginTop: canManage || canCreate ? 4 : 14, overflow: 'hidden' }} entering={rowEnter} exiting={blockExit} layout={rowLayout}>
                {rows}
              </Label>
            ) : null}
            {meals === null ? <ActivityIndicator style={{ marginTop: 32 }} /> : null}
            {meals !== null && visible.length === 0 ? (
              <Animated.View entering={rowEnter} layout={rowLayout}>
                <Empty text={filter.trim() ? 'No saved meals match.' : 'No saved meals yet.'} />
              </Animated.View>
            ) : null}
          </View>
        </LayoutAnimationConfig>
      </View>
    </LayoutAnimationConfig>
  );
}

/** One saved meal; drawn again only when its own meal, state or the list's mode changes. */
function SavedRow({ meal, divided, state, purpose, quickAdd, managing, onOpen, onAdd, onEdit, onRemove, onConfirmRemove }: {
  meal: Food;
  divided: boolean;
  state?: AddState;
  purpose: 'log' | 'ingredients';
  quickAdd: boolean;
  managing: boolean;
  onOpen: (meal: Food) => void;
  onAdd: (meal: Food) => void;
  onEdit: (meal: Food) => void;
  onRemove: (meal: Food) => void;
  onConfirmRemove: (meal: Food) => void;
}) {
  // Decoded once for the quick add, the menu and the row's line.
  const composed = Boolean(decodeMealComposition(meal.description));
  const canQuickAdd = quickAdd && !composed;
  const menu: MenuAction[] = [
    ...(canQuickAdd
      ? [{ title: purpose === 'ingredients' ? 'Add as ingredient' : 'Log one serving now', symbol: 'plus.circle', run: () => onAdd(meal) }]
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
      editing={managing}
      onEdit={() => onEdit(meal)}
      onDelete={() => onConfirmRemove(meal)}
      menu={menu}
    />
  );
  return (
    <Animated.View entering={rowEnter} exiting={rowExit} layout={rowLayout}>
      {divided ? <Hairline /> : null}
      {purpose === 'log' && !managing ? (
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

function TextAction({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      hitSlop={10}
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      style={({ pressed }) => ({ opacity: pressed ? 0.45 : 1, minHeight: 44, justifyContent: 'center' })}>
      <BlancText variant="bodyStrong" size={15}>
        {title}
      </BlancText>
    </Pressable>
  );
}

/** USDA search: results as you type (two letters or more), with Retry on failure. */
export function SearchTab() {
  const logger = useLogger();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Food[] | null>(null);
  const [state, setState] = useState<'idle' | 'searching' | 'error'>('idle');
  const [attempt, setAttempt] = useState(0);
  const [opening, setOpening] = useState<string | null>(null);
  const { added, add: quickAdd, enabled } = useQuickAdd();
  const trimmed = query.trim();
  // Results land a moment after typing stops: VoiceOver says how many.
  useAnnounce(
    state === 'error'
      ? 'The search failed.'
      : state === 'idle' && results !== null
        ? results.length === 0
          ? 'No USDA matches.'
          : `${results.length} result${results.length === 1 ? '' : 's'}`
        : null,
  );

  useEffect(() => {
    if (trimmed.length < 2) {
      setResults(null);
      setState('idle');
      return;
    }
    setState('searching');
    let current = true;
    const timer = setTimeout(() => {
      searchUsda(trimmed)
        .then((foods) => {
          if (!current) return;
          setResults(foods);
          setState('idle');
        })
        .catch(() => {
          if (!current) return;
          setResults(null);
          setState('error');
        });
    }, 350);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [trimmed, attempt]);

  const open = async (food: Food) => {
    if (opening) return;
    setOpening(food.fdc_id || food.id);
    // without its portion, the food opens as listed
    logger.chooseFood(await usdaWithPortion(food).catch(() => food));
    setOpening(null);
  };
  const add = (key: string, food: Food) => void quickAdd(key, food);

  return (
    <View>
      <SearchField value={query} onChange={setQuery} placeholder="Search USDA foods" autoFocus />
      {results && results.length > 0 ? (
        <Label style={{ marginTop: 14, overflow: 'hidden' }}>
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
              />
            );
          })}
        </Label>
      ) : null}
      {state === 'searching' ? <ActivityIndicator style={{ marginTop: 32 }} /> : null}
      {state === 'idle' && trimmed.length === 1 ? <Empty text="Type at least 2 characters." /> : null}
      {state === 'idle' && results !== null && results.length === 0 ? <Empty text="No USDA matches." /> : null}
      {state === 'error' ? (
        <View style={{ alignItems: 'center', gap: 14, marginTop: 32 }}>
          <BlancText variant="secondary" tone="graphite">
            The search failed. Check your connection.
          </BlancText>
          <Capsule title="Retry" variant="quiet" onPress={() => setAttempt((value) => value + 1)} />
        </View>
      ) : null}
    </View>
  );
}

/** One USDA result; drawn again only when its own state changes or another opens. */
function SearchRow({ food, rowKey, divided, state, opening, dimmed, quickAdd, onOpen, onAdd }: {
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
