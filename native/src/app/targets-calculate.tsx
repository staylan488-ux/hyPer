import { Host, Picker, Text as SwiftText } from '@expo/ui/swift-ui';
import { accessibilityLabel, pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { ActivityIndicator, Keyboard, Pressable, ScrollView, TextInput, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { recordManualBodyWeight } from '@/lib/healthWeights';
import { macroCaloriePercentages } from '@/lib/nutritionCalculator';
import {
  ACTIVITY_OPTIONS,
  GOAL_OPTIONS,
  initialWizardDraft,
  selectWizardGoal,
  sentenceLabel,
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
  wizardWeightKg,
  type WizardDraft,
} from '@/lib/nutritionWizard';
import { useAppStore } from '@/stores/appStore';
import { useAuthStore } from '@/stores/authStore';
import { BlancText } from '~/components/BlancText';
import { Capsule } from '~/components/Capsule';
import { ChoiceRow, FieldRow, FormNote, type TextField } from '~/components/Form';
import { GlassButton } from '~/components/GlassButton';
import { Label } from '~/components/Label';
import { RollingText } from '~/components/RollingText';
import { Hairline, Row } from '~/components/Row';
import { Section } from '~/components/Section';
import { Stepper } from '~/components/Stepper';
import { speak, useLargeText, useScreenReader } from '~/lib/accessibility';
import { formatWhole } from '~/lib/format';
import { haptics } from '~/lib/haptics';
import { useLeaveGuard } from '~/lib/leaveGuard';
import { figureLayout } from '~/lib/motion';
import { loadWeights, stageTargets, useTargetsLoaded, useWeightStore } from '~/lib/you';
import { type as typeScale, useBlanc } from '~/theme/blanc';

/**
 * Calculate targets: body, activity and goal on one page, with the targets
 * they give updating underneath. Saving keeps the profile (and a changed
 * weight) and hands the targets to the edit sheet for a last look.
 *
 * The form starts from the saved profile and the latest weigh-in, so it waits
 * for them: started from the defaults, saving wrote a profile without its
 * learned burn (and a made-up weigh-in).
 */
export default function TargetsCalculateSheet() {
  const c = useBlanc();
  const profileRead = useTargetsLoaded('profile');
  const [weightsRead, setWeightsRead] = useState(() => !useWeightStore.getState().loading);
  const [open, setOpen] = useState(false);
  const ready = profileRead.loaded && weightsRead;

  useEffect(() => {
    if (!weightsRead) void loadWeights().finally(() => setWeightsRead(true));
  }, [weightsRead]);
  // Once open it stays open: a later reload of the weights keeps what is typed.
  useEffect(() => {
    if (ready) setOpen(true);
  }, [ready]);

  if (ready || open) return <Calculator />;
  return (
    <ScrollView showsVerticalScrollIndicator={false} style={{ backgroundColor: c.ground }} contentContainerStyle={{ paddingBottom: 48 }}>
      <SheetHeader />
      {profileRead.failed ? (
        <>
          <BlancText variant="footnote" tone="live" style={{ marginHorizontal: 32, marginTop: 24 }} accessibilityRole="alert">
            Your profile did not load. Check your connection and try again.
          </BlancText>
          <View style={{ marginHorizontal: 16, marginTop: 24 }}>
            <Capsule title="Try again" size="large" fill onPress={profileRead.retry} />
          </View>
        </>
      ) : (
        <ActivityIndicator style={{ marginTop: 48 }} accessibilityLabel="Loading your profile" />
      )}
    </ScrollView>
  );
}

function SheetHeader() {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 16 }}>
      <GlassButton symbol="xmark" accessibilityLabel="Close" onPress={() => router.back()} />
      <View style={{ flex: 1, alignItems: 'center' }}>
        <BlancText variant="headline" accessibilityRole="header">
          Calculate targets
        </BlancText>
      </View>
      <View style={{ width: 44 }} />
    </View>
  );
}

