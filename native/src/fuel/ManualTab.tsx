import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import { Keyboard, Pressable, TextInput, View } from 'react-native';

import { describeTargetUnchanged, type ManualFoodFields } from '@/lib/foodLoggerUtils';
import { describeFoodWithAi, type FoodDescriptionResult } from '@/lib/foodDescription';
import { formatMacroInput } from '@/lib/foodUnits';
import { resolveManualFood, type OneOffFood } from '@/lib/manualFood';
import { createMealIngredient } from '@/lib/mealComposition';
import { createPendingEntryId } from '@/lib/pendingEntryId';
import { getPhotoWorkerSettings } from '@/lib/photoAnalysis';
import { providerFallbackNote } from '@/lib/photoReview';
import { createRequestGate } from '@/lib/requestGate';
import { bindFoodToBarcode } from '@/lib/savedBarcodeFoods';
import { foodValuesMatch, replaceSavedMeal, savedMealSuggestions } from '@/lib/savedMeals';
import { getSessionUserId } from '@/lib/sessionUser';
import type { Food } from '@/types';
import { BlancText } from '~/components/BlancText';
import { Capsule } from '~/components/Capsule';
import { FieldRow, FormNote, ToggleRow, type TextField } from '~/components/Form';
import { Label } from '~/components/Label';
import { Hairline } from '~/components/Row';
import { Section } from '~/components/Section';
import { SAVE_FAILED, saveFoodEntry, workerAccessToken } from '~/lib/foodLogger';
import { haptics } from '~/lib/haptics';
import { space, type as typeScale, useBlanc } from '~/theme/blanc';

import { useLogger } from './context';
import { WhenBlock } from './WhenBlock';

export type ManualDraft = {
  fields: ManualFoodFields;
  servings: string;
  selectedSavedMealId: string | null;
  saveAsReusable: boolean;
  /** A missed barcode the new product will be bound to. */
  barcodeBinding: string | null;
};

export const emptyManual: ManualDraft = {
  fields: { name: '', calories: '', protein: '', carbs: '', fat: '' },
  servings: '1',
  selectedSavedMealId: null,
  saveAsReusable: false,
  barcodeBinding: null,
};

export function manualFromFood(food: Pick<Food, 'name' | 'calories' | 'protein' | 'carbs' | 'fat'>): ManualFoodFields {
  return {
    name: food.name,
    calories: formatMacroInput(food.calories),
    protein: formatMacroInput(food.protein),
    carbs: formatMacroInput(food.carbs),
    fat: formatMacroInput(food.fat),
  };
}

const DESCRIBE_LIMIT = 1500;

const valuesOf = (fields: ManualFoodFields) => ({
  name: fields.name.trim(),
  calories: parseFloat(fields.calories) || 0,
  protein: parseFloat(fields.protein) || 0,
  carbs: parseFloat(fields.carbs) || 0,
  fat: parseFloat(fields.fat) || 0,
});

const MACRO_FIELDS = ['calories', 'protein', 'carbs', 'fat'] as const;

/**
 * True when the Manual tab holds typed work that closing the sheet would
 * lose: its fields or servings differ from what the sheet put there, unless
 * they are a saved meal's own values (picked, or just updated).
 */
export function manualHasChanges(draft: ManualDraft, base: ManualDraft, savedMeals: Food[] | null): boolean {
  const sameServings = draft.servings === base.servings;
  if (sameServings && (['name', ...MACRO_FIELDS] as const).every((key) => draft.fields[key] === base.fields[key])) return false;
  const saved = draft.selectedSavedMealId ? savedMeals?.find((meal) => meal.id === draft.selectedSavedMealId) : null;
  return !(saved && sameServings && foodValuesMatch(saved, valuesOf(draft.fields)));
}

