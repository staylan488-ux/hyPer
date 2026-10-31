import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Pressable, ScrollView, TextInput, View } from 'react-native';

import { customExercise, normalizeExerciseName } from '@/lib/customExercises';
import { getExerciseLibrary, peekExerciseLibrary } from '@/lib/exerciseLibrary';
import { exerciseCategory, searchExercises } from '@/lib/exerciseSearch';
import { MUSCLE_GROUP_LABELS, type Exercise, type MuscleGroup } from '@/types';
import { haptics } from '~/lib/haptics';
import { type as typeScale, useBlanc } from '~/theme/blanc';

import { BlancText } from './BlancText';
import { Capsule } from './Capsule';
import { Chip } from './Chip';
import type { TextField } from './Form';
import { GlassButton } from './GlassButton';
import { Hairline } from './Row';

const MUSCLES = Object.keys(MUSCLE_GROUP_LABELS) as MuscleGroup[];
// The library rarely changes: cached rows show at once, refreshed at most this often.
const LIBRARY_MAX_AGE_MS = 5 * 60_000;

type PickerProps = {
  title: string;
  subtitle?: string | null;
  initialMuscle?: MuscleGroup;
  /** Exercise ids never offered (already in the workout or day). */
  exclude: ReadonlySet<string>;
  /** Rows the library does not have yet (custom exercises), offered first. */
  extras?: Exercise[];
  /** Ticked rows in a several-at-once picker; tapping a row calls onPick either way. */
  selected?: ReadonlySet<string>;
  /** The row being saved, with a spinner; the others dim. */
  busyId?: string | null;
  onPick: (exercise: Exercise) => void;
  /** Offers to make an exercise from the search text when the library has none by that name. */
  allowCustom?: boolean;
  /** A button in the top-right corner, such as "Add 3" for a several-at-once pick. */
  action?: { title: string; accessibilityLabel: string; onPress: () => void } | null;
};

/**
 * The one exercise picker: search, muscle chips, everyday gym movements
 * first and bodyweight skills on request, as on the web.
 */