function Calculator() {
  const c = useBlanc();
  const profile = useAppStore((state) => state.nutritionProfile);
  // The latest weigh-in as the form opened. An Apple Health import can reload
  // the weights while it is open; only a typed change records a weigh-in.
  const [openedKg] = useState(() => {
    const latest = useWeightStore.getState().history[0];
    return latest ? Number(latest.kilograms) : null;
  });
  const [initial] = useState(() => initialWizardDraft(profile, openedKg));
  const [draft, setDraft] = useState<WizardDraft>(initial);
  // Next on the number pad walks age, weight, height and body fat in order.
  const weightField = useRef<TextField>(null);
  const heightField = useRef<TextField>(null);
  const bodyFatField = useRef<TextField>(null);
  const next = { returnKeyType: 'next' as const, submitBehavior: 'submit' as const };
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const large = useLargeText();
  const screenReader = useScreenReader();
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
    // With no weigh-in known (none yet, or the read failed) the form opens at a
    // default weight, which is recorded only once it is changed.
    if (userId && wizardWeightChanged(openedKg ?? wizardWeightKg(initial), outcome.weightKg)) {
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
    <ScrollView showsVerticalScrollIndicator={false} style={{ backgroundColor: c.ground }} contentContainerStyle={{ paddingBottom: 48 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" automaticallyAdjustKeyboardInsets>
      <SheetHeader />

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
              <SwiftText modifiers={[tag('imperial'), accessibilityLabel('Pounds and feet')]}>lb, ft</SwiftText>
              <SwiftText modifiers={[tag('metric'), accessibilityLabel('Kilograms and centimeters')]}>kg, cm</SwiftText>
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
          <FieldRow
            label="Age"
            unit="yrs"
            accessibilityLabel="Age, years"
            value={draft.age}
            keyboardType="number-pad"
            maxLength={3}
            selectTextOnFocus
            {...next}
            onSubmitEditing={() => weightField.current?.focus()}
            onChangeText={(age) => update({ age })}
          />
          <Hairline />
          <FieldRow
            ref={weightField}
            label="Weight"
            unit={imperial ? 'lb' : 'kg'}
            value={draft.weight}
            keyboardType="decimal-pad"
            maxLength={5}
            selectTextOnFocus
            {...next}
            onSubmitEditing={() => heightField.current?.focus()}
            onChangeText={(weight) => update({ weight })}
          />
          <Hairline />
          {imperial ? (
            <HeightRow
              feetRef={heightField}
              feet={draft.heightFeet}
              inches={draft.heightInches}
              onFeet={(heightFeet) => update({ heightFeet })}
              onInches={(heightInches) => update({ heightInches })}
              onNext={() => bodyFatField.current?.focus()}
            />
          ) : (
            <FieldRow
              ref={heightField}
              label="Height"
              unit="cm"
              accessibilityLabel="Height, centimeters"
              value={draft.heightCm}
              keyboardType="number-pad"
              maxLength={3}
              selectTextOnFocus
              {...next}
              onSubmitEditing={() => bodyFatField.current?.focus()}
              onChangeText={(heightCm) => update({ heightCm })}
            />
          )}
          <Hairline />
          <FieldRow ref={bodyFatField} label="Body fat" unit={draft.bodyFat.trim() ? '%' : undefined} value={draft.bodyFat} placeholder="Optional" keyboardType="decimal-pad" maxLength={4} onChangeText={(bodyFat) => update({ bodyFat })} />
        </Label>
        <FormNote>{openedKg != null ? 'Weight is from your latest weigh-in. ' : ''}Body fat, if you know it, bases calories and protein on lean mass.</FormNote>
      </Section>

      <Section title="Activity">
        <Label>
          {ACTIVITY_OPTIONS.map((option, index) => (
            <View key={option.value}>
              {index > 0 ? <Hairline /> : null}
              <ChoiceRow title={sentenceLabel(option.label)} detail={option.hint} checked={draft.activity === option.value} onPress={() => update({ activity: option.value })} />
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
                title={sentenceLabel(option.label)}
                detail={option.hint}
                checked={draft.goal === option.value}
                onPress={() => setDraft((current) => selectWizardGoal(current, option.value))}
              />
            </View>
          ))}
          {draft.goal !== 'maintain' ? (
            <>
              <Hairline />
              {/* At the accessibility text sizes the stepper sits under the rate. */}
              <View
                style={
                  large
                    ? { alignItems: 'flex-start', minHeight: 64, paddingVertical: 12, paddingLeft: 18, paddingRight: 16, gap: 8 }
                    : { flexDirection: 'row', alignItems: 'center', minHeight: 64, paddingLeft: 18, paddingRight: 16, gap: 12 }
                }>
                <View
                  style={large ? undefined : { flex: 1 }}
                  accessible
                  accessibilityRole="adjustable"
                  accessibilityLabel="Rate"
                  accessibilityValue={{
                    text: speak(`${rate.value > 0 ? 'Plus' : 'Minus'} ${Math.abs(rate.value).toFixed(2)} percent of bodyweight a week, about ${rate.monthlyChange.toFixed(1)} ${rate.unit} a month`),
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
                {/* The rate beside it is adjustable: VoiceOver steps it there, in one
                    stop. Voice Control and keyboards keep the stepper. */}
                <View accessibilityElementsHidden={screenReader}>
                  <Stepper
                    canMinus={rateBounds.slower}
                    canPlus={rateBounds.faster}
                    minusLabel="Decrease rate"
                    plusLabel="Increase rate"
                    onMinus={() => setDraft((current) => stepWizardRate(current, -1))}
                    onPlus={() => setDraft((current) => stepWizardRate(current, 1))}
                  />
                </View>
              </View>
            </>
          ) : null}
        </Label>
      </Section>

      <Section title="Targets">
        <Label style={{ paddingTop: 16 }}>
          <View
            accessible
            accessibilityLabel={ready ? speak(`${formatWhole(result.calories)} kcal a day · ${breakdownLine(wizardBreakdown(result), draft.goal)}`) : 'Calories a day, not calculated yet'}
            style={{ paddingHorizontal: 18 }}>
            {/* At the accessibility text sizes the words wrap below the capped figure. */}
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, ...(large ? { flexWrap: 'wrap', rowGap: 0 } : null) }}>
              <RollingText variant="figure" size={48}>
                {ready ? formatWhole(result.calories) : '–'}
              </RollingText>
              <Animated.View layout={figureLayout}>
                <BlancText variant="secondary" tone="graphite">
                  kcal a day
                </BlancText>
              </Animated.View>
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

      {/* A failed save shows above the button, which stays where it was; the note announces it. */}
      {error ? <FormNote alert>{error}</FormNote> : null}
      <View style={{ marginHorizontal: 16, marginTop: 24 }}>
        <Capsule title="Save profile and review" size="large" fill busy={saving} disabled={!ready} onPress={() => void save()} />
      </View>
      <FormNote>Saves your details and weight. Targets come next.</FormNote>
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

function SegmentRow({ label, children }: { label: string; children: ReactNode }) {
  // At the accessibility text sizes the switch sits under its label.
  const large = useLargeText();
  return (
    <View
      style={
        large
          ? { alignItems: 'flex-start', gap: 8, minHeight: 52, paddingVertical: 12, paddingLeft: 18, paddingRight: 16 }
          : { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingLeft: 18, paddingRight: 16 }
      }>
      <BlancText variant="body" style={large ? undefined : { flex: 1 }}>
        {label}
      </BlancText>
      <Host ignoreSafeArea="all" matchContents={{ vertical: true }} style={{ width: 168 }}>
        {children}
      </Host>
    </View>
  );
}

/** Feet and inches, as FieldRow: a tap on the row starts with feet, Next goes on to inches, then on to the next field. */
function HeightRow({ feetRef, feet, inches, onFeet, onInches, onNext }: {
  feetRef: RefObject<TextField | null>;
  feet: string;
  inches: string;
  onFeet: (value: string) => void;
  onInches: (value: string) => void;
  onNext: () => void;
}) {
  const c = useBlanc();
  const large = useLargeText();
  const feetField = feetRef;
  const inchesField = useRef<TextField>(null);
  const input = { color: c.ink, padding: 0, minHeight: 44, minWidth: 44, textAlign: 'right' as const, fontVariant: ['tabular-nums' as const] };
  const fields = (
    <>
      <TextInput
        selectionColor={c.ink}
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
      <BlancText variant="body" tone="graphite" {...spokenByField}>
        ft
      </BlancText>
      <TextInput
        selectionColor={c.ink}
        ref={inchesField}
        value={inches}
        onChangeText={onInches}
        keyboardType="number-pad"
        maxLength={2}
        selectTextOnFocus
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={onNext}
        accessibilityLabel="Height, inches"
        lineBreakModeIOS="tail"
        style={[typeScale.field, input]}
      />
      <BlancText variant="body" tone="graphite" style={{ minWidth: 30 }} {...spokenByField}>
        in
      </BlancText>
    </>
  );
  return (
    <Pressable
      accessible={false}
      onPress={() => feetField.current?.focus()}
      // At the accessibility text sizes the label sits over the fields, as FieldRow's does.
      style={
        large
          ? { gap: 4, minHeight: 52, paddingVertical: 12, paddingLeft: 18, paddingRight: 16 }
          : { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingLeft: 18, paddingRight: 16 }
      }>
      <BlancText variant="body" style={large ? undefined : { flex: 1 }} {...spokenByField}>
        Height
      </BlancText>
      {large ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>{fields}</View> : fields}
    </Pressable>
  );
}

/** Text that VoiceOver skips: the fields beside it are named "Height, feet" and "Height, inches". */
const spokenByField = { accessibilityElementsHidden: true, importantForAccessibility: 'no' as const };
