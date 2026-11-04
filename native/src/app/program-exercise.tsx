import { router, useLocalSearchParams } from 'expo-router';
import { useRef } from 'react';
import { ScrollView, View } from 'react-native';

import { normalizeSetRange } from '@/lib/setRangeNotes';
import { useSplitEditStore } from '@/stores/splitEditStore';
import { BlancText } from '~/components/BlancText';
import { GlassButton } from '~/components/GlassButton';
import { Label } from '~/components/Label';
import { RollingText } from '~/components/RollingText';
import { Hairline, Row } from '~/components/Row';
import { Section } from '~/components/Section';
import { Stepper } from '~/components/Stepper';
import { haptics } from '~/lib/haptics';
import { space, useBlanc } from '~/theme/blanc';

const SET_LIMIT = 10;
const REP_LIMIT = 100;

/**
 * Sets and reps for one exercise of the program being edited. Each step
 * goes to the draft at once (the web commits each cell the same way); a
 * superset partner follows the set count, as on the web. A set range lets
 * a session run shorter or longer than the usual count.
 */
export default function ProgramExerciseSheet() {
  const c = useBlanc();
  const params = useLocalSearchParams<{ day: string; exercise: string }>();
  const day = useSplitEditStore((state) => state.draft?.days.find((entry) => entry.id === params.day) ?? null);
  const exercise = day?.exercises.find((entry) => entry.id === params.exercise) ?? null;
  const partner = exercise?.superset_group_id
    ? day?.exercises.find((entry) => entry.id !== exercise.id && entry.superset_group_id === exercise.superset_group_id) ?? null
    : null;

  if (!day || !exercise) {
    return (
      <View style={{ padding: 24, backgroundColor: c.ground }}>
        <BlancText variant="secondary" tone="graphite">
          This exercise is no longer in the program.
        </BlancText>
      </View>
    );
  }

  const update = useSplitEditStore.getState().updateExerciseTargets;
  const ranged = exercise.target_sets_min !== exercise.target_sets_max;
  // Without a range the count is the range; with one, a count past an edge
  // widens it, so the count never sticks there.
  const setSets = (value: number) =>
    update(day.id, exercise.id, ranged
      ? { target_sets: value, target_sets_min: Math.min(exercise.target_sets_min, value), target_sets_max: Math.max(exercise.target_sets_max, value) }
      : { target_sets: value, target_sets_min: value, target_sets_max: value });
  const setRange = (min: number, max: number) => {
    const range = normalizeSetRange(min, exercise.target_sets, max);
    update(day.id, exercise.id, { target_sets_min: range.minSets, target_sets: range.targetSets, target_sets_max: range.maxSets });
  };

  return (
    <ScrollView style={{ backgroundColor: c.ground }} contentContainerStyle={{ paddingBottom: 28 }} scrollEnabled={false}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 16 }}>
        {/* Changes apply as they are made: Done only, trailing as in iOS 26 sheets. */}
        <View style={{ width: 44 }} />
        <View style={{ flex: 1, alignItems: 'center' }}>
          <BlancText variant="headline" numberOfLines={1} accessibilityRole="header">
            {exercise.exercise.name}
          </BlancText>
          <BlancText variant="footnote" tone="graphite" numberOfLines={1}>
            {partner ? `Superset with ${partner.exercise.name}` : 'Sets and reps'}
          </BlancText>
        </View>
        <GlassButton symbol="checkmark" accessibilityLabel="Done" onPress={() => router.back()} />
      </View>

      <Label style={{ marginTop: 18 }}>
        <StepperRow label="Sets" value={exercise.target_sets} min={1} max={SET_LIMIT} onChange={setSets} />
        <Hairline />
        <StepperRow
          label="Reps from"
          value={exercise.target_reps_min}
          min={1}
          max={REP_LIMIT}
          onChange={(value) => update(day.id, exercise.id, { target_reps_min: value, ...(value > exercise.target_reps_max ? { target_reps_max: value } : {}) })}
        />
        <Hairline />
        <StepperRow
          label="Reps to"
          value={exercise.target_reps_max}
          min={1}
          max={REP_LIMIT}
          onChange={(value) => update(day.id, exercise.id, { target_reps_max: value, ...(value < exercise.target_reps_min ? { target_reps_min: value } : {}) })}
        />
      </Label>

      <Section title="Set range" note={ranged ? undefined : 'Off'} style={{ marginTop: 22 }}>
        <Label>
          <StepperRow label="Fewest" value={exercise.target_sets_min} min={1} max={SET_LIMIT} onChange={(value) => setRange(value, Math.max(value, exercise.target_sets_max))} />
          <Hairline />
          <StepperRow label="Most" value={exercise.target_sets_max} min={1} max={SET_LIMIT} onChange={(value) => setRange(Math.min(value, exercise.target_sets_min), value)} />
        </Label>
        <BlancText variant="footnote" tone="graphite" style={{ marginHorizontal: space.gutter, marginTop: 8 }}>
          Sessions can add or drop sets within this range.
        </BlancText>
      </Section>

      <Label style={{ marginTop: 22 }}>
        <Row
          title="Swap exercise"
          chevron
          onPress={() => router.replace({ pathname: '/swap', params: { program: 'swap', day: day.id, id: exercise.id } })}
        />
      </Label>
    </ScrollView>
  );
}

/** A number with − and +; holding a button keeps stepping, like iOS's stepper. */
function StepperRow({ label, value, min, max, onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };

  // The Stepper ticks for its own presses; VoiceOver's steps tick here.
  const step = (delta: number) => {
    const next = Math.max(min, Math.min(max, latest.current.value + delta));
    if (next === latest.current.value) return false;
    latest.current.onChange(next);
    latest.current.value = next;
    return true;
  };

  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ text: String(value) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(event) => {
        if (step(event.nativeEvent.actionName === 'increment' ? 1 : -1)) haptics.select();
      }}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingLeft: 18, paddingRight: 16 }}>
      <BlancText variant="body" style={{ flex: 1 }}>
        {label}
      </BlancText>
      <RollingText variant="figure" size={24} style={{ minWidth: 40, textAlign: 'right' }}>
        {String(value)}
      </RollingText>
      <Stepper
        repeat
        canMinus={value > min}
        canPlus={value < max}
        minusLabel={`Fewer ${label}`}
        plusLabel={`More ${label}`}
        onMinus={() => step(-1)}
        onPlus={() => step(1)}
      />
    </View>
  );
}
