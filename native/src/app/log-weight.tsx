import { Host, Picker, Text as SwiftText } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Keyboard, ScrollView, View } from 'react-native';

import { convertWeighInDraft, lastWeighInLabel, parseWeighIn } from '@/lib/bodyWeightSummary';
import { formatWeight, type WeightUnit } from '@/lib/weightDisplayCore';
import { BlancText } from '~/components/BlancText';
import { Capsule } from '~/components/Capsule';
import { FigureInput } from '~/components/FigureInput';
import { GlassButton } from '~/components/GlassButton';
import { haptics } from '~/lib/haptics';
import { useLeaveGuard } from '~/lib/leaveGuard';
import { logWeighIn, setWeightUnit, useWeightStore } from '~/lib/you';
import { useBlanc } from '~/theme/blanc';

/** Log weight: one number in the unit you weigh in, saved as a typed weigh-in. */
export default function LogWeightSheet() {
  const c = useBlanc();
  const latest = useWeightStore((state) => state.history[0] ?? null);
  const failedHistory = useWeightStore((state) => state.failed);
  const unit = useWeightStore((state) => state.unit);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

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
    const failure = await logWeighIn(parsed.kilograms);
    if (failure) {
      haptics.error();
      setError(failure);
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
    <ScrollView style={{ backgroundColor: c.ground }} contentContainerStyle={{ paddingBottom: 28 }} keyboardShouldPersistTaps="handled" scrollEnabled={false}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 16 }}>
        <GlassButton symbol="xmark" accessibilityLabel="Close" onPress={() => router.back()} />
        <View style={{ flex: 1, alignItems: 'center' }}>
          <BlancText variant="headline" accessibilityRole="header">
            Log weight
          </BlancText>
        </View>
        <View style={{ width: 44 }} />
      </View>

      <View style={{ paddingHorizontal: 24, paddingTop: 18 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
          <FigureInput
            value={draft}
            fontSize={64}
            autoFocus
            onChangeText={(text) => {
              setError(null);
              setDraft(text);
            }}
            keyboardType="decimal-pad"
            maxLength={6}
            placeholder={latest ? formatWeight(Number(latest.kilograms), unit) : unit === 'lb' ? '180.5' : '82.0'}
            accessibilityLabel={`Weight in ${unit === 'lb' ? 'pounds' : 'kilograms'}`}
            onSubmitEditing={() => void save()}
          />
          <BlancText variant="secondary" tone="graphite">
            {unit}
          </BlancText>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, gap: 12 }}>
          <BlancText variant="footnote" tone="graphite" style={{ flex: 1 }}>
            {lastWeighInLabel(latest, unit, failedHistory)}
          </BlancText>
          <Host matchContents style={{ width: 110 }}>
            <Picker selection={unit} onSelectionChange={(next) => switchUnit(next as WeightUnit)} modifiers={[pickerStyle('segmented')]}>
              <SwiftText modifiers={[tag('lb')]}>lb</SwiftText>
              <SwiftText modifiers={[tag('kg')]}>kg</SwiftText>
            </Picker>
          </Host>
        </View>

        {error ? (
          <BlancText variant="footnote" tone="live" style={{ marginTop: 12 }} accessibilityRole="alert">
            {error}
          </BlancText>
        ) : null}

        <View style={{ marginTop: 22 }}>
          <Capsule title="Save" fill busy={saving} disabled={draft.trim() === ''} onPress={() => void save()} />
        </View>
      </View>
    </ScrollView>
  );
}
