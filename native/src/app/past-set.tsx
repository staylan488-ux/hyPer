import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Keyboard, ScrollView, View } from 'react-native';

import { buildPastSetUpdate } from '@/lib/historyMonth';
import { useAppStore } from '@/stores/appStore';
import { BlancText } from '~/components/BlancText';
import { Capsule } from '~/components/Capsule';
import { Chip } from '~/components/Chip';
import { FigureInput } from '~/components/FigureInput';
import type { TextField } from '~/components/Form';
import { GlassButton } from '~/components/GlassButton';
import { announce, useAnnounce, useLargeText } from '~/lib/accessibility';
import { haptics } from '~/lib/haptics';
import { editPastWorkout, useHistoryStore } from '~/lib/history';
import { useLeaveGuard } from '~/lib/leaveGuard';
import { chooseRpe, parseNumber } from '~/lib/setEntry';
import { space, useBlanc } from '~/theme/blanc';

/** Text VoiceOver skips: the fields are named "Weight in pounds" and "Reps", and the × is read as part of neither. */
const spokenByField = { accessibilityElementsHidden: true, importantForAccessibility: 'no' as const };

/**
 * Corrects one set of a past workout. Clearing weight or reps leaves the set
 * not logged; a failed save keeps the numbers for a retry.
 */
export default function PastSetSheet() {
  const c = useBlanc();
  const large = useLargeText();
  const params = useLocalSearchParams<{ workout: string; set: string; number?: string }>();
  const workout = useHistoryStore((state) => state.workouts.find((entry) => entry.id === params.workout) ?? null);
  const set = workout?.sets.find((entry) => entry.id === params.set) ?? null;
  const [weight, setWeight] = useState(set?.weight == null ? '' : String(set.weight));
  const [reps, setReps] = useState(set?.reps == null ? '' : String(set.reps));
  const [rpe, setRpe] = useState<number | null>(set?.rpe ?? null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [saved, setSaved] = useState(false);
  const weightField = useRef<TextField>(null);
  const selectedOnce = useRef(false);
  const number = params.number ?? String(set?.set_number ?? '');
  const name = (set?.exercise as { name?: string } | undefined)?.name ?? 'Set';

  // Typed corrections hold the sheet: closing asks before they go.
  const dirty =
    set !== null &&
    (weight.trim() !== (set.weight == null ? '' : String(set.weight)) ||
      reps.trim() !== (set.reps == null ? '' : String(set.reps)) ||
      rpe !== (set.rpe ?? null));
  useLeaveGuard(dirty && !saved, { title: 'Discard this correction?' }, { busy: saving });
  useAnnounce(failed && 'Not saved. Your numbers are kept; try again.');

  const save = async () => {
    if (!workout || !set || saving) return;
    Keyboard.dismiss();
    setSaving(true);
    setFailed(false);
    const weightValue = weight.trim() ? parseNumber(weight) : null;
    const repsValue = reps.trim() ? parseNumber(reps) : null;
    const values = { weight: weightValue, reps: repsValue === null ? null : Math.round(repsValue), rpe };
    const ok = await editPastWorkout(workout.id, () => {
      // A logged set takes its time from the workout as it is when the save runs.
      const latest = useHistoryStore.getState().workouts.find((entry) => entry.id === workout.id) ?? workout;
      return useAppStore.getState().updateSet(set.id, buildPastSetUpdate(set, values, latest));
    });
    if (ok) {
      haptics.success();
      announce(`Set ${number} saved`);
      setSaved(true);
    } else {
      haptics.error();
      setFailed(true);
      setSaving(false);
    }
  };
  // Closes once the guard has seen the saved state.
  useEffect(() => {
    if (saved) router.back();
  }, [saved]);

  return (
    <ScrollView
      style={{ backgroundColor: c.ground }}
      contentContainerStyle={{ paddingBottom: 28 }}
      keyboardShouldPersistTaps="handled"
      // The sheet fits its content; at the accessibility text sizes that can pass the screen's height.
      scrollEnabled={large}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 16 }}>
        <GlassButton symbol="xmark" accessibilityLabel="Close" onPress={() => router.back()} />
        <View style={{ flex: 1, alignItems: 'center' }} accessible accessibilityRole="header" accessibilityLabel={`${name}, set ${number}`}>
          <BlancText variant="headline" numberOfLines={large ? undefined : 1} style={large ? { textAlign: 'center' } : undefined}>
            {name}
          </BlancText>
          <BlancText variant="footnote" tone="graphite">
            Set {number}
          </BlancText>
        </View>
        <View style={{ width: 44 }} />
      </View>

      {set ? (
        <View style={{ paddingHorizontal: space.inset, paddingTop: 18 }}>
          {/* At the accessibility text sizes the reps go under the weight when both do not fit. */}
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10, ...(large ? { flexWrap: 'wrap' } : null) }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 5 }}>
              <FigureInput
                ref={weightField}
                value={weight}
                fontSize={56}
                onChangeText={setWeight}
                keyboardType="decimal-pad"
                autoFocus
                selectTextOnFocus
                // iOS skips selectTextOnFocus for a field focused as the sheet
                // opens, and typed digits then landed after the old weight
                // (found in milestone 5). Selecting it once it has focus makes
                // the first digit replace the number.
                onFocus={() => {
                  if (selectedOnce.current) return;
                  selectedOnce.current = true;
                  requestAnimationFrame(() => weightField.current?.setSelection(0, weight.length));
                }}
                editable={!saving}
                maxLength={6}
                accessibilityLabel="Weight in pounds"
              />
              <BlancText variant="secondary" tone="graphite" {...spokenByField}>
                lb
              </BlancText>
            </View>
            <BlancText variant="figure" size={26} tone="graphite" style={{ marginBottom: 10 }} {...spokenByField}>
              ×
            </BlancText>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 5 }}>
              <FigureInput
                value={reps}
                fontSize={56}
                onChangeText={setReps}
                keyboardType="number-pad"
                selectTextOnFocus
                editable={!saving}
                maxLength={4}
                accessibilityLabel="Reps"
              />
              <BlancText variant="secondary" tone="graphite" {...spokenByField}>
                reps
              </BlancText>
            </View>
          </View>

          <Chip
            label={rpe ? `RPE ${rpe}` : 'Add RPE'}
            accessibilityLabel={rpe ? `RPE ${rpe}. Change` : 'Add RPE'}
            disabled={saving}
            haptic={false}
            onPress={() => chooseRpe(setRpe)}
            style={{ alignSelf: 'flex-start', marginTop: 14 }}
          />

          {failed ? (
            <BlancText variant="footnote" tone="live" style={{ marginTop: 12 }} accessibilityRole="alert">
              Not saved. Your numbers are kept; try again.
            </BlancText>
          ) : null}

          <View style={{ marginTop: 20 }}>
            <Capsule title={failed ? 'Retry' : 'Save'} size="large" fill busy={saving} onPress={() => void save()} />
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