/** Manual entry: describe it to the AI, or type the name and macros per serving. */
export function ManualTab({ draft, setDraft, onGeminiHandoff }: {
  draft: ManualDraft;
  setDraft: (update: (draft: ManualDraft) => ManualDraft) => void;
  /** Gemini mode: the description goes to the AI tab instead of filling these fields. */
  onGeminiHandoff?: (description: string) => void;
}) {
  const c = useBlanc();
  const logger = useLogger();
  const [nameFocused, setNameFocused] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mealMessage, setMealMessage] = useState<{ text: string; alert?: boolean } | null>(null);
  const [updatingMeal, setUpdatingMeal] = useState(false);
  const pending = useRef(createPendingEntryId()).current;
  const oneOff = useRef<OneOffFood | null>(null);

  // Describe with AI
  const [describeOpen, setDescribeOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [describing, setDescribing] = useState(false);
  const [describeError, setDescribeError] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<FoodDescriptionResult | null>(null);
  const [pendingFill, setPendingFill] = useState(false);
  const [describeGate] = useState(createRequestGate);
  const target = useRef({ manualFood: draft.fields, selectedSavedMealId: draft.selectedSavedMealId });
  target.current = { manualFood: draft.fields, selectedSavedMealId: draft.selectedSavedMealId };
  useEffect(() => () => describeGate.invalidate(), [describeGate]);
  const { setBusy } = logger;
  useEffect(() => {
    setBusy(describing);
    return () => setBusy(false);
  }, [describing, setBusy]);

  const savedMeals = logger.savedMeals ?? [];
  const selectedSavedMeal = draft.selectedSavedMealId ? savedMeals.find((meal) => meal.id === draft.selectedSavedMealId) ?? null : null;
  const values = valuesOf(draft.fields);
  // Next on the keyboard walks Name and the macros in order.
  const macroFields = useRef<(TextField | null)[]>([]);
  const usingSavedValues = Boolean(selectedSavedMeal && foodValuesMatch(selectedSavedMeal, values));
  const suggestions = nameFocused ? savedMealSuggestions(savedMeals, draft.fields.name) : [];
  const servings = parseFloat(draft.servings);
  const servingsValue = Number.isFinite(servings) && servings > 0 ? servings : 1;

  const setField = (field: keyof ManualFoodFields, value: string) => setDraft((current) => ({ ...current, fields: { ...current.fields, [field]: value } }));

  const applyEstimate = (result: FoodDescriptionResult) => {
    setDraft((current) => ({
      ...current,
      fields: manualFromFood({ name: result.name, calories: result.calories, protein: result.protein_g, carbs: result.carbs_g, fat: result.fat_g }),
      selectedSavedMealId: null,
      saveAsReusable: true,
    }));
    setMealMessage(null);
    setPendingFill(false);
  };

  const describe = async () => {
    if (describing) return;
    const isCurrent = describeGate.begin();
    const before = target.current;
    setDescribing(true);
    setDescribeError(null);
    setPendingFill(false);
    try {
      const settings = getPhotoWorkerSettings();
      const result = await describeFoodWithAi({ description, accessToken: await workerAccessToken(), settings });
      if (!isCurrent()) return;
      const note = providerFallbackNote(settings.provider, result.provider, 'answered');
      setEstimate(note ? { ...result, notes: `${note}${result.notes || ''}`.trim() } : result);
      // fields changed meanwhile wait for "Fill fields" instead of being replaced
      if (describeTargetUnchanged(before, target.current)) applyEstimate(result);
      else setPendingFill(true);
      haptics.success();
    } catch (cause) {
      if (isCurrent()) {
        haptics.error();
        setDescribeError(cause instanceof Error ? cause.message : 'Could not research this food.');
      }
    } finally {
      setDescribing(false);
    }
  };

  const pickSuggestion = (meal: Food) => {
    Keyboard.dismiss();
    describeGate.invalidate();
    setDraft((current) => ({ ...current, fields: manualFromFood(meal), selectedSavedMealId: meal.id, saveAsReusable: false }));
    setNameFocused(false);
    setMealMessage(null);
  };

  const updateSavedMeal = async () => {
    if (!draft.selectedSavedMealId || updatingMeal) return;
    if (!values.name) {
      haptics.error();
      setMealMessage({ text: 'Meal name is required to update.', alert: true });
      return;
    }
    setUpdatingMeal(true);
    setMealMessage(null);
    try {
      const userId = await getSessionUserId();
      if (!userId) {
        haptics.error();
        setMealMessage({ text: 'Please sign in again to update saved meals.', alert: true });
        return;
      }
      const { id, retireFailed } = await replaceSavedMeal(userId, draft.selectedSavedMealId, values);
      if (!id) {
        haptics.error();
        setMealMessage({ text: 'Could not update saved meal. Please try again.', alert: true });
        return;
      }
      if (retireFailed) haptics.error();
      else haptics.success();
      setDraft((current) => ({ ...current, selectedSavedMealId: id, saveAsReusable: false }));
      setMealMessage(
        retireFailed
          ? { text: 'Your edited meal was saved, but the original is still in saved meals. Remove the original when your connection is restored. Past logs are unchanged.', alert: true }
          : { text: 'Saved meal updated for future logs.' },
      );
      await logger.reloadSavedMeals();
    } catch {
      haptics.error();
      setMealMessage({ text: 'Could not update saved meal. Please try again.', alert: true });
    } finally {
      setUpdatingMeal(false);
    }
  };

  const submit = async () => {
    if (!values.name || saving) return;
    if (logger.purpose === 'ingredients') {
      try {
        logger.addIngredients([
          createMealIngredient(
            { id: crypto.randomUUID(), user_id: null, ...values, serving_size: 1, serving_unit: 'serving', source: 'manual_entry', fdc_id: null },
            servingsValue,
          ),
        ]);
      } catch (cause) {
        haptics.error();
        setError(cause instanceof Error ? cause.message : 'Could not add ingredient.');
      }
      return;
    }
    setSaving(true);
    setError(null);
    setMealMessage(null);
    try {
      const userId = await getSessionUserId();
      if (!userId) {
        setError('Please sign in again to log food. Your changes are still here.');
        return;
      }
      const editing = logger.editing;
      const choice = await resolveManualFood({
        userId,
        values,
        selectedSavedMeal,
        saveAsReusable: draft.saveAsReusable,
        savedMeals,
        originalEntry: editing?.food ? { food_id: editing.food_id, food: editing.food } : null,
        cachedOneOff: oneOff.current,
      });
      if (choice.foodId === null) {
        if (choice.error === 'saved_meal') setMealMessage({ text: 'Could not save reusable meal. Please try again.', alert: true });
        else setError(SAVE_FAILED);
        haptics.error();
        return;
      }
      if (choice.oneOff) oneOff.current = choice.oneOff;
      if (choice.createdSavedMeal) {
        setDraft((current) => ({ ...current, selectedSavedMealId: choice.foodId }));
        void logger.reloadSavedMeals();
      }
      const binding = draft.barcodeBinding;
      // the next scan of this code then resolves from the saved catalog
      if (binding && (await bindFoodToBarcode(userId, choice.foodId, binding))) {
        setDraft((current) => ({ ...current, barcodeBinding: null }));
      }
      await saveFoodEntry({
        foodId: choice.foodId,
        servings: servingsValue,
        source: binding ? 'barcode_saved' : editing?.source || 'manual',
        when: logger.when,
        groups: logger.groups,
        editingId: editing?.id,
        pending,
      });
      oneOff.current = null;
      haptics.success();
      logger.complete();
    } catch {
      haptics.error();
      setError(SAVE_FAILED);
    } finally {
      setSaving(false);
    }
  };

  const stepServings = (delta: number) => {
    haptics.select();
    setDraft((current) => {
      const now = parseFloat(current.servings);
      const next = Math.max(0.25, Math.round(((Number.isFinite(now) ? now : 1) + delta) * 100) / 100);
      return { ...current, servings: String(next) };
    });
  };

  return (
    <View>
      {/* Describe with AI */}
      <Section title="Describe with AI">
        <Label>
          {describeOpen ? (
            <View style={{ padding: 16, gap: 12 }}>
              <TextInput
                value={description}
                onChangeText={(text) => setDescription(text.slice(0, DESCRIBE_LIMIT))}
                placeholder="e.g. Chipotle chicken bowl with white rice, black beans and guacamole"
                placeholderTextColor={c.upcoming}
                multiline
                autoFocus
                // Return closes the keyboard; the button below sends it.
                returnKeyType="done"
                submitBehavior="blurAndSubmit"
                accessibilityLabel="Describe the food"
                style={[typeScale.body, { color: c.ink, minHeight: 66, padding: 0 }]}
              />
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <BlancText variant="footnote" tone="graphite">
                  {description.trim().length < 5 ? 'At least 5 characters' : `${description.length} / ${DESCRIBE_LIMIT}`}
                </BlancText>
                <Capsule
                  title={onGeminiHandoff ? 'Review with Gemini' : 'Estimate'}
                  busy={describing}
                  disabled={description.trim().length < 5}
                  onPress={() => (onGeminiHandoff ? onGeminiHandoff(description) : void describe())}
                />
              </View>
            </View>
          ) : (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                haptics.tap();
                setDescribeOpen(true);
              }}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, paddingHorizontal: 18, backgroundColor: pressed ? c.pressed : 'transparent' })}>
              <SymbolView name="sparkles" size={16} tintColor={c.ink} />
              <BlancText variant="body" style={{ flex: 1 }}>
                Describe a meal or food
              </BlancText>
              <SymbolView name="chevron.right" size={13} weight="semibold" tintColor={c.upcoming} />
            </Pressable>
          )}
        </Label>
        {describeError ? <FormNote alert>{describeError}</FormNote> : null}
        {estimate ? (
          <FormNote>
            {estimate.name}: {Math.round(estimate.calories)} kcal · P {Math.round(estimate.protein_g)} · C {Math.round(estimate.carbs_g)} · F {Math.round(estimate.fat_g)}
            {estimate.notes ? `. ${estimate.notes}` : ''}
          </FormNote>
        ) : null}
        {pendingFill && estimate ? (
          <View style={{ paddingHorizontal: space.gutter, marginTop: 10 }}>
            <Capsule title="Fill fields with estimate" variant="quiet" onPress={() => applyEstimate(estimate)} />
          </View>
        ) : null}
      </Section>

      <Section title="Food" note="per serving">
        <Label>
          <FieldRow
            label="Name"
            wide
            value={draft.fields.name}
            onChangeText={(text) => setField('name', text)}
            onFocus={() => setNameFocused(true)}
            onBlur={() => setTimeout(() => setNameFocused(false), 150)}
            placeholder="e.g. Chicken breast"
            autoCapitalize="sentences"
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => macroFields.current[0]?.focus()}
          />
          {suggestions.map((meal) => (
            <View key={meal.id}>
              <Hairline />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Use saved meal ${meal.name}`}
                onPress={() => {
                  haptics.tap();
                  pickSuggestion(meal);
                }}
                style={({ pressed }) => ({ paddingVertical: 10, paddingLeft: 32, paddingRight: 16, backgroundColor: pressed ? c.pressed : 'transparent' })}>
                <BlancText variant="secondary">{meal.name}</BlancText>
                <BlancText variant="meta" tone="graphite">
                  {Math.round(meal.calories)} kcal · P {Math.round(meal.protein)}
                </BlancText>
              </Pressable>
            </View>
          ))}
          {MACRO_FIELDS.map((key, index) => {
            const last = index === MACRO_FIELDS.length - 1;
            return (
              <View key={key}>
                <Hairline />
                <FieldRow
                  ref={(input) => {
                    macroFields.current[index] = input;
                  }}
                  label={key[0].toUpperCase() + key.slice(1)}
                  unit={key === 'calories' ? 'kcal' : 'g'}
                  value={draft.fields[key]}
                  onChangeText={(text) => setField(key, text)}
                  keyboardType="decimal-pad"
                  placeholder="0"
                  returnKeyType={last ? 'done' : 'next'}
                  submitBehavior={last ? 'blurAndSubmit' : 'submit'}
                  onSubmitEditing={last ? undefined : () => macroFields.current[index + 1]?.focus()}
                />
              </View>
            );
          })}
          <Hairline />
          <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingLeft: 18, paddingRight: 10, gap: 6 }}>
            <BlancText variant="body" style={{ flex: 1 }}>
              Servings
            </BlancText>
            <StepButton symbol="minus" label="Fewer servings" disabled={servingsValue <= 0.25} onPress={() => stepServings(-0.25)} />
            <TextInput
              value={draft.servings}
              onChangeText={(text) => setDraft((current) => ({ ...current, servings: text }))}
              keyboardType="decimal-pad"
              returnKeyType="done"
              accessibilityLabel="Servings"
              selectTextOnFocus
              lineBreakModeIOS="tail"
              style={[typeScale.field, { color: c.ink, minWidth: 48, textAlign: 'center', fontVariant: ['tabular-nums'], padding: 0, minHeight: 44 }]}
            />
            <StepButton symbol="plus" label="More servings" onPress={() => stepServings(0.25)} />
          </View>
        </Label>
        {selectedSavedMeal ? <FormNote>{usingSavedValues ? 'Using saved meal values' : 'Editing saved meal values'}</FormNote> : null}
      </Section>

      {logger.purpose === 'log' ? (
        <View style={{ marginTop: 18 }}>
          {selectedSavedMeal && !usingSavedValues ? (
            <View style={{ paddingHorizontal: space.gutter }}>
              <Capsule title="Update saved meal" variant="quiet" busy={updatingMeal} disabled={saving} onPress={() => void updateSavedMeal()} />
            </View>
          ) : !selectedSavedMeal ? (
            <Label>
              <ToggleRow
                label="Save as reusable meal"
                detail={draft.barcodeBinding ? `Bound to barcode ${draft.barcodeBinding}` : undefined}
                value={draft.saveAsReusable}
                onChange={(saveAsReusable) => setDraft((current) => ({ ...current, saveAsReusable }))}
              />
            </Label>
          ) : null}
          {mealMessage ? <FormNote alert={mealMessage.alert}>{mealMessage.text}</FormNote> : null}
        </View>
      ) : null}

      <WhenBlock disabled={saving} />

      {error ? <FormNote alert>{error}</FormNote> : null}
      <View style={{ paddingHorizontal: space.gutter, marginTop: 20 }}>
        <Capsule
          title={logger.purpose === 'ingredients' ? 'Add ingredient' : logger.editing ? 'Save changes' : 'Log entry'}
          size="large"
          fill
          busy={saving}
          disabled={!values.name || updatingMeal}
          onPress={() => void submit()}
        />
      </View>
    </View>
  );
}

function StepButton({ symbol, label, onPress, disabled }: { symbol: 'plus' | 'minus'; label: string; onPress: () => void; disabled?: boolean }) {
  const c = useBlanc();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.35 : pressed ? 0.5 : 1,
      })}>
      <View style={{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: c.fill }}>
        <SymbolView name={symbol} size={13} weight="bold" tintColor={c.ink} />
      </View>
    </Pressable>
  );
}

