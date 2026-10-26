import { Host, Picker, Text as SwiftText } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Pressable, ScrollView, TextInput, View } from 'react-native';

import { nutritionGroupLabel } from '@/lib/nutritionGroups';
import { createPendingEntryId, type PendingEntryId } from '@/lib/pendingEntryId';
import { BlancText } from '~/components/BlancText';
import { GlassButton } from '~/components/GlassButton';
import { Hairline } from '~/components/Row';
import { formatWhole } from '~/lib/format';
import { loadSavedFoods, searchFoods, suggestedGroup, useFuelStore, type SavedFood } from '~/lib/fuel';
import { haptics } from '~/lib/haptics';
import { type as typeScale, useBlanc } from '~/theme/blanc';

type Tab = 'saved' | 'search';
type AddState = 'saving' | 'done' | 'error';
type ListedFood = SavedFood;

export default function LogFoodSheet() {
  const c = useBlanc();
  const [tab, setTab] = useState<Tab>('saved');
  const [query, setQuery] = useState('');
  const [saved, setSaved] = useState<ListedFood[] | null>(null);
  const [results, setResults] = useState<ListedFood[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [added, setAdded] = useState<Record<string, AddState>>({});
  const logFood = useFuelStore((state) => state.logFood);
  const logSearchResult = useFuelStore((state) => state.logSearchResult);
  const groups = useFuelStore((state) => state.groups);

  // Where new entries go: the day's meal that fits the time, changeable, or Unassigned.
  const [destination, setDestination] = useState<string | null>(
    () => suggestedGroup(useFuelStore.getState().groups)?.id ?? null,
  );
  const destinationGroup = groups.find((group) => group.id === destination) ?? null;
  const destinationLabel = destinationGroup ? nutritionGroupLabel(destinationGroup, groups) : 'Unassigned';

  const chooseDestination = () => {
    haptics.tap();
    const options = [...groups.map((group) => nutritionGroupLabel(group, groups)), 'Unassigned', 'Cancel'];
    ActionSheetIOS.showActionSheetWithOptions(
      { title: 'Add to', options, cancelButtonIndex: options.length - 1 },
      (index) => {
        if (index === options.length - 1) return;
        haptics.select();
        setDestination(index < groups.length ? groups[index].id : null);
      },
    );
  };

  // One retry-safe id per food until its save is confirmed, so a retry after a
  // lost response updates the same entry instead of adding a second one.
  const pendingIds = useRef(new Map<string, PendingEntryId>());

  useEffect(() => {
    loadSavedFoods()
      .then(setSaved)
      .catch(() => setSaved([]));
  }, []);

  const trimmed = query.trim();
  useEffect(() => {
    if (tab !== 'search' || trimmed.length < 2) {
      setResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    let cancelled = false;
    const timer = setTimeout(() => {
      searchFoods(trimmed)
        .then((foods) => !cancelled && setResults(foods))
        .catch(() => !cancelled && setResults([]))
        .finally(() => !cancelled && setSearching(false));
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [tab, trimmed]);

  const list =
    tab === 'saved'
      ? (saved ?? []).filter((food) => food.name.toLowerCase().includes(trimmed.toLowerCase()))
      : (results ?? []);

  const add = async (food: ListedFood) => {
    const key = `${tab}:${food.id}`;
    const pending = pendingIds.current.get(key) ?? createPendingEntryId();
    pendingIds.current.set(key, pending);
    const entry = { groupId: destination, entryId: pending.take() };
    setAdded((state) => ({ ...state, [key]: 'saving' }));
    try {
      if (tab === 'saved') await logFood(food as never, entry);
      else await logSearchResult(food as never, entry);
      pending.clear();
      pendingIds.current.delete(key);
      haptics.success();
      setAdded((state) => ({ ...state, [key]: 'done' }));
    } catch {
      haptics.error();
      setAdded((state) => ({ ...state, [key]: 'error' }));
    }
  };

  // A native sheet expects its scroll view as the screen's own view, so the
  // header rides in the list as a sticky first item.
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.label }}
      contentContainerStyle={{ paddingBottom: 40 }}
      stickyHeaderIndices={[0]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag">
      <View style={{ backgroundColor: c.label, paddingBottom: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 16 }}>
        <GlassButton symbol="xmark" accessibilityLabel="Close" onPress={() => router.back()} />
        <View style={{ alignItems: 'center' }}>
          <BlancText variant="headline" accessibilityRole="header">
            Log food
          </BlancText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Adds to ${destinationLabel}. Change`}
            hitSlop={10}
            onPress={chooseDestination}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 4, opacity: pressed ? 0.5 : 1 })}>
            <BlancText variant="footnote" tone="graphite">
              Adds to {destinationLabel}
            </BlancText>
            <SymbolView name="chevron.down" size={10} weight="semibold" tintColor={c.graphite} />
          </Pressable>
        </View>
        <View style={{ width: 44 }} />
      </View>

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          height: 44,
          marginHorizontal: 16,
          marginTop: 14,
          paddingHorizontal: 14,
          borderRadius: 22,
          borderCurve: 'continuous',
          backgroundColor: c.fill,
        }}>
        <SymbolView name="magnifyingglass" size={16} weight="medium" tintColor={c.graphite} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={tab === 'saved' ? 'Filter saved foods' : 'Search foods'}
          placeholderTextColor={c.graphite}
          returnKeyType="search"
          clearButtonMode="while-editing"
          autoCorrect={false}
          accessibilityLabel={tab === 'saved' ? 'Filter saved foods' : 'Search foods'}
          style={[typeScale.body, { flex: 1, color: c.ink, padding: 0 }]}
        />
      </View>

      <Host matchContents={{ vertical: true }} style={{ marginHorizontal: 16, marginTop: 12 }}>
        <Picker
          selection={tab}
          onSelectionChange={(value: Tab) => {
            haptics.select();
            setTab(value);
          }}
          modifiers={[pickerStyle('segmented')]}>
          <SwiftText modifiers={[tag('saved')]}>Saved</SwiftText>
          <SwiftText modifiers={[tag('search')]}>Search</SwiftText>
        </Picker>
      </Host>
      </View>

        {list.map((food, index) => (
          <View key={`${tab}:${food.id}`}>
            {index > 0 ? <Hairline inset={20} /> : null}
            <FoodRow food={food} state={added[`${tab}:${food.id}`]} onAdd={() => void add(food)} />
          </View>
        ))}

        {tab === 'saved' && saved === null ? <ActivityIndicator style={{ marginTop: 32 }} /> : null}
        {tab === 'search' && searching ? <ActivityIndicator style={{ marginTop: 32 }} /> : null}
        {tab === 'saved' && saved !== null && list.length === 0 ? (
          <Empty text={trimmed ? 'No saved foods match.' : 'No saved foods yet.'} />
        ) : null}
        {tab === 'search' && !searching && trimmed.length < 2 ? <Empty text="Type a food to search." /> : null}
        {tab === 'search' && !searching && results !== null && results.length === 0 ? <Empty text="Nothing found." /> : null}
    </ScrollView>
  );
}

function FoodRow({ food, state, onAdd }: { food: ListedFood; state?: AddState; onAdd: () => void }) {
  const c = useBlanc();
  const macros = `${formatWhole(food.calories)} kcal · P${formatWhole(food.protein)} C${formatWhole(food.carbs)} F${formatWhole(food.fat)}`;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 62, paddingLeft: 20, paddingRight: 14 }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <BlancText variant="body" numberOfLines={1}>
          {food.name}
        </BlancText>
        <BlancText variant="meta" tone={state === 'error' ? 'live' : 'graphite'} style={{ marginTop: 2 }}>
          {state === 'error' ? 'Not saved. Tap + to try again.' : macros}
        </BlancText>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={state === 'done' ? `${food.name} added` : `Add ${food.name}`}
        disabled={state === 'saving'}
        hitSlop={8}
        onPress={onAdd}
        style={({ pressed }) => ({
          width: 32,
          height: 32,
          borderRadius: 16,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: state === 'done' ? c.fill : c.capsule,
          opacity: pressed ? 0.6 : 1,
          transform: [{ scale: pressed ? 0.92 : 1 }],
        })}>
        {state === 'saving' ? (
          <ActivityIndicator size="small" color={c.onCapsule} />
        ) : (
          <SymbolView name={state === 'done' ? 'checkmark' : 'plus'} size={14} weight="bold" tintColor={state === 'done' ? c.ink : c.onCapsule} />
        )}
      </Pressable>
    </View>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <BlancText variant="secondary" tone="graphite" style={{ textAlign: 'center', marginTop: 32 }}>
      {text}
    </BlancText>
  );
}
