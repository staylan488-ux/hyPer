import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, TextInput, View } from 'react-native';
import Animated, { LayoutAnimationConfig } from 'react-native-reanimated';

import { ensureFoodRow } from '@/lib/foodPersistence';
import { foodMacroLine, formatMeasurementAmount } from '@/lib/foodUnits';
import { createMealIngredient, decodeMealComposition } from '@/lib/mealComposition';
import { createPendingEntryId, type PendingEntryId } from '@/lib/pendingEntryId';
import { chosenFoodLogSource } from '@/lib/saveNutritionEntry';
import { filterSavedMeals, retireSavedMeal } from '@/lib/savedMeals';
import { getSessionUserId } from '@/lib/sessionUser';
import { searchUsdaFoodsSecureStrict, withUsdaPortion } from '@/lib/usdaClient';
import type { Food } from '@/types';
import { BlancText } from '~/components/BlancText';
import { Capsule } from '~/components/Capsule';
import { HoldMenu, hasHoldMenu, menuAccessibility, showActionSheet, type MenuAction } from '~/components/HoldMenu';
import { Hairline } from '~/components/Row';
import { closeOpenSwipeRow, SwipeRow, useSwipeActions } from '~/components/SwipeRow';
import { saveFoodEntry } from '~/lib/foodLogger';
import { useFuelStore } from '~/lib/fuel';
import { haptics } from '~/lib/haptics';
import { rowEnter, rowExit, rowLayout } from '~/lib/motion';
import { type as typeScale, useBlanc } from '~/theme/blanc';

import { useLogger } from './context';

type AddState = 'saving' | 'done' | 'error';

/** A search or filter field in the quiet fill capsule. */
export function SearchField({ value, onChange, placeholder, onSubmit }: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  onSubmit?: () => void;
}) {
  const c = useBlanc();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        height: 44,
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
        placeholder={placeholder}
        placeholderTextColor={c.graphite}
        returnKeyType="search"
        clearButtonMode="while-editing"
        autoCorrect={false}
        accessibilityLabel={placeholder}
        style={[typeScale.body, { flex: 1, color: c.ink, padding: 0 }]}
      />
    </View>
  );
}

