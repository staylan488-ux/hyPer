import { Host, Picker, Text as SwiftText } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Keyboard, Pressable, ScrollView, TextInput, View } from 'react-native';

import { recordManualBodyWeight } from '@/lib/healthWeights';
import { macroCaloriePercentages } from '@/lib/nutritionCalculator';
import {
  ACTIVITY_OPTIONS,
  GOAL_OPTIONS,
  initialWizardDraft,
  selectWizardGoal,
  stepWizardRate,
  switchWizardUnits,
  learnedBurnLooksLow,
  wizardBodyReady,
  wizardBreakdown,
  wizardBurns,
  wizardMethodNote,
  wizardOutcome,
  wizardRateBounds,
  wizardRateDisplay,
  wizardResult,
  wizardWeightChanged,
  type WizardDraft,
} from '@/lib/nutritionWizard';
import { useAppStore } from '@/stores/appStore';
import { useAuthStore } from '@/stores/authStore';
import { BlancText } from '~/components/BlancText';
import { Capsule } from '~/components/Capsule';
import { ChoiceRow, FieldRow, FormNote, type TextField } from '~/components/Form';
import { GlassButton } from '~/components/GlassButton';
import { Label } from '~/components/Label';
import { Hairline, Row } from '~/components/Row';
import { Section } from '~/components/Section';
import { Stepper } from '~/components/Stepper';
import { formatWhole } from '~/lib/format';
import { haptics } from '~/lib/haptics';
import { useLeaveGuard } from '~/lib/leaveGuard';
import { loadWeights, stageTargets, useWeightStore } from '~/lib/you';
import { type as typeScale, useBlanc } from '~/theme/blanc';

/**
 * Calculate targets: body, activity and goal on one page, with the targets
 * they give updating underneath. Saving keeps the profile (and a changed
 * weight) and hands the targets to the edit sheet for a last look.
 */
