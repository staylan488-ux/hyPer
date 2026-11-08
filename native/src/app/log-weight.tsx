import { Host, Picker, Text as SwiftText } from '@expo/ui/swift-ui';
import { accessibilityLabel, pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { endOfDay, format, parseISO } from 'date-fns';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Keyboard, ScrollView, View } from 'react-native';

import { convertWeighInDraft, lastWeighInLabel, parseWeighIn } from '@/lib/bodyWeightSummary';
import { formatWeight, type WeightUnit } from '@/lib/weightDisplayCore';
import { BlancText } from '~/components/BlancText';
import { Capsule } from '~/components/Capsule';
import { FigureInput } from '~/components/FigureInput';
import { PickerRow } from '~/components/Form';
import { GlassButton } from '~/components/GlassButton';
import { Label } from '~/components/Label';
import { useAnnounce, useLargeText } from '~/lib/accessibility';
import { useCurrentDayKey } from '~/lib/accountData';
import { haptics } from '~/lib/haptics';
import { useLeaveGuard } from '~/lib/leaveGuard';
import { logWeighIn, setWeightUnit, useWeightStore, weighInTime } from '~/lib/you';
import { space, useBlanc } from '~/theme/blanc';

/**
 * Log weight: one number in the unit you weigh in, saved as a typed weigh-in:
 * now, or on an earlier day for one that was missed.
 */
export default function LogWeightSheet() {
  const c = useBlanc();
  const latest = useWeightStore((state) => state.history[0] ?? null);
  const failedHistory = useWeightStore((state) => state.failed);
  const unit = useWeightStore((state) => state.unit);
  // A sheet left open past midnight stops calling yesterday "today".
  const todayKey = useCurrentDayKey();
  const [draft, setDraft] = useState('');
  // The day picked for a missed weigh-in; null logs it now.
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const shownDay = pickedDay && pickedDay < todayKey ? pickedDay : todayKey;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A save that failed (not a number to fix) makes the button Retry.
  const [saveFailed, setSaveFailed] = useState(false);
  const [saved, setSaved] = useState(false);
  const large = useLargeText();
  // A number to fix or a save that failed shows under the figure, away from Save.
  useAnnounce(error);

  // A typed number holds the sheet: closing asks before it goes.
  useLeaveGuard(draft.trim() !== '' && !saved, { title: 'Discard this weigh-in?' }, { busy: saving });

  const switchUnit = (next: WeightUnit) => {
    if (next === unit) return;
    haptics.select();
    setDraft((current) => convertWeighInDraft(current, unit, next));
    setWeightUnit(next);
  };

  const save = async () => {
    if (saving) return;
    const parsed = parseWeighIn(draft, unit);
    if ('error' in parsed) {
      haptics.error();
      setError(parsed.error);
      return;
    }
    Keyboard.dismiss();
    setSaving(true);
    setError(null);
    const failure = await logWeighIn(parsed.kilograms, weighInTime(shownDay, todayKey));
    if (failure) {
      haptics.error();
      setError(failure);
      setSaveFailed(true);
      setSaving(false);
      return;
    }
    haptics.success();
    setSaved(true);
  };
  // Closes once the guard has seen the saved state.
  useEffect(() => {
    if (saved) router.back();
  }, [saved]);

  return (
    // The sheet fits its content; at the accessibility text sizes that can pass the screen, so it scrolls.
    <ScrollView style={{ backgroundColor: c.ground }} contentContainerStyle={{ paddingBottom: 28 }} keyboardShouldPersistTaps="handled" scrollEnabled={large}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 16 }}>
        <GlassButton symbol="xmark" accessibilityLabel="Close" onPress={() => router.back()} />
        <View style={{ flex: 1, alignItems: 'center' }}>
          <BlancText variant="headline" accessibilityRole="header">
            Log weight
          </BlancText>
        </View>
        <View style={{ width: 44 }} />
      </View>

      <View style={{ paddingHorizontal: space.inset, paddingTop: 18 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, ...(large ? { flexWrap: 'wrap', rowGap: 0 } : null) }}>
          <FigureInput
            value={draft}
            fontSize={64}
            autoFocus
            onChangeText={(text) => {
              setError(null);
              setSaveFailed(false);
              setDraft(text);
            }}
            keyboardType="decimal-pad"
            maxLength={6}
            placeholder={latest ? formatWeight(Number(latest.kilograms), unit) : unit === 'lb' ? '180.5' : '82.0'}
            accessibilityLabel={`Weight in ${unit === 'lb' ? 'pounds' : 'kilograms'}`}
            // The pad's Done saves a typed weight; with nothing typed it only closes the pad.
            onSubmitEditing={() => {
              if (draft.trim() !== '') void save();
            }}
          />
          {/* The field's name says the unit. */}
          <BlancText variant="secondary" tone="graphite" accessibilityElementsHidden importantForAccessibility="no">
            {unit}
          </BlancText>
        </View>
        {/* At the accessibility text sizes the unit switch sits under the last weigh-in. */}
        <View style={large ? { alignItems: 'flex-start', marginTop: 10, gap: 10 } : { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, gap: 12 }}>
          <BlancText variant="footnote" tone="graphite" style={large ? undefined : { flex: 1 }}>
            {lastWeighInLabel(latest, failedHistory, todayKey)}
          </BlancText>
          {/* A host that matched its contents both ways shrank the segmented control to its smallest. */}
          <Host matchContents={{ vertical: true }} style={{ width: 110 }}>
            <Picker selection={unit} onSelectionChange={(next) => switchUnit(next as WeightUnit)} modifiers={[pickerStyle('segmented')]}>
              <SwiftText modifiers={[tag('lb'), accessibilityLabel('Pounds')]}>lb</SwiftText>
              <SwiftText modifiers={[tag('kg'), accessibilityLabel('Kilograms')]}>kg</SwiftText>
            </Picker>
          </Host>
        </View>

        {error ? (
          <BlancText variant="footnote" tone="live" style={{ marginTop: 12 }} accessibilityRole="alert">
            {error}
          </BlancText>
        ) : null}
      </View>

      {/* Today by default; an earlier day logs a missed weigh-in at this time of day. */}
      <Label style={{ marginTop: 18 }}>
        <PickerRow
          label="Day"
          mode="date"
          value={parseISO(shownDay)}
          max={endOfDay(parseISO(todayKey))}
          disabled={saving}
          onChange={(date) => setPickedDay(format(date, 'yyyy-MM-dd'))}
        />
      </Label>

      {/* The sheet's action, as large and at the same inset as the other sheets'. */}
      <View style={{ marginHorizontal: space.inset, marginTop: 22 }}>
        <Capsule title={saveFailed ? 'Retry' : 'Save'} size="large" fill busy={saving} disabled={draft.trim() === ''} onPress={() => void save()} />
      </View>
    </ScrollView>
  );
}