/** One food: tap to review it; the round button logs one serving at once. */
function FoodRow({ food, state, opening, onOpen, onAdd, editing, onEdit, onDelete, menu, onLongPress, showBasis }: {
  food: Food;
  state?: AddState;
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
  const composed = Boolean(decodeMealComposition(food.description));
  const line = state === 'error'
    ? 'Not saved. Tap + to try again.'
    : state === 'done'
      ? `Added · ${Math.round(food.calories)} kcal`
      : showBasis
        ? `${Math.round(food.calories)} kcal / ${food.serving_label ?? `${formatMeasurementAmount(food.serving_size || 100)} ${food.serving_unit || 'g'}`}`
        : `${composed ? 'Meal · ' : ''}${foodMacroLine(food)}`;
  const row = (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingRight: 14, backgroundColor: c.ground }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${food.name}, ${line}`}
        accessibilityActions={actions.length > 0 ? actions : undefined}
        onAccessibilityAction={(event) => {
          const name = event.nativeEvent.actionName;
          if (held?.run(name)) return;
          if (name === 'longpress') onLongPress?.();
          else swipe.find((action) => `swipe:${action.label}` === name)?.onPress();
        }}
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
        style={({ pressed }) => ({
          flex: 1,
          minWidth: 0,
          justifyContent: 'center',
          minHeight: 62,
          paddingLeft: 20,
          paddingRight: 12,
          backgroundColor: pressed ? c.pressed : 'transparent',
        })}>
        <BlancText variant="body" numberOfLines={1}>
          {food.name}
        </BlancText>
        <BlancText variant="meta" tone={state === 'error' ? 'live' : 'graphite'} style={{ marginTop: 2 }} numberOfLines={1}>
          {line}
        </BlancText>
      </Pressable>
      {editing ? (
        <RoundButton symbol="trash" label={`Delete ${food.name}`} quiet onPress={() => onDelete?.()} />
      ) : onAdd || opening ? (
        <RoundButton
          symbol={state === 'done' ? 'checkmark' : 'plus'}
          label={opening ? `Opening ${food.name}` : state === 'done' ? `${food.name} added` : `Add ${food.name}`}
          quiet={state === 'done'}
          busy={state === 'saving' || opening}
          done={state === 'done'}
          onPress={() => onAdd?.()}
        />
      ) : null}
    </View>
  );
  return held && hasHoldMenu ? (
    <HoldMenu actions={menu ?? []} backdrop={c.ground}>
      {row}
    </HoldMenu>
  ) : (
    row
  );
}

function RoundButton({ symbol, label, quiet, busy, done, onPress }: {
  symbol: 'plus' | 'checkmark' | 'trash';
  label: string;
  quiet?: boolean;
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
      accessibilityState={{ disabled: Boolean(busy || done) }}
      hitSlop={8}
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
        backgroundColor: quiet ? c.fill : c.capsule,
        opacity: pressed ? 0.6 : 1,
        transform: [{ scale: pressed ? 0.92 : 1 }],
      })}>
      {busy ? (
        <ActivityIndicator size="small" color={c.onCapsule} />
      ) : (
        <SymbolView name={symbol} size={14} weight="bold" tintColor={quiet ? c.ink : c.onCapsule} />
      )}
    </Pressable>
  );
}

/**
 * One-tap logging from a list: one serving now, into the sheet's meal. Each
 * food keeps its retry-safe id until its save is confirmed.
 */
function useQuickAdd() {
  const logger = useLogger();
  const [added, setAdded] = useState<Record<string, AddState>>({});
  const pendingIds = useRef(new Map<string, PendingEntryId>());

  const add = async (key: string, food: Food) => {
    const current = added[key];
    if (current === 'saving' || current === 'done') return;
    if (logger.purpose === 'ingredients') {
      logger.addIngredients([createMealIngredient(food, 1)]);
      return;
    }
    const pending = pendingIds.current.get(key) ?? createPendingEntryId();
    pendingIds.current.set(key, pending);
    setAdded((state) => ({ ...state, [key]: 'saving' }));
    try {
      // One serving of exactly what the row shows (its basis), never a portion it did not show.
      const foodId = await ensureFoodRow(food);
      if (!foodId) throw new Error('not saved');
      await saveFoodEntry({
        foodId,
        servings: 1,
        source: chosenFoodLogSource(food),
        when: logger.when,
        groups: logger.groups,
        pending,
      });
      pendingIds.current.delete(key);
      haptics.success();
      setAdded((state) => ({ ...state, [key]: 'done' }));
      // Fuel, Today and the widgets show it at once, whether or not the sheet stays open.
      void useFuelStore.getState().refresh();
    } catch {
      haptics.error();
      setAdded((state) => ({ ...state, [key]: 'error' }));
    }
  };
  return { added, add, enabled: !logger.editing };
}

/** Saved meals: filter, review, quick add; Edit to change or delete them. */
export function SavedTab({ onNewSavedMeal, onEditSavedMeal }: {
  onNewSavedMeal: () => void;
  onEditSavedMeal: (meal: Food) => void;
}) {
  const logger = useLogger();
  const [filter, setFilter] = useState('');
  const [managing, setManaging] = useState(false);
  const quick = useQuickAdd();
  const meals = logger.savedMeals;
  const list = filterSavedMeals(meals ?? [], filter);

  const open = (meal: Food) => {
    if (logger.purpose === 'log' && decodeMealComposition(meal.description)) logger.composeMeal(meal);
    else logger.chooseFood(meal);
  };

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
  // The Edit list's small trash button is one tap with no swipe behind it, so it asks.
  const confirmRetire = (meal: Food) => {
    Alert.alert(`Delete ${meal.name}?`, 'It leaves your saved meals. Past logged entries stay unchanged.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void retire(meal) },
    ]);
  };

  const canQuickAdd = (meal: Food) => quick.enabled && !decodeMealComposition(meal.description);
  const menu = (meal: Food): MenuAction[] => [
    ...(canQuickAdd(meal)
      ? [{ title: logger.purpose === 'ingredients' ? 'Add as ingredient' : 'Log one serving now', symbol: 'plus.circle', run: () => void quick.add(meal.id, meal) }]
      : []),
    { title: 'Review and log', symbol: 'list.bullet.rectangle', run: () => open(meal) },
    ...(logger.purpose === 'log'
      ? [
          { title: 'Edit saved meal', symbol: 'pencil', run: () => onEditSavedMeal(meal) },
          { title: 'Delete', subtitle: 'Past logged entries stay', symbol: 'trash', destructive: true, removes: true, run: () => void retire(meal) },
        ]
      : []),
  ];
  const visible = list.filter((meal) => !hidden.has(meal.id));
  const savedCount = (meals ?? []).filter((meal) => !hidden.has(meal.id)).length;

  // Leaving the tab drops the list at once; only a deleted meal slides away.
  return (
    <LayoutAnimationConfig skipEntering skipExiting>
      <View>
        <SearchField value={filter} onChange={setFilter} placeholder="Filter saved meals" />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, marginTop: 10, minHeight: 44 }}>
          <BlancText variant="footnote" tone="graphite">
            {meals === null ? 'Loading' : `${savedCount} saved`}
          </BlancText>
          <View style={{ flexDirection: 'row', gap: 20 }}>
            {meals && meals.length > 0 && logger.purpose === 'log' ? (
              <TextAction title={managing ? 'Done' : 'Edit'} onPress={() => setManaging(!managing)} />
            ) : null}
            {logger.purpose === 'log' && !logger.editing ? <TextAction title="New" onPress={onNewSavedMeal} /> : null}
          </View>
        </View>
        {/* A new filter swaps the rows without motion; a deleted meal slides away. */}
        <LayoutAnimationConfig key={filter} skipEntering skipExiting>
          <View>
            {visible.map((meal, index) => {
              const row = (
                <FoodRow
                  food={meal}
                  state={quick.added[meal.id]}
                  onOpen={() => open(meal)}
                  onAdd={canQuickAdd(meal) ? () => void quick.add(meal.id, meal) : undefined}
                  editing={managing}
                  onEdit={() => onEditSavedMeal(meal)}
                  onDelete={() => confirmRetire(meal)}
                  menu={menu(meal)}
                />
              );
              return (
                <Animated.View key={meal.id} entering={rowEnter} exiting={rowExit} layout={rowLayout}>
                  {index > 0 ? <Hairline inset={20} /> : null}
                  {logger.purpose === 'log' && !managing ? (
                    <SwipeRow
                      name={meal.name}
                      actions={[
                        { label: 'Edit', onPress: () => onEditSavedMeal(meal) },
                        { label: 'Delete', destructive: true, onPress: () => void retire(meal) },
                      ]}>
                      {row}
                    </SwipeRow>
                  ) : (
                    row
                  )}
                </Animated.View>
              );
            })}
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
  const quick = useQuickAdd();
  const trimmed = query.trim();

  useEffect(() => {
    if (trimmed.length < 2) {
      setResults(null);
      setState('idle');
      return;
    }
    setState('searching');
    let current = true;
    const timer = setTimeout(() => {
      searchUsdaFoodsSecureStrict(trimmed)
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
    try {
      logger.chooseFood(await withUsdaPortion(food));
    } catch {
      logger.chooseFood(food);
    } finally {
      setOpening(null);
    }
  };

  return (
    <View>
      <SearchField value={query} onChange={setQuery} placeholder="Search USDA foods" />
      <View style={{ height: 10 }} />
      {(results ?? []).map((food, index) => {
        const key = food.fdc_id || food.id;
        return (
          <View key={key} style={{ opacity: opening && opening !== key ? 0.5 : 1 }}>
            {index > 0 ? <Hairline inset={20} /> : null}
            <FoodRow
              food={food}
              state={quick.added[key]}
              opening={opening === key}
              showBasis
              onOpen={() => void open(food)}
              onAdd={quick.enabled ? () => void quick.add(key, food) : undefined}
            />
          </View>
        );
      })}
      {state === 'searching' ? <ActivityIndicator style={{ marginTop: 32 }} /> : null}
      {state === 'idle' && trimmed.length < 2 ? <Empty text={trimmed.length === 1 ? 'Type at least 2 characters.' : 'Search the USDA food database.'} /> : null}
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

export function Empty({ text }: { text: string }) {
  return (
    <BlancText variant="secondary" tone="graphite" style={{ textAlign: 'center', marginTop: 32, marginHorizontal: 32 }}>
      {text}
    </BlancText>
  );
}