export default function TargetsCalculateSheet() {
  const c = useBlanc();
  const profile = useAppStore((state) => state.nutritionProfile);
  const latestKg = useWeightStore((state) => (state.history[0] ? Number(state.history[0].kilograms) : null));
  const [initial] = useState(() => initialWizardDraft(profile, latestKg));
  const [draft, setDraft] = useState<WizardDraft>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const update = (patch: Partial<WizardDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const result = useMemo(() => wizardResult(draft, profile), [draft, profile]);
  const split = macroCaloriePercentages(result);
  const rate = wizardRateDisplay(draft, result);
  const rateBounds = wizardRateBounds(draft);
  const burns = wizardBurns(draft, profile);
  const ready = wizardBodyReady(draft);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  useLeaveGuard(dirty && !done, { title: 'Discard these changes?' }, { busy: saving });

  useEffect(() => {
    if (done) router.replace('/targets-edit');
  }, [done]);

  const save = async () => {
    if (saving || !ready) return;
    Keyboard.dismiss();
    setSaving(true);
    setError(null);
    const outcome = wizardOutcome(draft, profile);
    try {
      await useAppStore.getState().updateNutritionProfile(outcome.profile);
    } catch {
      haptics.error();
      setError('Could not save your profile. Your entries are kept; try again.');
      setSaving(false);
      return;
    }
    const userId = useAuthStore.getState().user?.id;
    if (userId && wizardWeightChanged(latestKg, outcome.weightKg)) {
      try {
        await recordManualBodyWeight(userId, outcome.weightKg);
        void loadWeights();
      } catch {
        // The profile is saved; the weight can be logged from Body weight.
      }
    }
    haptics.success();
    stageTargets({ ...outcome.targets, source: outcome.source }, { profileSaved: true });
    setDone(true);
  };

  const imperial = draft.unitSystem === 'imperial';
  // The rate reads and steps like the buttons beside it, for VoiceOver too.
  const stepRate = (direction: 1 | -1) => {
    if (direction === 1 ? !rateBounds.faster : !rateBounds.slower) return;
    haptics.select();
    setDraft((current) => stepWizardRate(current, direction));
  };

  return (
    <ScrollView style={{ backgroundColor: c.ground }} contentContainerStyle={{ paddingBottom: 48 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" automaticallyAdjustKeyboardInsets>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 16 }}>
        <GlassButton symbol="xmark" accessibilityLabel="Close" onPress={() => router.back()} />
        <View style={{ flex: 1, alignItems: 'center' }}>
          <BlancText variant="headline" accessibilityRole="header">
            Calculate targets
          </BlancText>
        </View>
        <View style={{ width: 44 }} />
      </View>

      <Section title="You">
        <Label>
          <SegmentRow label="Units">
            <Picker
              selection={draft.unitSystem}
              onSelectionChange={(next) => {
                haptics.select();
                setDraft((current) => switchWizardUnits(current, next as WizardDraft['unitSystem']));
              }}
              modifiers={[pickerStyle('segmented')]}>
              <SwiftText modifiers={[tag('imperial')]}>lb, ft</SwiftText>
              <SwiftText modifiers={[tag('metric')]}>kg, cm</SwiftText>
            </Picker>
          </SegmentRow>
          <Hairline />
          <SegmentRow label="Sex">
            <Picker
              selection={draft.sex}
              onSelectionChange={(next) => {
                haptics.select();
                update({ sex: next as WizardDraft['sex'] });
              }}
              modifiers={[pickerStyle('segmented')]}>
              <SwiftText modifiers={[tag('male')]}>Male</SwiftText>
              <SwiftText modifiers={[tag('female')]}>Female</SwiftText>
            </Picker>
          </SegmentRow>
          <Hairline />
          <FieldRow label="Age" unit="yrs" value={draft.age} keyboardType="number-pad" maxLength={3} selectTextOnFocus onChangeText={(age) => update({ age })} />
          <Hairline />
          <FieldRow
            label="Weight"
            unit={imperial ? 'lb' : 'kg'}
            value={draft.weight}
            keyboardType="decimal-pad"
            maxLength={5}
            selectTextOnFocus
            onChangeText={(weight) => update({ weight })}
          />
          <Hairline />
          {imperial ? (
            <HeightRow feet={draft.heightFeet} inches={draft.heightInches} onFeet={(heightFeet) => update({ heightFeet })} onInches={(heightInches) => update({ heightInches })} />
          ) : (
            <FieldRow label="Height" unit="cm" value={draft.heightCm} keyboardType="number-pad" maxLength={3} selectTextOnFocus onChangeText={(heightCm) => update({ heightCm })} />
          )}
          <Hairline />
          <FieldRow label="Body fat" unit="%" value={draft.bodyFat} placeholder="Optional" keyboardType="decimal-pad" maxLength={4} onChangeText={(bodyFat) => update({ bodyFat })} />
        </Label>
        <FormNote>{latestKg != null ? 'Weight is from your latest weigh-in. ' : ''}Body fat, if you know it, bases calories and protein on lean mass.</FormNote>
      </Section>

      <Section title="Activity">
        <Label>
          {ACTIVITY_OPTIONS.map((option, index) => (
            <View key={option.value}>
              {index > 0 ? <Hairline /> : null}
              <ChoiceRow title={sentence(option.label)} detail={option.hint} checked={draft.activity === option.value} onPress={() => update({ activity: option.value })} />
            </View>
          ))}
        </Label>
        <FormNote>Training and the rest of your day together. When torn, pick the lower one.</FormNote>
      </Section>

      <Section title="Goal">
        <Label>
          {GOAL_OPTIONS.map((option, index) => (
            <View key={option.value}>
              {index > 0 ? <Hairline /> : null}
              <ChoiceRow
                title={sentence(option.label)}
                detail={option.hint}
                checked={draft.goal === option.value}
                onPress={() => setDraft((current) => selectWizardGoal(current, option.value))}
              />
            </View>
          ))}
          {draft.goal !== 'maintain' ? (
            <>
              <Hairline />
              <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 64, paddingLeft: 18, paddingRight: 16, gap: 12 }}>
                <View
                  style={{ flex: 1 }}
                  accessible
                  accessibilityRole="adjustable"
                  accessibilityLabel="Rate"
                  accessibilityValue={{
                    text: `${rate.value > 0 ? 'Plus' : 'Minus'} ${Math.abs(rate.value).toFixed(2)} percent of bodyweight a week, about ${rate.monthlyChange.toFixed(1)} ${rate.unit} a month`,
                  }}
                  accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
                  onAccessibilityAction={(event) => {
                    if (event.nativeEvent.actionName === 'increment') stepRate(1);
                    if (event.nativeEvent.actionName === 'decrement') stepRate(-1);
                  }}>
                  <BlancText variant="bodyStrong" style={{ fontVariant: ['tabular-nums'] }}>
                    {rate.value > 0 ? '+' : ''}
                    {rate.value.toFixed(2)}% a week
                  </BlancText>
                  <BlancText variant="footnote" tone="graphite" style={{ fontVariant: ['tabular-nums'] }}>
                    About {rate.weeklyChange.toFixed(2)} {rate.unit} a week · {rate.monthlyChange.toFixed(1)} {rate.unit} a month
                  </BlancText>
                </View>
                <Stepper
                  canMinus={rateBounds.slower}
                  canPlus={rateBounds.faster}
                  minusLabel="Decrease rate"
                  plusLabel="Increase rate"
                  onMinus={() => setDraft((current) => stepWizardRate(current, -1))}
                  onPlus={() => setDraft((current) => stepWizardRate(current, 1))}
                />
              </View>
            </>
          ) : null}
        </Label>
      </Section>

      <Section title="Targets">
        <Label style={{ paddingTop: 16 }}>
          <View style={{ paddingHorizontal: 18 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
              <BlancText variant="figure" size={48}>
                {ready ? formatWhole(result.calories) : '–'}
              </BlancText>
              <BlancText variant="secondary" tone="graphite">
                kcal a day
              </BlancText>
            </View>
            {/* The target explains itself: the burn it builds on, plus or minus the goal. */}
            <BlancText variant="footnote" tone="graphite" style={{ marginTop: 2, marginBottom: 10, fontVariant: ['tabular-nums'] }}>
              {ready ? breakdownLine(wizardBreakdown(result), draft.goal) : ' '}
            </BlancText>
          </View>
          {burns.learned !== null ? (
            <>
              <Hairline />
              <ChoiceRow
                title={`Learned burn · ${formatWhole(burns.learned)} kcal`}
                detail="Adapts as you log and weigh in"
                checked={draft.burn === 'learned'}
                onPress={() => update({ burn: 'learned' })}
              />
              <Hairline />
              <ChoiceRow
                title={`Formula burn · ${formatWhole(burns.formula)} kcal`}
                detail="Fixed, from your body and activity"
                checked={draft.burn === 'formula'}
                onPress={() => update({ burn: 'formula' })}
              />
              {learnedBurnLooksLow(burns) ? (
                <BlancText variant="footnote" tone="graphite" style={{ marginHorizontal: 18, marginBottom: 12 }}>
                  Your learned burn is well below the formula. That usually means some food isn’t being logged, so the
                  formula is the safer start.
                </BlancText>
              ) : null}
            </>
          ) : null}
          {/* Read-only: they follow the choices above. */}
          <Hairline />
          <Row form title="Protein" value={`${result.protein} g · ${split.protein}%`} />
          <Hairline />
          <Row form title="Carbs" value={`${result.carbs} g · ${split.carbs}%`} />
          <Hairline />
          <Row form title="Fat" value={`${result.fat} g · ${split.fat}%`} />
        </Label>
        {result.notes.map((note) => (
          <FormNote key={note.code}>{note.message}</FormNote>
        ))}
        <FormNote>{wizardMethodNote(result)}</FormNote>
      </Section>

      {error ? <FormNote alert>{error}</FormNote> : null}
      <View style={{ marginHorizontal: 16, marginTop: 24 }}>
        <Capsule title="Save profile and review" size="large" fill busy={saving} disabled={!ready} onPress={() => void save()} />
      </View>
      <FormNote>Saves your details and weight. You review the targets next.</FormNote>
    </ScrollView>
  );
}

/**
 * "2,791 burn + 334 to gain", the target in its two parts. Maintaining, the
 * target is the burn rounded to whole macros (5 g steps, a few dozen kcal at
 * most), and says so rather than show two figures that seem to disagree.
 */
function breakdownLine({ burn, change }: { burn: number; change: number }, goal: WizardDraft['goal']): string {
  if (Math.abs(change) < 1) return `${formatWhole(burn)} kcal daily burn`;
  if (goal === 'maintain' && Math.abs(change) < 50) return `${formatWhole(burn)} kcal daily burn, rounded to fit the macros`;
  return `${formatWhole(burn)} burn ${change > 0 ? '+' : '−'} ${formatWhole(Math.abs(change))} to ${change > 0 ? 'gain' : 'lose'}`;
}

/** "Lean Bulk" → "Lean bulk": Blanc writes in sentence case. */
function sentence(label: string): string {
  return label.charAt(0) + label.slice(1).toLowerCase();
}

function SegmentRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingLeft: 18, paddingRight: 16 }}>
      <BlancText variant="body" style={{ flex: 1 }}>
        {label}
      </BlancText>
      <Host matchContents style={{ width: 168 }}>
        {children}
      </Host>
    </View>
  );
}

