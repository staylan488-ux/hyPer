import { SymbolView } from 'expo-symbols';
import { useCallback, useRef, useState } from 'react';
import { ActionSheetIOS, Pressable, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { barcodeProviderLabel } from '@/lib/barcodeLookup';
import { ensureFoodRow } from '@/lib/foodPersistence';
import {
  amountError,
  amountForCalories,
  amountForServings,
  amountForUnit,
  equivalentWeightLabel,
  foodBasisLabel,
  foodMacroLine,
  getCompatibleMeasurementUnits,
  servingsForAmount,
  type MeasurementUnit,
} from '@/lib/foodUnits';
import { createMealIngredient } from '@/lib/mealComposition';
import { createPendingEntryId } from '@/lib/pendingEntryId';
import { usualAmountInput } from '@/lib/recentFoods';
import { chosenFoodLogSource } from '@/lib/saveNutritionEntry';
import type { Food } from '@/types';
import { BlancText } from '~/components/BlancText';
import { Capsule } from '~/components/Capsule';
import { FigureInput } from '~/components/FigureInput';
import { FieldRow, FormNote } from '~/components/Form';
import { Label } from '~/components/Label';
import { RollingText } from '~/components/RollingText';
import { Hairline, Row } from '~/components/Row';
import { speak, useLargeText } from '~/lib/accessibility';
import { formatWhole } from '~/lib/format';
import { SAVE_FAILED, saveFoodEntry } from '~/lib/foodLogger';
import { haptics } from '~/lib/haptics';
import { figureLayout } from '~/lib/motion';
import { space, useBlanc } from '~/theme/blanc';

import { useLogger, type ChosenMeta } from './context';
import { spokenMacros } from './FoodLists';
import { ServingHelper } from './ServingHelper';
import { WhenBlock } from './WhenBlock';

/**
 * The chosen food: how much, when, then log it (or add it to the meal). A food
 * from Recent opens at its usual amount, in its own unit when it is weighed or
 * measured (150 g rather than 1.5 servings). The header's back chevron changes the food.
 */
export function FoodReview({ food, meta, servings: usual, onAmountChange, onChangeFood }: {
  food: Food;
  meta: ChosenMeta;
  servings?: number;
  onAmountChange?: (servings: number | null) => void;
  /** An entry being edited: picks another food from the lists in place of this one. */
  onChangeFood?: () => void;
}) {
  const c = useBlanc();
  const logger = useLogger();
  const large = useLargeText();
  const units = getCompatibleMeasurementUnits(food.serving_unit);
  const [initial] = useState(() => (usual ? usualAmountInput(food, usual) : { amount: '1', unit: 'serving' as MeasurementUnit }));
  const [amount, setAmount] = useState(initial.amount);
  const [unit, setUnit] = useState<MeasurementUnit>(initial.unit);
  const [saving, setSaving] = useState(false);
  // an amount typed in the line under Amount must be applied or cleared before logging
  const [helperOpen, setHelperOpen] = useState(false);
  // Clearing Amount to type a new digit keeps Log entry off without flashing red mid-keystroke.
  const [amountBlurred, setAmountBlurred] = useState(false);
  const [editingCalories, setEditingCalories] = useState(false);
  const [calorieDraft, setCalorieDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  // one retry-safe id until this entry's save is confirmed
  const pending = useRef(createPendingEntryId()).current;

  const canTargetCalories = Number.isFinite(food.calories) && food.calories > 0;
  const calorieDraftInvalid = editingCalories && amountForCalories(food, calorieDraft, unit) === null;
  const servings = servingsForAmount(food, amount, unit);
  const invalid = amountError(food, amount, unit);
  const shownInvalid = invalid && (amount.trim() !== '' || amountBlurred) ? invalid : null;
  const kcal = servings === null ? 0 : Math.round(food.calories * servings);
  const protein = servings === null ? 0 : Math.round(food.protein * servings);
  const weightEquivalent = servings !== 1 ? equivalentWeightLabel(food, servings, unit) : null;
  // With one unit there is no choice to offer: the amount says what it counts,
  // in the food's own word when one serving is one of it ("1 scoop").
  const ownUnit = food.serving_unit?.trim();
  const amountUnit =
    units.length > 1
      ? undefined
      : ownUnit && ownUnit.toLowerCase() !== 'serving' && Number(food.serving_size) === 1
        ? ownUnit
        : parseFloat(amount) === 1
          ? 'serving'
          : 'servings';
  const basis = foodBasisLabel(food);

  const handleHelperOpenChange = useCallback((nextOpen: boolean) => {
    if (nextOpen) setEditingCalories(false);
    setHelperOpen(nextOpen);
  }, []);

  const chooseUnit = () => {
    setEditingCalories(false);
    const options = [...units, 'Cancel'];
    ActionSheetIOS.showActionSheetWithOptions({ title: 'Unit', options, cancelButtonIndex: units.length }, (index) => {
      if (index >= units.length) return;
      haptics.select();
      const next = units[index];
      setAmount(amountForUnit(food, amount, unit, next));
      setUnit(next);
    });
  };

  const startCalorieTarget = () => {
    if (!canTargetCalories || saving) return;
    haptics.tap();
    setHelperOpen(false);
    setAmountBlurred(false);
    setCalorieDraft(kcal > 0 ? String(kcal) : '');
    setEditingCalories(true);
  };

  const updateCalorieTarget = (value: string) => {
    setCalorieDraft(value);
    const nextAmount = amountForCalories(food, value, unit);
    if (nextAmount === null) return;
    setAmountBlurred(false);
    setAmount(nextAmount);
    onAmountChange?.(servingsForAmount(food, nextAmount, unit));
  };

  const save = async () => {
    if (servings === null || calorieDraftInvalid || saving) return;
    if (logger.purpose === 'ingredients') {
      try {
        logger.addIngredients([createMealIngredient(food, servings)]);
      } catch (cause) {
        haptics.error();
        setError(cause instanceof Error ? cause.message : 'Could not add ingredient.');
      }
      return;
    }
    setSaving(true);
    setError(null);
    const release = logger.beginSave();
    try {
      const original = logger.editing?.food?.id === food.id ? logger.editing : null;
      const foodId = original ? original.food_id : await ensureFoodRow(food);
      if (!foodId) throw new Error(SAVE_FAILED);
      await saveFoodEntry({
        foodId,
        servings,
        source: original?.source ?? chosenFoodLogSource(food, meta?.provider ?? null),
        when: logger.when,
        groups: logger.groups,
        editingId: logger.editing?.id,
        pending,
      });
      haptics.success();
      logger.complete();
    } catch {
      haptics.error();
      setError(SAVE_FAILED);
    } finally {
      setSaving(false);
      release();
    }
  };

  return (
    <View>
      <View style={{ paddingHorizontal: space.gutter, marginTop: 8 }}>
        <BlancText variant="title" accessibilityRole="header">
          {food.name}
        </BlancText>
        {meta?.source === 'barcode' ? (
          <BlancText variant="footnote" tone="graphite" style={{ marginTop: 4 }}>
            Barcode {meta.barcode} · {barcodeProviderLabel(meta.provider)}
          </BlancText>
        ) : null}
        <BlancText variant="secondary" tone="graphite" style={{ marginTop: 6 }} accessibilityLabel={`${speak(basis[0].toUpperCase() + basis.slice(1))}, ${spokenMacros(food)}`}>
          {basis[0].toUpperCase() + basis.slice(1)} · {foodMacroLine(food)}
        </BlancText>
        {onChangeFood ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Change food"
            accessibilityHint="Picks another food for this entry"
            hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
            onPress={() => {
              haptics.tap();
              onChangeFood();
            }}
            style={({ pressed }) => ({ alignSelf: 'flex-start', minHeight: 36, justifyContent: 'center', marginTop: 4, opacity: pressed ? 0.45 : 1 })}>
            <BlancText variant="bodyStrong" size={15}>
              Change food
            </BlancText>
          </Pressable>
        ) : null}
      </View>

      <View style={{ marginTop: 22 }}>
        <Label>
          <FieldRow
            label="Amount"
            value={amount}
            onChangeText={(value) => {
              setAmount(value);
              onAmountChange?.(servingsForAmount(food, value, unit));
            }}
            keyboardType="decimal-pad"
            selectTextOnFocus
            unit={amountUnit}
            invalid={Boolean(shownInvalid)}
            // Typing the amount by hand clears the line under it, so Log entry is ready.
            onFocus={() => {
              setAmountBlurred(false);
              setHelperOpen(false);
              setEditingCalories(false);
            }}
            onBlur={() => setAmountBlurred(true)}
          />
          {units.length > 1 ? (
            <>
              <Hairline />
              <Row form title="Unit" value={unit} chevron onPress={chooseUnit} />
            </>
          ) : null}
        </Label>
        {shownInvalid ? <FormNote alert>{shownInvalid}</FormNote> : null}
        <ServingHelper
          key={`${food.id}:${food.serving_size}:${food.serving_unit}`}
          food={food}
          disabled={saving}
          open={helperOpen}
          onOpenChange={handleHelperOpenChange}
          onApply={(next) => {
            setAmountBlurred(false);
            setEditingCalories(false);
            const converted = unit !== 'serving' ? amountForServings(food, next, unit) : null;
            if (converted !== null) {
              setAmount(converted);
              onAmountChange?.(servingsForAmount(food, converted, unit));
            } else {
              setUnit('serving');
              setAmount(String(next));
              onAmountChange?.(next);
            }
          }}
        />
      </View>

      <WhenBlock disabled={saving} />

      {/* One fact for VoiceOver: what this entry adds (tappable to work backwards from calories). */}
      {editingCalories ? (
        <View style={{ paddingHorizontal: space.gutter, marginTop: 28 }}>
          <BlancText variant="secondary" tone="graphite">
            Target calories
          </BlancText>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 2, ...(large ? { flexWrap: 'wrap' } : null) }}>
            <FigureInput
              value={calorieDraft}
              fontSize={56}
              autoFocus
              selectTextOnFocus
              keyboardType="decimal-pad"
              maxLength={6}
              placeholder={kcal > 0 ? String(kcal) : '–'}
              accessibilityLabel="Target calories"
              onChangeText={updateCalorieTarget}
              onBlur={() => setEditingCalories(false)}
              onSubmitEditing={() => setEditingCalories(false)}
            />
            <View style={large ? { flexShrink: 1 } : undefined}>
              <BlancText variant="secondary" tone="graphite">
                {protein > 0 ? `kcal · ${formatWhole(protein)} g protein` : 'kcal'}
              </BlancText>
            </View>
          </View>
          {weightEquivalent ? (
            <BlancText variant="footnote" tone="graphite" style={{ marginTop: 2 }} accessibilityLabel={speak(weightEquivalent)}>
              {weightEquivalent}
            </BlancText>
          ) : null}
        </View>
      ) : canTargetCalories ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={speak(
            `This entry · ${formatWhole(kcal)} kcal${protein > 0 ? ` · ${formatWhole(protein)} g protein` : ''}${weightEquivalent ? ` · ${weightEquivalent}` : ''}`,
          )}
          accessibilityHint="Tap to set a target calorie amount"
          disabled={saving}
          onPress={startCalorieTarget}
          style={({ pressed }) => ({ paddingHorizontal: space.gutter, marginTop: 28, minHeight: 44, opacity: pressed ? 0.55 : 1 })}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <BlancText variant="secondary" tone="graphite">
              This entry
            </BlancText>
            <SymbolView name="pencil" size={12} tintColor={c.graphite} />
          </View>
          {/* At the accessibility sizes the words go under the figure when they don't fit beside it. */}
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 2, ...(large ? { flexWrap: 'wrap' } : null) }}>
            <RollingText variant="figure" size={56}>
              {formatWhole(kcal)}
            </RollingText>
            <Animated.View layout={figureLayout} style={large ? { flexShrink: 1 } : undefined}>
              <BlancText variant="secondary" tone="graphite">
                {protein > 0 ? `kcal · ${formatWhole(protein)} g protein` : 'kcal'}
              </BlancText>
            </Animated.View>
          </View>
          {weightEquivalent ? (
            <BlancText variant="footnote" tone="graphite" style={{ marginTop: 2 }}>
              {weightEquivalent}
            </BlancText>
          ) : null}
        </Pressable>
      ) : (
        <View
          accessible
          accessibilityLabel={speak(`This entry · ${formatWhole(kcal)} kcal${protein > 0 ? ` · ${formatWhole(protein)} g protein` : ''}`)}
          style={{ paddingHorizontal: space.gutter, marginTop: 28 }}>
          <BlancText variant="secondary" tone="graphite">
            This entry
          </BlancText>
          {/* At the accessibility sizes the words go under the figure when they don't fit beside it. */}
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 2, ...(large ? { flexWrap: 'wrap' } : null) }}>
            <RollingText variant="figure" size={56}>
              {formatWhole(kcal)}
            </RollingText>
            <Animated.View layout={figureLayout} style={large ? { flexShrink: 1 } : undefined}>
              <BlancText variant="secondary" tone="graphite">
                {protein > 0 ? `kcal · ${formatWhole(protein)} g protein` : 'kcal'}
              </BlancText>
            </Animated.View>
          </View>
        </View>
      )}

      {calorieDraftInvalid && calorieDraft.trim() !== '' ? (
        <FormNote alert>Enter a valid calorie target greater than zero.</FormNote>
      ) : null}
      {error ? <FormNote alert>{error}</FormNote> : null}
      {!error && helperOpen ? <FormNote>Convert and apply the amount typed above, or clear it to log.</FormNote> : null}

      <View style={{ paddingHorizontal: space.inset, marginTop: 20 }}>
        <Capsule
          title={logger.purpose === 'ingredients' ? 'Add ingredient' : logger.editing ? 'Save changes' : 'Log entry'}
          size="large"
          fill
          onPress={() => void save()}
          busy={saving}
          disabled={servings === null || calorieDraftInvalid || helperOpen}
        />
      </View>
    </View>
  );
}
