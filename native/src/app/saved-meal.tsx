import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Keyboard, ScrollView, View } from 'react-native';

import { replaceSavedMeal } from '@/lib/savedMeals';
import { useAuthStore } from '@/stores/authStore';
import { BlancText } from '~/components/BlancText';
import { Capsule } from '~/components/Capsule';
import { FieldRow, FormNote } from '~/components/Form';
import { GlassButton } from '~/components/GlassButton';
import { Label } from '~/components/Label';
import { Hairline } from '~/components/Row';
import { haptics } from '~/lib/haptics';
import { useLeaveGuard } from '~/lib/leaveGuard';
import { loadYouMeals, useYouMealsStore } from '~/lib/you';
import { useBlanc } from '~/theme/blanc';

type Draft = { name: string; calories: string; protein: string; carbs: string; fat: string };

const MACROS: { key: Exclude<keyof Draft, 'name'>; label: string; unit: string }[] = [
  { key: 'calories', label: 'Calories', unit: 'kcal' },
  { key: 'protein', label: 'Protein', unit: 'g' },
  { key: 'carbs', label: 'Carbs', unit: 'g' },
  { key: 'fat', label: 'Fat', unit: 'g' },
];

const oneDecimal = (value: unknown) => String(Math.round((Number(value) || 0) * 10) / 10);

/**
 * Edits a saved meal's name and numbers for future logs. As on the web, the
 * changed meal is saved as a new one and the old one retired, so past logs
 * keep what they were.
 */
export default function SavedMealSheet() {
  const c = useBlanc();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [meal] = useState(() => useYouMealsStore.getState().meals?.find((entry) => entry.id === id) ?? null);
  const [initial] = useState<Draft>(() => ({
    name: meal?.name ?? '',
    calories: oneDecimal(meal?.calories),
    protein: oneDecimal(meal?.protein),
    carbs: oneDecimal(meal?.carbs),
    fat: oneDecimal(meal?.fat),
  }));
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const changed = JSON.stringify(draft) !== JSON.stringify(initial);

  useLeaveGuard(changed && !done, undefined, { busy: saving });

  useEffect(() => {
    if (done) router.back();
  }, [done]);

  const save = async () => {
    if (!meal || saving) return;
    const name = draft.name.trim();
    if (!name) {
      haptics.error();
      setError('Give the meal a name.');
      return;
    }
    const userId = useAuthStore.getState().user?.id;
    if (!userId) {
      setError('Please sign in again to save meal edits.');
      return;
    }
    Keyboard.dismiss();
    setSaving(true);
    setError(null);
    const { id: replacement, retireFailed } = await replaceSavedMeal(userId, meal.id, {
      name,
      calories: parseFloat(draft.calories) || 0,
      protein: parseFloat(draft.protein) || 0,
      carbs: parseFloat(draft.carbs) || 0,
      fat: parseFloat(draft.fat) || 0,
    });
    if (!replacement) {
      haptics.error();
      setError('Could not save meal changes. Your edits are kept; try again.');
      setSaving(false);
      return;
    }
    await loadYouMeals();
    if (retireFailed) {
      haptics.error();
      Alert.alert('Saved, with one thing left', 'The original is still in saved meals. Delete it there when you’re back online. Past logs are unchanged.');
    } else {
      haptics.success();
    }
    setDone(true);
  };

  return (
    <ScrollView style={{ backgroundColor: c.ground }} contentContainerStyle={{ paddingBottom: 32 }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 16 }}>
        <GlassButton symbol="xmark" accessibilityLabel="Close" onPress={() => router.back()} />
        <View style={{ flex: 1, alignItems: 'center' }}>
          <BlancText variant="headline" accessibilityRole="header">
            Edit saved meal
          </BlancText>
        </View>
        <View style={{ width: 44 }} />
      </View>

      {meal ? (
        <>
          <Label style={{ marginTop: 20 }}>
            <FieldRow label="Name" wide value={draft.name} onChangeText={(name) => setDraft((current) => ({ ...current, name }))} />
          </Label>
          <Label style={{ marginTop: 16 }}>
            {MACROS.map((field, index) => (
              <View key={field.key}>
                {index > 0 ? <Hairline /> : null}
                <FieldRow
                  label={field.label}
                  unit={field.unit}
                  value={draft[field.key]}
                  keyboardType="decimal-pad"
                  selectTextOnFocus
                  maxLength={7}
                  onChangeText={(text) => {
                    setError(null);
                    setDraft((current) => ({ ...current, [field.key]: text }));
                  }}
                />
              </View>
            ))}
          </Label>
          <FormNote alert={Boolean(error)}>{error ?? 'Changes apply to future logs. Past logs stay as they were.'}</FormNote>
          <View style={{ marginHorizontal: 16, marginTop: 22 }}>
            <Capsule title="Save" size="large" fill busy={saving} disabled={!changed} onPress={() => void save()} />
          </View>
        </>
      ) : (
        <BlancText variant="secondary" tone="graphite" style={{ margin: 24 }}>
          This meal is no longer saved.
        </BlancText>
      )}
    </ScrollView>
  );
}
