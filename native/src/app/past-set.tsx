import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Keyboard, Pressable, ScrollView, View } from 'react-native';

import { buildPastSetUpdate } from '@/lib/historyMonth';
import { useAppStore } from '@/stores/appStore';
import { BlancText } from '~/components/BlancText';
import { Capsule } from '~/components/Capsule';
import { FigureInput } from '~/components/FigureInput';
import { GlassButton } from '~/components/GlassButton';
import { haptics } from '~/lib/haptics';
import { editPastWorkout, useHistoryStore } from '~/lib/history';
import { chooseRpe, parseNumber } from '~/lib/setEntry';
import { useBlanc } from '~/theme/blanc';

/**
 * Corrects one set of a past workout. Clearing weight or reps leaves the set
 * not logged, as on the web; a failed save keeps the numbers for a retry.
 */
export default function PastSetSheet() {
  const c = useBlanc();
  const params = useLocalSearchParams<{ workout: string; set: string; number?: string }>();
  const workout = useHistoryStore((state) => state.workouts.find((entry) => entry.id === params.workout) ?? null);
  const set = workout?.sets.find((entry) => entry.id === params.set) ?? null;
  const [weight, setWeight] = useState(set?.weight == null ? '' : String(set.weight));
  const [reps, setReps] = useState(set?.reps == null ? '' : String(set.reps));
  const [rpe, setRpe] = useState<number | null>(set?.rpe ?? null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const number = params.number ?? String(set?.set_number ?? '');
  const name = (set?.exercise as { name?: string } | undefined)?.name ?? 'Set';

  const save = async () => {
    if (!workout || !set || saving) return;
    Keyboard.dismiss();
    setSaving(true);
    setFailed(false);
    const weightValue = weight.trim() ? parseNumber(weight) : null;
    const repsValue = reps.trim() ? parseNumber(reps) : null;
    const values = { weight: weightValue, reps: repsValue === null ? null : Math.round(repsValue), rpe };
    const saved = await editPastWorkout(workout.id, () =>
      useAppStore.getState().updateSet(set.id, buildPastSetUpdate(set, values, workout.completed_at)),
    );
    if (saved) {
      haptics.success();
      router.back();
    } else {
      haptics.error();
      setFailed(true);
      setSaving(false);
    }
  };

  return (
    <ScrollView style={{ backgroundColor: c.ground }} contentContainerStyle={{ paddingBottom: 28 }} keyboardShouldPersistTaps="handled" scrollEnabled={false}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 16 }}>
        <GlassButton symbol="xmark" accessibilityLabel="Close" onPress={() => router.back()} />
        <View style={{ flex: 1, alignItems: 'center' }}>
          <BlancText variant="headline" numberOfLines={1} accessibilityRole="header">
            {name}
          </BlancText>
          <BlancText variant="footnote" tone="graphite">
            Set {number}
          </BlancText>
        </View>
        <View style={{ width: 44 }} />
      </View>

      {set ? (
        <View style={{ paddingHorizontal: 24, paddingTop: 18 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 5 }}>
              <FigureInput
                value={weight}
                fontSize={56}
                onChangeText={setWeight}
                keyboardType="decimal-pad"
                selectTextOnFocus
                maxLength={6}
                accessibilityLabel="Weight in pounds"
              />
              <BlancText variant="secondary" tone="graphite">
                lb
              </BlancText>
            </View>
            <BlancText variant="figure" size={26} tone="graphite" style={{ marginBottom: 10 }}>
              ×
            </BlancText>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 5 }}>
              <FigureInput
                value={reps}
                fontSize={56}
                onChangeText={setReps}
                keyboardType="number-pad"
                selectTextOnFocus
                maxLength={4}
                accessibilityLabel="Reps"
              />
              <BlancText variant="secondary" tone="graphite">
                reps
              </BlancText>
            </View>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={rpe ? `RPE ${rpe}. Change` : 'Add RPE'}
            onPress={() => chooseRpe(setRpe)}
            style={({ pressed }) => ({
              alignSelf: 'flex-start',
              height: 34,
              paddingHorizontal: 14,
              marginTop: 14,
              borderRadius: 17,
              justifyContent: 'center',
              backgroundColor: pressed ? c.pressed : c.fill,
            })}>
            <BlancText variant="footnote" weight="500">
              {rpe ? `RPE ${rpe}` : 'Add RPE'}
            </BlancText>
          </Pressable>

          {failed ? (
            <BlancText variant="footnote" tone="live" style={{ marginTop: 12 }} accessibilityRole="alert">
              Not saved. Your numbers are kept; try again.
            </BlancText>
          ) : null}

          <View style={{ marginTop: 20 }}>
            <Capsule title={failed ? 'Retry' : 'Save'} fill busy={saving} onPress={() => void save()} />
          </View>
        </View>
      ) : (
        <BlancText variant="secondary" tone="graphite" style={{ margin: 24 }}>
          This set is no longer in the workout.
        </BlancText>
      )}
    </ScrollView>
  );
}
