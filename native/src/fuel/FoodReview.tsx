import { useRef, useState } from 'react';
import { ActionSheetIOS, View } from 'react-native';

import { barcodeProviderLabel } from '@/lib/barcodeLookup';
import { ensureFoodRow } from '@/lib/foodPersistence';
import {
  amountError,
  amountForUnit,
  foodBasisLabel,
  foodMacroLine,
  getCompatibleMeasurementUnits,
  servingsForAmount,
  type MeasurementUnit,
} from '@/lib/foodUnits';
import { createMealIngredient } from '@/lib/mealComposition';
import { createPendingEntryId } from '@/lib/pendingEntryId';
import { chosenFoodLogSource } from '@/lib/saveNutritionEntry';
import type { Food } from '@/types';
import { BlancText } from '~/components/BlancText';
import { Capsule } from '~/components/Capsule';
import { FieldRow, FormNote } from '~/components/Form';
import { Label } from '~/components/Label';
import { Hairline, Row } from '~/components/Row';
import { formatWhole } from '~/lib/format';
import { SAVE_FAILED, saveFoodEntry } from '~/lib/foodLogger';
import { haptics } from '~/lib/haptics';
import { space } from '~/theme/blanc';

import { useLogger, type ChosenMeta } from './context';
import { ServingHelper } from './ServingHelper';
import { WhenBlock } from './WhenBlock';

/** The chosen food: how much, when, then log it (or add it to the meal). */
export function FoodReview({ food, meta, onBack }: { food: Food; meta: ChosenMeta; onBack: () => void }) {
  const logger = useLogger();
  const [amount, setAmount] = useState('1');
  const [unit, setUnit] = useState<MeasurementUnit>('serving');
  const [saving, setSaving] = useState(false);
  // the amount helper's answer must be applied or closed before logging
  const [helperOpen, setHelperOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // one retry-safe id until this entry's save is confirmed
  const pending = useRef(createPendingEntryId()).current;

  const servings = servingsForAmount(food, amount, unit);
  const invalid = amountError(food, amount, unit);
  const units = getCompatibleMeasurementUnits(food.serving_unit);
  const kcal = servings === null ? 0 : Math.round(food.calories * servings);
  const protein = servings === null ? 0 : Math.round(food.protein * servings);

  const chooseUnit = () => {
    const options = [...units, 'Cancel'];
    ActionSheetIOS.showActionSheetWithOptions({ title: 'Unit', options, cancelButtonIndex: units.length }, (index) => {
      if (index >= units.length) return;
      haptics.select();
      const next = units[index];
      setAmount(amountForUnit(food, amount, unit, next));
      setUnit(next);
    });
  };

  const save = async () => {
    if (servings === null || saving) return;
    if (logger.purpose === 'ingredients') {
      try {
        logger.addIngredients([createMealIngredient(food, servings)]);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not add ingredient.');
      }
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const foodId = await ensureFoodRow(food);
      if (!foodId) throw new Error(SAVE_FAILED);
      await saveFoodEntry({
        foodId,
        servings,
        source: chosenFoodLogSource(food, meta?.provider ?? null),
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
    }
  };

  return (
    <View>
      <View style={{ paddingHorizontal: space.gutter, marginTop: 8 }}>
        <BlancText variant="title">{food.name}</BlancText>
        {meta?.source === 'barcode' ? (
          <BlancText variant="footnote" tone="graphite" style={{ marginTop: 4 }}>
            Barcode {meta.barcode} · {barcodeProviderLabel(meta.provider)}
          </BlancText>
        ) : null}
        <BlancText variant="secondary" tone="graphite" style={{ marginTop: 6 }}>
          {foodMacroLine(food)} {foodBasisLabel(food)}
        </BlancText>
      </View>

      <View style={{ marginTop: 22 }}>
        <Label>
          <FieldRow
            label="Amount"
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
            selectTextOnFocus
            invalid={Boolean(invalid)}
          />
          <Hairline />
          <Row title="Unit" value={unit} chevron onPress={units.length > 1 ? chooseUnit : undefined} />
        </Label>
        {invalid ? <FormNote alert>{invalid}</FormNote> : null}
        <ServingHelper
          key={`${food.id}:${food.serving_size}:${food.serving_unit}`}
          food={food}
          disabled={saving}
          onOpenChange={setHelperOpen}
          onApply={(next) => {
            setUnit('serving');
            setAmount(String(next));
          }}
        />
      </View>

      <WhenBlock disabled={saving} />

      <View style={{ paddingHorizontal: space.gutter, marginTop: 28 }}>
        <BlancText variant="secondary" tone="graphite">
          This entry
        </BlancText>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 2 }}>
          <BlancText variant="figure" size={44}>
            {formatWhole(kcal)}
          </BlancText>
          <BlancText variant="secondary" tone="graphite">
            kcal · {formatWhole(protein)} g protein
          </BlancText>
        </View>
      </View>

      {error ? <FormNote alert>{error}</FormNote> : null}

      <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: space.gutter, marginTop: 20 }}>
        <Capsule title="Change food" variant="quiet" onPress={onBack} disabled={saving} />
        <Capsule
          title={logger.purpose === 'ingredients' ? 'Add ingredient' : logger.editing ? 'Save changes' : 'Log entry'}
          onPress={() => void save()}
          busy={saving}
          disabled={servings === null || helperOpen}
          style={{ flex: 1, alignSelf: 'stretch' }}
        />
      </View>
    </View>
  );
}

