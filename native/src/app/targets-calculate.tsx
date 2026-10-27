import { Host, Picker, Text as SwiftText } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { router, useNavigation, usePreventRemove } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
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
  wizardBodyReady,
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
import { FieldRow, FormNote } from '~/components/Form';
import { GlassButton } from '~/components/GlassButton';
import { Label } from '~/components/Label';
import { Hairline, Row } from '~/components/Row';
import { Section } from '~/components/Section';
import { formatWhole } from '~/lib/format';
import { haptics } from '~/lib/haptics';
import { confirmAlert } from '~/lib/program';
import { loadWeights, stageTargets, useWeightStore } from '~/lib/you';
import { type as typeScale, useBlanc } from '~/theme/blanc';

/**
 * Calculate targets: body, activity and goal on one page, with the targets
 * they give updating underneath. Saving keeps the profile (and a changed
 * weight) and hands the targets to the edit sheet for a last look.
 */
export default function TargetsCalculateSheet() {
  const c = useBlanc();
  const navigation = useNavigation();
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
  const ready = wizardBodyReady(draft);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  usePreventRemove(dirty && !done, ({ data }) => {
    if (saving) return;
    void confirmAlert({
      title: 'Discard these changes?',
      confirmLabel: 'Discard',
      cancelLabel: 'Keep editing',
      destructive: true,
    }).then((discard) => {
      if (discard) navigation.dispatch(data.action);
    });
  });

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
    stageTargets({ ...outcome.targets, source: 'calculated' }, { profileSaved: true });
    setDone(true);
  };

  const imperial = draft.unitSystem === 'imperial';

  return (
    <ScrollView style={{ backgroundColor: c.ground }} contentContainerStyle={{ paddingBottom: 48 }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
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
              <CheckRow title={sentence(option.label)} detail={option.hint} checked={draft.activity === option.value} onPress={() => update({ activity: option.value })} />
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
              <CheckRow
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
              <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 64, paddingHorizontal: 12, gap: 8 }}>
                <StepButton symbol="minus" label="Decrease rate" disabled={!rateBounds.slower} onPress={() => setDraft((current) => stepWizardRate(current, -1))} />
                <View style={{ flex: 1, alignItems: 'center' }} accessible accessibilityLabel={`${rate.value > 0 ? 'Plus' : 'Minus'} ${Math.abs(rate.value).toFixed(2)} percent of bodyweight a ${rate.per}`}>
                  <BlancText variant="bodyStrong" style={{ fontVariant: ['tabular-nums'] }}>
                    {rate.value > 0 ? '+' : ''}
                    {rate.value.toFixed(2)}% a {rate.per}
                  </BlancText>
                  <BlancText variant="footnote" tone="graphite">
                    About {rate.weeklyChange.toFixed(2)} {rate.unit} a week
                  </BlancText>
                </View>
                <StepButton symbol="plus" label="Increase rate" disabled={!rateBounds.faster} onPress={() => setDraft((current) => stepWizardRate(current, 1))} />
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
            <BlancText variant="footnote" tone="graphite" style={{ marginTop: 2, marginBottom: 6 }}>
              {result.tdeeIsMeasured ? 'Learned daily burn' : 'Estimated daily burn'} {formatWhole(result.tdee)} kcal
            </BlancText>
          </View>
          <Hairline />
          <Row title="Protein" value={`${result.protein} g · ${split.protein}%`} />
          <Hairline />
          <Row title="Carbs" value={`${result.carbs} g · ${split.carbs}%`} />
          <Hairline />
          <Row title="Fat" value={`${result.fat} g · ${split.fat}%`} />
        </Label>
        {result.notes.map((note) => (
          <FormNote key={note.code}>{note.message}</FormNote>
        ))}
        <FormNote>{wizardMethodNote(result)}</FormNote>
      </Section>

      {error ? (
        <BlancText variant="footnote" tone="live" style={{ marginHorizontal: 32, marginTop: 16 }} accessibilityRole="alert">
          {error}
        </BlancText>
      ) : null}
      <View style={{ marginHorizontal: 16, marginTop: 24 }}>
        <Capsule title="Save profile and review" size="large" fill busy={saving} disabled={!ready} onPress={() => void save()} />
      </View>
      <FormNote>Keeps these details (and a changed weight) in your profile. The targets wait for Save on the next screen.</FormNote>
    </ScrollView>
  );
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

function HeightRow({ feet, inches, onFeet, onInches }: { feet: string; inches: string; onFeet: (value: string) => void; onInches: (value: string) => void }) {
  const c = useBlanc();
  const input = [typeScale.body, { color: c.ink, padding: 0, minHeight: 44, minWidth: 28, textAlign: 'right' as const, fontVariant: ['tabular-nums' as const] }];
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 52, paddingLeft: 18, paddingRight: 16 }}>
      <BlancText variant="body" style={{ flex: 1 }}>
        Height
      </BlancText>
      <TextInput value={feet} onChangeText={onFeet} keyboardType="number-pad" maxLength={1} selectTextOnFocus accessibilityLabel="Height, feet" style={input} />
      <BlancText variant="body" tone="graphite">
        ft
      </BlancText>
      <TextInput value={inches} onChangeText={onInches} keyboardType="number-pad" maxLength={2} selectTextOnFocus accessibilityLabel="Height, inches" style={input} />
      <BlancText variant="body" tone="graphite" style={{ minWidth: 30 }}>
        in
      </BlancText>
    </View>
  );
}

function CheckRow({ title, detail, checked, onPress }: { title: string; detail: string; checked: boolean; onPress: () => void }) {
  const c = useBlanc();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked }}
      accessibilityLabel={`${title}, ${detail}`}
      onPress={() => {
        if (!checked) haptics.select();
        onPress();
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
      })}>
      <View style={{ flex: 1 }}>
        <BlancText variant={checked ? 'bodyStrong' : 'body'}>{title}</BlancText>
        <BlancText variant="footnote" tone="graphite" style={{ marginTop: 1 }}>
          {detail}
        </BlancText>
      </View>
      {checked ? <SymbolView name="checkmark" size={15} weight="semibold" tintColor={c.ink} /> : null}
    </Pressable>
  );
}

function StepButton({ symbol, label, disabled, onPress }: { symbol: 'minus' | 'plus'; label: string; disabled: boolean; onPress: () => void }) {
  const c = useBlanc();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => {
        haptics.select();
        onPress();
      }}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? c.pressed : c.fill,
        opacity: disabled ? 0.35 : 1,
      })}>
      <SymbolView name={symbol} size={15} weight="semibold" tintColor={c.ink} />
    </Pressable>
  );
}
