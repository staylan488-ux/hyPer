import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { memo, useDeferredValue, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Pressable, ScrollView, TextInput, View } from 'react-native';

import { customExercise, normalizeExerciseName } from '@/lib/customExercises';
import { getExerciseLibrary, peekExerciseLibrary } from '@/lib/exerciseLibrary';
import { exerciseCategory, searchExercises } from '@/lib/exerciseSearch';
import { MUSCLE_GROUP_LABELS, type Exercise, type MuscleGroup } from '@/types';
import { announce, useAnnounce, useLargeText } from '~/lib/accessibility';
import { haptics } from '~/lib/haptics';
import { space, type as typeScale, useBlanc } from '~/theme/blanc';

import { BlancText } from './BlancText';
import { Capsule } from './Capsule';
import { Chip } from './Chip';
import type { TextField } from './Form';
import { GlassButton } from './GlassButton';
import { Label } from './Label';
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
 * first and bodyweight skills on request.
 */
export function ExercisePicker({ title, subtitle, initialMuscle, exclude, extras = [], selected, busyId = null, onPick, allowCustom, action }: PickerProps) {
  const c = useBlanc();
  const large = useLargeText();
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

  // A muscle chosen changes the list below the chips without a word: say
  // how many it shows. None is the empty line's to say.
  const shown = gym.length + (skillsOpen ? skills.length : 0);
  const announcedMuscle = useRef(muscle);
  const onMuscleChange = useEffectEvent(() => {
    if (library !== null && shown > 0) announce(`${shown} ${shown === 1 ? 'movement' : 'movements'}`);
  });
  useEffect(() => {
    if (announcedMuscle.current === muscle) return;
    announcedMuscle.current = muscle;
    onMuscleChange();
  }, [muscle]);

  // "Create …" only when nothing in the library (or this edit) has that name.
  // The names are worked out once per library, not on every keystroke.
  const takenNames = useMemo(
    () => (allowCustom && library !== null ? new Set([...extras, ...library].map((exercise) => normalizeExerciseName(exercise.name))) : null),
    [allowCustom, extras, library],
  );
  const typed = query.trim().replace(/\s+/g, ' ');
  const canCreate = allowCustom && typed.length > 0 && takenNames !== null && !takenNames.has(normalizeExerciseName(typed));
  const empty = library !== null && gym.length === 0 && skills.length === 0 && !canCreate;
  const emptyLine = searching ? 'Nothing matches.' : 'No other movements for this muscle.';
  // Silent while a pick saves or the sheet closes: the picked exercise leaves
  // the list then, which can empty it.
  useAnnounce(busyId !== null ? null : loadFailed && library === null ? 'Couldn’t load movements.' : empty ? emptyLine : null);

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

  // Each row takes plain props, so a tick, a save or a new search redraws
  // only the rows it changes. `after` puts a hairline above the first row
  // when the Create row sits on top of it in the same card.
  const rows = (list: Exercise[], after = false) =>
    list.map((exercise, index) => (
      <ExerciseRow
        key={exercise.id}
        exercise={exercise}
        first={index === 0 && !after}
        selectable={selected !== undefined}
        ticked={selected?.has(exercise.id) ?? false}
        locked={busyId !== null}
        busy={busyId === exercise.id}
        showMuscle={searching || muscle === 'all'}
        onPick={onPick}
      />
    ));

  return (
      <ScrollView showsVerticalScrollIndicator={false}
        style={{ flex: 1, backgroundColor: c.ground }}
        contentContainerStyle={{ paddingBottom: 40 }}
        stickyHeaderIndices={[0]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag">
        <View style={{ backgroundColor: c.ground, paddingBottom: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 16 }}>
            <GlassButton symbol="xmark" accessibilityLabel="Close" onPress={() => router.back()} />
            <View style={{ flex: 1, alignItems: 'center' }}>
              <BlancText variant="headline" accessibilityRole="header">
                {title}
              </BlancText>
              {subtitle ? (
                <BlancText variant="footnote" tone="graphite" numberOfLines={large ? undefined : 1}>
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
                  ...(large ? { minHeight: 44, paddingVertical: 8 } : { height: 44 }),
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
              // At the accessibility text sizes the field grows with its text.
              ...(large ? { minHeight: 44, paddingVertical: 8 } : { height: 44 }),
              marginHorizontal: 16,
              marginTop: 14,
              paddingHorizontal: 14,
              borderRadius: 22,
              borderCurve: 'continuous',
              backgroundColor: c.fill,
            }}>
            <SymbolView name="magnifyingglass" size={16} weight="medium" tintColor={c.graphite} />
            <TextInput
              selectionColor={c.ink}
              ref={searchField}
              value={query}
              onChangeText={setQuery}
              placeholder="Search movements"
              placeholderTextColor={c.graphite}
              returnKeyType="search"
              clearButtonMode="while-editing"
              autoCorrect={false}
              accessibilityLabel="Search movements"
              lineBreakModeIOS="tail"
              style={[typeScale.field, { flex: 1, color: c.ink, padding: 0 }]}
            />
          </Pressable>

          <ScrollView showsVerticalScrollIndicator={false}
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
              Couldn&apos;t load movements.
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

        {/* The list sits in a white label on the chalk, like every other list. */}
        {canCreate || gym.length > 0 ? (
          <Label style={{ marginTop: 4, overflow: 'hidden' }}>
            {canCreate ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Create ${typed}`}
                accessibilityHint="Then choose its main muscle"
                onPress={() => {
                  haptics.tap();
                  create();
                }}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  minHeight: 60,
                  ...(large ? { paddingVertical: 10 } : null),
                  paddingLeft: 18,
                  paddingRight: 16,
                  backgroundColor: pressed ? c.pressed : 'transparent',
                })}>
                <SymbolView name="plus" size={15} weight="semibold" tintColor={c.ink} />
                <BlancText variant="bodyStrong" numberOfLines={large ? undefined : 1} style={{ flex: 1 }}>
                  Create “{typed}”
                </BlancText>
              </Pressable>
            ) : null}

            {rows(gym, canCreate)}

            {/* Skills stay folded only while there are gym movements above them. */}
            {skills.length > 0 && !skillsOpen ? (
              <>
                <Hairline />
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    haptics.tap();
                    setShowSkills(true);
                  }}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    minHeight: 60,
                    ...(large ? { paddingVertical: 10 } : null),
                    paddingLeft: 18,
                    paddingRight: 16,
                    backgroundColor: pressed ? c.pressed : 'transparent',
                  })}>
                  <BlancText variant="bodyStrong" numberOfLines={large ? undefined : 1} style={{ flex: 1 }}>
                    Show bodyweight skills
                  </BlancText>
                  <SymbolView name="chevron.down" size={13} weight="semibold" tintColor={c.upcoming} />
                </Pressable>
              </>
            ) : null}
          </Label>
        ) : null}
        {skills.length > 0 && skillsOpen ? (
          <>
            <BlancText variant="footnote" tone="graphite" accessibilityRole="header" style={{ marginTop: 18, marginBottom: 6, marginHorizontal: space.gutter }}>
              Bodyweight skills
            </BlancText>
            <Label style={{ overflow: 'hidden' }}>{rows(skills)}</Label>
          </>
        ) : null}

        {empty ? (
          <BlancText variant="secondary" tone="graphite" style={{ textAlign: 'center', marginTop: 32 }}>
            {emptyLine}
          </BlancText>
        ) : null}
      </ScrollView>
  );
}

type RowProps = {
  exercise: Exercise;
  /** The first row of its list, with no hairline above it. */
  first: boolean;
  /** A several-at-once picker: the row shows a tick circle. */
  selectable: boolean;
  ticked: boolean;
  /** A pick is saving: every row is disabled and the others dim. */
  locked: boolean;
  /** This row's pick is the one saving. */
  busy: boolean;
  showMuscle: boolean;
  onPick: (exercise: Exercise) => void;
};

const ExerciseRow = memo(function ExerciseRow({ exercise, first, selectable, ticked, locked, busy, showMuscle, onPick }: RowProps) {
  const c = useBlanc();
  const large = useLargeText();
  return (
    <View>
      {first ? null : <Hairline />}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ ...(selectable ? { selected: ticked } : null), ...(busy ? { busy: true } : null) }}
        accessibilityLabel={showMuscle ? `${exercise.name}, ${MUSCLE_GROUP_LABELS[exercise.muscle_group]}` : exercise.name}
        disabled={locked}
        onPress={() => {
          if (selectable) haptics.select();
          else haptics.tap();
          onPick(exercise);
        }}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          minHeight: 60,
          paddingVertical: 10,
          paddingLeft: 18,
          paddingRight: 16,
          backgroundColor: pressed ? c.pressed : 'transparent',
          opacity: locked && !busy ? 0.4 : 1,
        })}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <BlancText variant="bodyStrong" numberOfLines={large ? undefined : 1}>
            {exercise.name}
          </BlancText>
          {showMuscle ? (
            <BlancText variant="secondary" tone="graphite" numberOfLines={large ? undefined : 1} style={{ marginTop: 1 }}>
              {MUSCLE_GROUP_LABELS[exercise.muscle_group]}
            </BlancText>
          ) : null}
        </View>
        {busy ? <ActivityIndicator /> : null}
        {selectable ? (
          <SymbolView name={ticked ? 'checkmark.circle.fill' : 'circle'} size={22} weight="regular" tintColor={ticked ? c.ink : c.upcoming} />
        ) : null}
      </Pressable>
    </View>
  );
});
