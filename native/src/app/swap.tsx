import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, TextInput, View } from 'react-native';

import { getExerciseLibrary, peekExerciseLibrary } from '@/lib/exerciseLibrary';
import { exerciseCategory, searchExercises } from '@/lib/exerciseSearch';
import { MUSCLE_GROUP_LABELS, type Exercise, type MuscleGroup } from '@/types';
import { BlancText } from '~/components/BlancText';
import { Capsule } from '~/components/Capsule';
import { GlassButton } from '~/components/GlassButton';
import { Hairline } from '~/components/Row';
import { haptics } from '~/lib/haptics';
import { errorMessage, swapMovement } from '~/lib/movement';
import { useSessionModel } from '~/lib/session';
import { type as typeScale, useBlanc } from '~/theme/blanc';

const MUSCLES = Object.keys(MUSCLE_GROUP_LABELS) as MuscleGroup[];
// The library rarely changes: cached rows show at once, refreshed at most this often.
const LIBRARY_MAX_AGE_MS = 5 * 60_000;

/**
 * Swap a movement for this workout only. Opens on the movement's muscle and
 * leaves out exercises already in the workout, as on the web.
 */
export default function SwapSheet() {
  const c = useBlanc();
  const { id } = useLocalSearchParams<{ id: string }>();
  const session = useSessionModel();
  const movement = session?.movements.find((entry) => entry.exerciseId === id) ?? null;
  const sourceMuscle = movement?.sets[0]?.exercise?.muscle_group;

  const [library, setLibrary] = useState<Exercise[] | null>(() => peekExerciseLibrary());
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState('');
  const search = useDeferredValue(query);
  const [muscle, setMuscle] = useState<MuscleGroup | 'all'>(sourceMuscle ?? 'all');
  const [showSkills, setShowSkills] = useState(false);
  const [swapping, setSwapping] = useState<string | null>(null);

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

  const inWorkout = useMemo(() => new Set(session?.movements.map((entry) => entry.exerciseId)), [session?.movements]);
  const searching = search.trim().length > 0;
  const { gym, skills } = useMemo(() => {
    const allowed = (library ?? []).filter(
      (exercise) =>
        !inWorkout.has(exercise.id) &&
        (muscle === 'all' || exercise.muscle_group === muscle || exercise.muscle_group_secondary === muscle),
    );
    const ranked = searchExercises(allowed, search);
    return {
      gym: ranked.filter((exercise) => exerciseCategory(exercise) !== 'calisthenics'),
      skills: ranked.filter((exercise) => exerciseCategory(exercise) === 'calisthenics'),
    };
  }, [library, inWorkout, muscle, search]);
  // Everyday gym movements first; bodyweight skills on request, or whenever a search finds them.
  const skillsOpen = showSkills || searching || gym.length === 0;

  const choose = async (exercise: Exercise) => {
    if (!session || !movement || swapping) return;
    setSwapping(exercise.id);
    try {
      await swapMovement(
        session.workoutId,
        movement.exerciseId,
        exercise,
        session.current?.movement.exerciseId === movement.exerciseId,
      );
      haptics.success();
      // Back to the workout, past the movement sheet this picker opened from.
      router.dismiss(2);
    } catch (error) {
      haptics.error();
      setSwapping(null);
      Alert.alert('Not swapped', errorMessage(error, 'Could not swap the exercise. Try again.'));
    }
  };

  const row = (exercise: Exercise, index: number) => (
    <View key={exercise.id}>
      {index > 0 ? <Hairline inset={20} /> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Swap to ${exercise.name}`}
        disabled={swapping !== null}
        onPress={() => {
          haptics.tap();
          void choose(exercise);
        }}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          minHeight: 56,
          paddingVertical: 10,
          paddingHorizontal: 20,
          backgroundColor: pressed ? c.pressed : 'transparent',
          opacity: swapping !== null && swapping !== exercise.id ? 0.4 : 1,
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
        {swapping === exercise.id ? <ActivityIndicator /> : null}
      </Pressable>
    </View>
  );

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
              Swap for this workout
            </BlancText>
            {movement ? (
              <BlancText variant="footnote" tone="graphite" numberOfLines={1}>
                Replacing {movement.name}
              </BlancText>
            ) : null}
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
            placeholder="Search exercises"
            placeholderTextColor={c.graphite}
            returnKeyType="search"
            clearButtonMode="while-editing"
            autoCorrect={false}
            accessibilityLabel="Search exercises"
            style={[typeScale.body, { flex: 1, color: c.ink, padding: 0 }]}
          />
        </View>

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
              onPress={() => {
                haptics.select();
                setMuscle(group);
              }}
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

      {library !== null && gym.length === 0 && skills.length === 0 ? (
        <BlancText variant="secondary" tone="graphite" style={{ textAlign: 'center', marginTop: 32 }}>
          {searching ? 'Nothing matches.' : 'No other exercises for this muscle.'}
        </BlancText>
      ) : null}
    </ScrollView>
  );
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const c = useBlanc();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => ({
        height: 34,
        paddingHorizontal: 14,
        borderRadius: 17,
        justifyContent: 'center',
        backgroundColor: selected ? c.capsule : pressed ? c.pressed : c.fill,
      })}>
      <BlancText variant="footnote" weight="600" tone={selected ? 'onCapsule' : 'ink'}>
        {label}
      </BlancText>
    </Pressable>
  );
}
