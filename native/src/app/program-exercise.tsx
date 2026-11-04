import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { useEffect, useRef } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { normalizeSetRange } from '@/lib/setRangeNotes';
import { useSplitEditStore } from '@/stores/splitEditStore';
import { BlancText } from '~/components/BlancText';
import { GlassButton } from '~/components/GlassButton';
import { Label } from '~/components/Label';
import { RollingText } from '~/components/RollingText';
import { Hairline, Row } from '~/components/Row';
import { Section } from '~/components/Section';
import { useLargeText } from '~/lib/accessibility';
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
  const large = useLargeText();
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
    <ScrollView
      style={{ backgroundColor: c.ground }}
      contentContainerStyle={{ paddingBottom: 28 }}
      // The sheet fits its content; at the accessibility text sizes that can pass the screen's height.
      scrollEnabled={large}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 16 }}>
        {/* Changes apply as they are made: Done only, trailing as in iOS 26 sheets. */}
        <View style={{ width: 44 }} />
        <View
          style={{ flex: 1, alignItems: 'center' }}
          accessible
          accessibilityRole="header"
          accessibilityLabel={`${exercise.exercise.name}, ${partner ? `superset with ${partner.exercise.name}` : 'sets and reps'}`}>
          <BlancText variant="headline" numberOfLines={large ? undefined : 1} style={large ? { textAlign: 'center' } : undefined}>
            {exercise.exercise.name}
          </BlancText>
          <BlancText variant="footnote" tone="graphite" numberOfLines={large ? undefined : 1} style={large ? { textAlign: 'center' } : undefined}>
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
          <StepperRow
            label="Fewest"
            spoken="Fewest sets"
            value={exercise.target_sets_min}
            min={1}
            max={SET_LIMIT}
            onChange={(value) => setRange(value, Math.max(value, exercise.target_sets_max))}
          />
          <Hairline />
          <StepperRow
            label="Most"
            spoken="Most sets"
            value={exercise.target_sets_max}
            min={1}
            max={SET_LIMIT}
            onChange={(value) => setRange(Math.min(value, exercise.target_sets_min), value)}
          />
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

/**
 * A number with − and +; holding a button keeps stepping, like iOS's stepper.
 * VoiceOver finds one adjustable element (swipe up or down to step) named
 * `spoken`, or the label; at the accessibility text sizes the label sits
 * over the number and its buttons.
 */
function StepperRow({ label, spoken, value, min, max, onChange }: {
  label: string;
  spoken?: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const large = useLargeText();
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
  }, []);

  const step = (delta: number) => {
    const next = Math.max(min, Math.min(max, latest.current.value + delta));
    if (next === latest.current.value) return false;
    haptics.select();
    latest.current.onChange(next);
    latest.current.value = next;
    return true;
  };
  const stop = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };

  const button = (symbol: SFSymbol, delta: number, disabled: boolean) => (
    <StepButton
      symbol={symbol}
      disabled={disabled}
      onPress={() => step(delta)}
      onHold={() => {
        stop();
        timer.current = setInterval(() => {
          if (!step(delta)) stop();
        }, 110);
      }}
      onRelease={stop}
    />
  );

  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={spoken ?? label}
      accessibilityValue={{ text: String(value) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(event) => step(event.nativeEvent.actionName === 'increment' ? 1 : -1)}
      style={[
        { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, paddingLeft: 18, paddingRight: 12 },
        large ? { flexWrap: 'wrap', rowGap: 6, paddingVertical: 10 } : null,
      ]}>
      <BlancText variant="body" style={large ? { width: '100%' } : { flex: 1 }}>
        {label}
      </BlancText>
      <RollingText variant="figure" size={24} style={{ minWidth: 40, textAlign: 'center' }}>
        {String(value)}
      </RollingText>
      {button('minus', -1, value <= min)}
      {button('plus', 1, value >= max)}
    </View>
  );
}

function StepButton({ symbol, disabled, onPress, onHold, onRelease }: {
  symbol: SFSymbol;
  disabled: boolean;
  onPress: () => void;
  onHold: () => void;
  onRelease: () => void;
}) {
  const c = useBlanc();
  return (
    <Pressable
      // For touch only: VoiceOver steps the row it sits in (adjustable).
      accessible={false}
      disabled={disabled}
      onPress={onPress}
      onLongPress={onHold}
      delayLongPress={350}
      onPressOut={onRelease}
      // 36 points drawn, 44 to touch.
      hitSlop={{ top: 4, bottom: 4 }}
      style={({ pressed }) => ({
        width: 44,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? c.pressed : c.fill,
        opacity: disabled ? 0.35 : 1,
      })}>
      <SymbolView name={symbol} size={15} weight="semibold" tintColor={c.ink} />
    </Pressable>
  );
}
