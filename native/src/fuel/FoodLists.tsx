import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, TextInput, View } from 'react-native';

import { ensureFoodRow } from '@/lib/foodPersistence';
import { foodMacroLine } from '@/lib/foodUnits';
import { createMealIngredient, decodeMealComposition } from '@/lib/mealComposition';
import { createPendingEntryId, type PendingEntryId } from '@/lib/pendingEntryId';
import { chosenFoodLogSource } from '@/lib/saveNutritionEntry';
import { filterSavedMeals, retireSavedMeal } from '@/lib/savedMeals';
import { getSessionUserId } from '@/lib/sessionUser';
import { searchUsdaFoodsSecureStrict, withUsdaPortion } from '@/lib/usdaClient';
import type { Food } from '@/types';
import { BlancText } from '~/components/BlancText';
import { Capsule } from '~/components/Capsule';
import { FormNote } from '~/components/Form';
import { Hairline } from '~/components/Row';
import { saveFoodEntry } from '~/lib/foodLogger';
import { haptics } from '~/lib/haptics';
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
function FoodRow({ food, state, onOpen, onAdd, editing, onEdit, onDelete }: {
  food: Food;
  state?: AddState;
  onOpen: () => void;
  onAdd?: () => void;
  editing?: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const c = useBlanc();
  const composed = Boolean(decodeMealComposition(food.description));
  const line = state === 'error' ? 'Not saved. Tap + to try again.' : `${composed ? 'Meal · ' : ''}${foodMacroLine(food)}`;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingRight: 14 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${food.name}, ${line}`}
        onPress={() => {
          haptics.tap();
          (editing ? onEdit : onOpen)?.();
        }}
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
      ) : onAdd ? (
        <RoundButton
          symbol={state === 'done' ? 'checkmark' : 'plus'}
          label={state === 'done' ? `${food.name} added` : `Add ${food.name}`}
          quiet={state === 'done'}
          busy={state === 'saving'}
          onPress={onAdd}
        />
      ) : null}
    </View>
  );
}

function RoundButton({ symbol, label, quiet, busy, onPress }: {
  symbol: 'plus' | 'checkmark' | 'trash';
  label: string;
  quiet?: boolean;
  busy?: boolean;
  onPress: () => void;
}) {
  const c = useBlanc();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={busy}
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
    if (logger.purpose === 'ingredients') {
      logger.addIngredients([createMealIngredient(food, 1)]);
      return;
    }
    const pending = pendingIds.current.get(key) ?? createPendingEntryId();
    pendingIds.current.set(key, pending);
    setAdded((state) => ({ ...state, [key]: 'saving' }));
    try {
      const resolved = await withUsdaPortion(food);
      const foodId = await ensureFoodRow(resolved);
      if (!foodId) throw new Error('not saved');
      await saveFoodEntry({
        foodId,
        servings: 1,
        source: chosenFoodLogSource(resolved),
        when: logger.when,
        groups: logger.groups,
        pending,
      });
      pendingIds.current.delete(key);
      haptics.success();
      setAdded((state) => ({ ...state, [key]: 'done' }));
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
  const [message, setMessage] = useState<{ text: string; alert?: boolean } | null>(null);
  const quick = useQuickAdd();
  const meals = logger.savedMeals;
  const list = filterSavedMeals(meals ?? [], filter);

  const open = (meal: Food) => {
    if (logger.purpose === 'log' && decodeMealComposition(meal.description)) logger.composeMeal(meal);
    else logger.chooseFood(meal);
  };

  const remove = (meal: Food) => {
    Alert.alert(`Delete ${meal.name}?`, 'It leaves your saved meals. Past logged entries stay unchanged.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const userId = await getSessionUserId();
          if (!userId) {
            setMessage({ text: 'Please sign in again to delete saved meals.', alert: true });
            return;
          }
          const { error } = await retireSavedMeal(userId, meal.id);
          if (error) {
            haptics.error();
            setMessage({ text: 'Could not delete saved meal. Please try again.', alert: true });
            return;
          }
          haptics.success();
          setMessage({ text: 'Saved meal deleted. Past logs were not changed.' });
          await logger.reloadSavedMeals();
        },
      },
    ]);
  };

  return (
    <View>
      <SearchField value={filter} onChange={setFilter} placeholder="Filter saved meals" />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, marginTop: 10, minHeight: 44 }}>
        <BlancText variant="footnote" tone="graphite">
          {meals === null ? 'Loading' : `${meals.length} saved`}
        </BlancText>
        <View style={{ flexDirection: 'row', gap: 20 }}>
          {meals && meals.length > 0 && logger.purpose === 'log' ? (
            <TextAction title={managing ? 'Done' : 'Edit'} onPress={() => setManaging(!managing)} />
          ) : null}
          {logger.purpose === 'log' && !logger.editing ? <TextAction title="New" onPress={onNewSavedMeal} /> : null}
        </View>
      </View>
      {message ? <FormNote alert={message.alert}>{message.text}</FormNote> : null}
      {list.map((meal, index) => (
        <View key={meal.id}>
          {index > 0 ? <Hairline inset={20} /> : null}
          <FoodRow
            food={meal}
            state={quick.added[meal.id]}
            onOpen={() => open(meal)}
            onAdd={quick.enabled && !decodeMealComposition(meal.description) ? () => void quick.add(meal.id, meal) : undefined}
            editing={managing}
            onEdit={() => onEditSavedMeal(meal)}
            onDelete={() => remove(meal)}
          />
        </View>
      ))}
      {meals === null ? <ActivityIndicator style={{ marginTop: 32 }} /> : null}
      {meals !== null && list.length === 0 ? <Empty text={filter.trim() ? 'No saved meals match.' : 'No saved meals yet.'} /> : null}
    </View>
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
