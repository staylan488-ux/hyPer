import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Keyboard, ScrollView, View } from 'react-native';

import {
  TARGET_DRIFT_WARNING_PCT,
  baseTargets,
  editTargetField,
  targetDrift,
  targetsChanged,
  type TargetDraft,
  type TargetNumbers,
} from '@/lib/settingsUx';
import { useAppStore } from '@/stores/appStore';
import { BlancText } from '~/components/BlancText';
import { Capsule } from '~/components/Capsule';
import { FieldRow, FormNote } from '~/components/Form';
import { GlassButton } from '~/components/GlassButton';
import { Label } from '~/components/Label';
import { Hairline } from '~/components/Row';
import { Section } from '~/components/Section';
import { formatWhole } from '~/lib/format';
import { haptics } from '~/lib/haptics';
import { useLeaveGuard } from '~/lib/leaveGuard';
import { loadTargets, useTargetsStore } from '~/lib/you';
import { useBlanc } from '~/theme/blanc';

const FIELDS: { key: keyof TargetNumbers; label: string; unit: string }[] = [
  { key: 'calories', label: 'Calories', unit: 'kcal' },
  { key: 'protein', label: 'Protein', unit: 'g' },
  { key: 'carbs', label: 'Carbs', unit: 'g' },
  { key: 'fat', label: 'Fat', unit: 'g' },
];

/**
 * Edit targets: the four numbers, filled with the saved targets or with what
 * the calculator or coach suggested. Typing makes them targets set by hand;
 * nothing is saved until Save.
 */
export default function TargetsEditSheet() {
  const c = useBlanc();
  const target = useAppStore((state) => state.macroTarget);
  // Taken once: suggestions handed over by the calculator or the coach.
  const [staged] = useState(() => useTargetsStore.getState().staged);
  const base = baseTargets(target);
  const [draft, setDraft] = useState<TargetDraft>(() => staged?.draft ?? base);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const changed = targetsChanged(draft, base) || !target;
  const { kcalFromMacros, driftPct } = targetDrift(draft);

  useEffect(() => {
    useTargetsStore.setState({ staged: null });
  }, []);

  useLeaveGuard(
    targetsChanged(draft, base) && !saved,
    {
      title: 'Discard these targets?',
      message: staged?.profileSaved
        ? 'Your profile and weight are already saved. Discarding the targets does not undo those.'
        : undefined,
    },
    { busy: saving },
  );

  useEffect(() => {
    if (saved) router.back();
  }, [saved]);

  const save = async () => {
    if (saving) return;
    Keyboard.dismiss();
    setSaving(true);
    setError(null);
    try {
      await useAppStore.getState().updateMacroTarget(draft);
      haptics.success();
      useTargetsStore.setState({ message: { text: 'Daily targets saved.' } });
      void loadTargets();
      setSaved(true);
    } catch {
      haptics.error();
      setError('Could not save daily targets. Your numbers are kept; try again.');
      setSaving(false);
    }
  };

  return (
    <ScrollView style={{ backgroundColor: c.ground }} contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 16 }}>
        <GlassButton symbol="xmark" accessibilityLabel="Close" onPress={() => router.back()} />
        <View style={{ flex: 1, alignItems: 'center' }}>
          <BlancText variant="headline" accessibilityRole="header">
            {staged ? 'Review targets' : 'Edit targets'}
          </BlancText>
        </View>
        <View style={{ width: 44 }} />
      </View>

      <Label style={{ marginTop: 20 }}>
        {FIELDS.map((field, index) => (
          <View key={field.key}>
            {index > 0 ? <Hairline /> : null}
            <FieldRow
              label={field.label}
              unit={field.unit}
              value={String(draft[field.key])}
              keyboardType="number-pad"
              selectTextOnFocus
              maxLength={5}
              onChangeText={(text) => {
                setError(null);
                setDraft((current) => editTargetField(current, field.key, text));
              }}
            />
          </View>
        ))}
      </Label>
      {driftPct > TARGET_DRIFT_WARNING_PCT ? (
        <FormNote alert>
          These macros add up to {formatWhole(kcalFromMacros)} kcal, not {formatWhole(draft.calories)}. Check them before saving.
        </FormNote>
      ) : (
        <FormNote>
          {draft.source === 'manual'
            ? 'Set by hand: they stay fixed until you resume adaptive targets.'
            : 'Calculated: they can adapt when automatic adjustments are on.'}
        </FormNote>
      )}

      {staged?.coach ? (
        <Section title="Why these">
          <BlancText variant="secondary" style={{ marginHorizontal: 20 }}>
            {staged.coach.rationale}
          </BlancText>
          {staged.coach.cautions ? (
            <BlancText variant="secondary" weight="600" style={{ marginHorizontal: 20, marginTop: 8 }}>
              {staged.coach.cautions}
            </BlancText>
          ) : null}
          <BlancText variant="footnote" tone="graphite" style={{ marginHorizontal: 20, marginTop: 8 }}>
            Not medical advice.
          </BlancText>
        </Section>
      ) : null}

      {error ? (
        <BlancText variant="footnote" tone="live" style={{ marginHorizontal: 32, marginTop: 12 }} accessibilityRole="alert">
          {error}
        </BlancText>
      ) : null}
      <View style={{ marginHorizontal: 16, marginTop: 24 }}>
        <Capsule title={error ? 'Retry' : 'Save targets'} size="large" fill busy={saving} disabled={!changed} onPress={() => void save()} />
      </View>
    </ScrollView>
  );
}