/** Feet and inches, as FieldRow: a tap on the row starts with feet, Next goes on to inches. */
function HeightRow({ feet, inches, onFeet, onInches }: { feet: string; inches: string; onFeet: (value: string) => void; onInches: (value: string) => void }) {
  const c = useBlanc();
  const feetField = useRef<TextField>(null);
  const inchesField = useRef<TextField>(null);
  const input = { color: c.ink, padding: 0, minHeight: 44, minWidth: 44, textAlign: 'right' as const, fontVariant: ['tabular-nums' as const] };
  return (
    <Pressable
      accessible={false}
      onPress={() => feetField.current?.focus()}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingLeft: 18, paddingRight: 16 }}>
      <BlancText variant="body" style={{ flex: 1 }}>
        Height
      </BlancText>
      <TextInput
        ref={feetField}
        value={feet}
        onChangeText={onFeet}
        keyboardType="number-pad"
        maxLength={1}
        selectTextOnFocus
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => inchesField.current?.focus()}
        accessibilityLabel="Height, feet"
        lineBreakModeIOS="tail"
        style={[typeScale.field, input]}
      />
      <BlancText variant="body" tone="graphite">
        ft
      </BlancText>
      <TextInput
        ref={inchesField}
        value={inches}
        onChangeText={onInches}
        keyboardType="number-pad"
        maxLength={2}
        selectTextOnFocus
        returnKeyType="done"
        accessibilityLabel="Height, inches"
        lineBreakModeIOS="tail"
        style={[typeScale.field, input]}
      />
      <BlancText variant="body" tone="graphite" style={{ minWidth: 30 }}>
        in
      </BlancText>
    </Pressable>
  );
}
