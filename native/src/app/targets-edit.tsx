import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Keyboard, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

import {
  TARGET_DRIFT_WARNING_PCT,
  baseTargets,
  carbShare,
  editTargetField,
  followNote,
  macroTargetColumns,
  rebalanceMacros,
  targetDrift,
  targetsChanged,
  type FlexMacro,
  type TargetDraft,
  type TargetNumbers,
} from '@/lib/settingsUx';
import { useAppStore } from '@/stores/appStore';
import { BlancText } from '~/components/BlancText';
import { Capsule } from '~/components/Capsule';
import { FieldRow, FormNote, type TextField } from '~/components/Form';
import { GlassButton } from '~/components/GlassButton';
import { Label } from '~/components/Label';
import { Hairline } from '~/components/Row';
import { Section } from '~/components/Section';
import { formatWhole } from '~/lib/format';
import { haptics } from '~/lib/haptics';
import { useLeaveGuard } from '~/lib/leaveGuard';
import { loadTargets, useTargetsLoaded, useTargetsStore } from '~/lib/you';
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
 * nothing is saved until Save. A new calorie figure carries carbs and fat with
 * it so the macros still add up; protein, and carbs or fat once typed here,
 * stay put (`rebalanceMacros`). Opened from one of the numbers (`focus`), that
 * field is ready to type; Next walks the four, Done on the last puts the
 * keyboard away. Opened before the saved targets are read, the fields and
 * Save wait for them.
 */
export default function TargetsEditSheet() {
  const c = useBlanc();
  const { focus } = useLocalSearchParams<{ focus?: string }>();
  const fields = useRef<(TextField | null)[]>([]);
  const target = useAppStore((state) => state.macroTarget);
  // Taken once: suggestions handed over by the calculator or the coach.
  const [staged] = useState(() => useTargetsStore.getState().staged);
  const read = useTargetsLoaded('targets');
  // Suggested numbers need nothing read first.
  const ready = read.loaded || staged !== null;
  const loadFailed = !ready && read.failed;
  const [readyOnOpen] = useState(ready);
  const base = baseTargets(target);
  // Untouched, the draft is the saved targets, so it follows them in.
  const [edited, setEdited] = useState<TargetDraft | null>(() => staged?.draft ?? null);
  const draft = edited ?? base;
  // A field cleared to retype stays empty rather than turning into 0; Save
  // waits for a number in it.
  const [empty, setEmpty] = useState<Partial<Record<keyof TargetNumbers, boolean>>>({});
  const anyEmpty = FIELDS.some((field) => empty[field.key]);
  // Carbs or fat typed in this sheet are the person's; a calorie change leaves
  // them alone. The untyped pair keeps the split it had when calories first
  // changed.
  const [typed, setTyped] = useState<Partial<Record<FlexMacro, boolean>>>({});
  const split = useRef<number | null>(null);
  // Set once calories moved carbs or fat; the note then says which follow.
  const [followed, setFollowed] = useState(false);
  const follows = followed ? followNote(typed) : null;
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

  // The field asked for was not ready to type when the sheet opened.
  useEffect(() => {
    if (!ready || readyOnOpen) return;
    fields.current[FIELDS.findIndex((field) => field.key === focus)]?.focus();
  }, [ready, readyOnOpen, focus]);

  const save = async () => {
    if (saving || !ready || anyEmpty) return;
    Keyboard.dismiss();
    setSaving(true);
    setError(null);
    try {
      await useAppStore.getState().updateMacroTarget(macroTargetColumns(draft));
      // The figure on Targets and the haptic say it saved; no line lingers
      // there, and an earlier Resume's line goes with the change.
      haptics.success();
      useTargetsStore.setState({ message: null });
      void loadTargets();
      setSaved(true);
    } catch {
      haptics.error();
      setError('Could not save daily targets. Your numbers are kept; try again.');
      setSaving(false);
    }
  };

  return (
    <KeyboardAwareScrollView
      bottomOffset={24}
      style={{ flex: 1, backgroundColor: c.ground }}
      contentContainerStyle={{ paddingBottom: 40 }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive">
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
              ref={(node) => {
                fields.current[index] = node;
              }}
              label={field.label}
              unit={field.unit}
              value={ready && !empty[field.key] ? String(draft[field.key]) : ''}
              editable={ready}
              keyboardType="number-pad"
              selectTextOnFocus
              autoFocus={ready && field.key === focus}
              maxLength={5}
              returnKeyType={index < FIELDS.length - 1 ? 'next' : 'done'}
              submitBehavior={index < FIELDS.length - 1 ? 'submit' : 'blurAndSubmit'}
              onSubmitEditing={() => fields.current[index + 1]?.focus()}
              onChangeText={(text) => {
                setError(null);
                setEmpty((current) => ({ ...current, [field.key]: text.trim() === '' }));
                const key = field.key;
                if ((key === 'carbs' || key === 'fat') && !typed[key]) setTyped((current) => ({ ...current, [key]: true }));
                const rebalance = field.key === 'calories' && followNote(typed) !== null;
                setEdited((current) => {
                  const next = editTargetField(current ?? base, field.key, text);
                  if (!rebalance) return next;
                  split.current ??= carbShare(next);
                  return rebalanceMacros(next, split.current, typed);
                });
                if (rebalance) setFollowed(true);
              }}
            />
          </View>
        ))}
      </Label>
      {!ready ? null : driftPct > TARGET_DRIFT_WARNING_PCT ? (
        <FormNote alert announcement="These macros don't add up to your calories. Check them before saving.">
          These macros add up to {formatWhole(kcalFromMacros)} kcal, not {formatWhole(draft.calories)}. Check them before saving.
        </FormNote>
      ) : (
        <FormNote>
          {follows ? `${follows} ` : ''}
          {draft.source === 'manual'
            ? 'Set by hand: fixed until you resume adaptive targets.'
            : 'Calculated: these adapt while adaptive targets are on.'}
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

      {/* A failed save or read shows above the button, which stays where it was; the note announces it. */}
      {error || loadFailed ? <FormNote alert>{error ?? 'Your saved targets did not load. Check your connection and try again.'}</FormNote> : null}
      <View style={{ marginHorizontal: 16, marginTop: 24 }}>
        {loadFailed ? (
          <Capsule title="Try again" size="large" fill onPress={read.retry} />
        ) : (
          <Capsule
            title={error ? 'Retry' : 'Save targets'}
            size="large"
            fill
            busy={saving || !ready}
            disabled={!changed || anyEmpty}
            onPress={() => void save()}
          />
        )}
      </View>
    </KeyboardAwareScrollView>
  );
}