export function ExercisePicker({ title, subtitle, initialMuscle, exclude, extras = [], selected, busyId = null, onPick, allowCustom, action }: PickerProps) {
  const c = useBlanc();
  const [library, setLibrary] = useState<Exercise[] | null>(() => peekExerciseLibrary());
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState('');
  const search = useDeferredValue(query);
  const searchField = useRef<TextField>(null);
  const [muscle, setMuscle] = useState<MuscleGroup | 'all'>(initialMuscle ?? 'all');
  const [showSkills, setShowSkills] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const hadCache = peekExerciseLibrary() !== null;
    getExerciseLibrary({ maxAgeMs: hadCache ? LIBRARY_MAX_AGE_MS : Infinity })
      .then((rows) => {
        if (!cancelled && (rows.length > 0 || !hadCache)) setLibrary(rows);
      })
      .catch(() => {
        if (!cancelled && !hadCache) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const searching = search.trim().length > 0;
  const { gym, skills } = useMemo(() => {
    const seen = new Set<string>();
    const rows = [...extras, ...(library ?? [])].filter((exercise) => {
      if (seen.has(exercise.id)) return false;
      seen.add(exercise.id);
      return true;
    });
    const allowed = rows.filter(
      (exercise) =>
        (!exclude.has(exercise.id) || selected?.has(exercise.id)) &&
        (muscle === 'all' || exercise.muscle_group === muscle || exercise.muscle_group_secondary === muscle),
    );
    const ranked = searchExercises(allowed, search);
    return {
      gym: ranked.filter((exercise) => exerciseCategory(exercise) !== 'calisthenics'),
      skills: ranked.filter((exercise) => exerciseCategory(exercise) === 'calisthenics'),
    };
  }, [library, extras, exclude, selected, muscle, search]);
  // Everyday gym movements first; bodyweight skills on request, or whenever a search finds them.
  const skillsOpen = showSkills || searching || gym.length === 0;

  // "Create …" only when nothing in the library (or this edit) has that name.
  const typed = query.trim().replace(/\s+/g, ' ');
  const canCreate =
    allowCustom &&
    typed.length > 0 &&
    library !== null &&
    ![...extras, ...library].some((exercise) => normalizeExerciseName(exercise.name) === normalizeExerciseName(typed));

  const create = () => {
    if (!library) return;
    const options = MUSCLES.map((group) => MUSCLE_GROUP_LABELS[group]);
    ActionSheetIOS.showActionSheetWithOptions(
      { title: `Main muscle for “${typed.slice(0, 80)}”`, options: [...options, 'Cancel'], cancelButtonIndex: options.length },
      (index) => {
        if (index >= options.length) return;
        haptics.select();
        onPick(customExercise(typed.slice(0, 80), MUSCLES[index], library));
        setQuery('');
      },
    );
  };

  const row = (exercise: Exercise, index: number) => {
    const ticked = selected?.has(exercise.id) ?? false;
    return (
      <View key={exercise.id}>
        {index > 0 ? <Hairline inset={20} /> : null}
        <Pressable
          accessibilityRole="button"
          accessibilityState={selected ? { selected: ticked } : undefined}
          accessibilityLabel={exercise.name}
          disabled={busyId !== null}
          onPress={() => {
            if (selected) haptics.select();
            else haptics.tap();
            onPick(exercise);
          }}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            minHeight: 56,
            paddingVertical: 10,
            paddingHorizontal: 20,
            backgroundColor: pressed ? c.pressed : 'transparent',
            opacity: busyId !== null && busyId !== exercise.id ? 0.4 : 1,
          })}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <BlancText variant="body" numberOfLines={1}>
              {exercise.name}
            </BlancText>
            {searching || muscle === 'all' ? (
              <BlancText variant="footnote" tone="graphite" numberOfLines={1}>
                {MUSCLE_GROUP_LABELS[exercise.muscle_group]}
              </BlancText>
            ) : null}
          </View>
          {busyId === exercise.id ? <ActivityIndicator /> : null}
          {selected ? (
            <SymbolView name={ticked ? 'checkmark.circle.fill' : 'circle'} size={22} weight="regular" tintColor={ticked ? c.ink : c.upcoming} />
          ) : null}
        </Pressable>
      </View>
    );
  };

  return (
      <ScrollView
        style={{ flex: 1, backgroundColor: c.label }}
        contentContainerStyle={{ paddingBottom: 40 }}
        stickyHeaderIndices={[0]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag">
        <View style={{ backgroundColor: c.label, paddingBottom: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 16 }}>
            <GlassButton symbol="xmark" accessibilityLabel="Close" onPress={() => router.back()} />
            <View style={{ flex: 1, alignItems: 'center' }}>
              <BlancText variant="headline" accessibilityRole="header">
                {title}
              </BlancText>
              {subtitle ? (
                <BlancText variant="footnote" tone="graphite" numberOfLines={1}>
                  {subtitle}
                </BlancText>
              ) : null}
            </View>
            {action ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={action.accessibilityLabel}
                hitSlop={6}
                onPress={() => {
                  haptics.tap();
                  action.onPress();
                }}
                style={({ pressed }) => ({
                  minWidth: 44,
                  height: 44,
                  paddingHorizontal: 16,
                  borderRadius: 22,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: c.capsule,
                  opacity: pressed ? 0.7 : 1,
                })}>
                <BlancText variant="headline" tone="onCapsule" size={16}>
                  {action.title}
                </BlancText>
              </Pressable>
            ) : (
              <View style={{ width: 44 }} />
            )}
          </View>

          {/* The whole pill is the field: a tap on the glass or beside the text types too. */}
          <Pressable
            accessible={false}
            onPress={() => searchField.current?.focus()}
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
              ref={searchField}
              value={query}
              onChangeText={setQuery}
              placeholder="Search exercises"
              placeholderTextColor={c.graphite}
              returnKeyType="search"
              clearButtonMode="while-editing"
              autoCorrect={false}
              accessibilityLabel="Search exercises"
              lineBreakModeIOS="tail"
              style={[typeScale.field, { flex: 1, color: c.ink, padding: 0 }]}
            />
          </Pressable>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}
            style={{ marginTop: 12 }}>
            {(['all', ...MUSCLES] as const).map((group) => (
              <Chip
                key={group}
                label={group === 'all' ? 'All' : MUSCLE_GROUP_LABELS[group]}
                selected={muscle === group}
                onPress={() => setMuscle(group)}
              />
            ))}
          </ScrollView>
        </View>

        {library === null && !loadFailed ? <ActivityIndicator style={{ marginTop: 32 }} /> : null}
        {loadFailed && library === null ? (
          <View style={{ alignItems: 'center', gap: 12, marginTop: 32 }}>
            <BlancText variant="secondary" tone="graphite">
              Couldn&apos;t load exercises.
            </BlancText>
            <Capsule
              title="Retry"
              variant="quiet"
              onPress={() => {
                setLoadFailed(false);
                setAttempt((value) => value + 1);
              }}
            />
          </View>
        ) : null}

        {canCreate ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Create ${typed}`}
            onPress={() => {
              haptics.tap();
              create();
            }}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              minHeight: 56,
              paddingHorizontal: 20,
              backgroundColor: pressed ? c.pressed : 'transparent',
            })}>
            <SymbolView name="plus" size={15} weight="semibold" tintColor={c.ink} />
            <BlancText variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
              Create “{typed}”
            </BlancText>
          </Pressable>
        ) : null}

        {gym.map(row)}

        {skills.length > 0 && !skillsOpen ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              haptics.tap();
              setShowSkills(true);
            }}
            style={({ pressed }) => ({ minHeight: 52, justifyContent: 'center', paddingHorizontal: 20, opacity: pressed ? 0.5 : 1 })}>
            <BlancText variant="secondary" weight="600">
              Show bodyweight skills
            </BlancText>
          </Pressable>
        ) : null}
        {skills.length > 0 && skillsOpen ? (
          <>
            <BlancText variant="footnote" tone="graphite" style={{ marginTop: 18, marginBottom: 4, marginHorizontal: 20 }}>
              Bodyweight skills
            </BlancText>
            {skills.map(row)}
          </>
        ) : null}

        {library !== null && gym.length === 0 && skills.length === 0 && !canCreate ? (
          <BlancText variant="secondary" tone="graphite" style={{ textAlign: 'center', marginTop: 32 }}>
            {searching ? 'Nothing matches.' : 'No other exercises for this muscle.'}
          </BlancText>
        ) : null}
      </ScrollView>
  );
}
