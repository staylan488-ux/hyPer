import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { interpretFoodServing, servingNeedsAi } from '@/lib/foodTrial';
import type { Food } from '@/types';
import { BlancText } from '~/components/BlancText';
import { Capsule } from '~/components/Capsule';
import { FormNote } from '~/components/Form';
import { Label } from '~/components/Label';
import { Hairline } from '~/components/Row';
import { speak, useAnnounce } from '~/lib/accessibility';
import { askAiConsent } from '~/lib/aiConsent';
import { workerAccessToken } from '~/lib/foodLogger';
import { haptics } from '~/lib/haptics';
import { type as typeScale, useBlanc } from '~/theme/blanc';

import { spokenMacros } from './FoodLists';

type Interpretation = Awaited<ReturnType<typeof interpretFoodServing>>;

const display = (value: number) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(value);

/**
 * "Describe amount": Gemini reads how much was eaten against this food's own
 * serving; the arithmetic stays here.
 */
export function ServingHelper({ food, disabled, open, onApply, onOpenChange }: {
  food: Food;
  disabled: boolean;
  /** Held by the review, which closes it when the amount is typed by hand. */
  open: boolean;
  onApply: (servings: number) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const c = useBlanc();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Interpretation | null>(null);
  const request = useRef(0);
  // match nutrition_logs.servings DECIMAL(10,2)
  const logServings = result?.status === 'resolved' ? Math.round(result.servings * 100) / 100 : 0;
  // Gemini's answer lands a moment after Interpret amount: VoiceOver hears it (errors announce themselves).
  useAnnounce(
    result?.status === 'clarification' ? result.message : result?.status === 'resolved' ? `Reads as ${display(result.servings)} servings` : null,
  );
  useEffect(
    () => () => {
      request.current++;
      onOpenChange(false);
    },
    [onOpenChange],
  );
  if (!Number.isFinite(food.serving_size) || food.serving_size <= 0 || !food.serving_unit.trim()) return null;

  const toggle = (next: boolean) => {
    request.current++;
    setBusy(false);
    setResult(null);
    setError('');
    onOpenChange(next);
  };

  const interpret = async () => {
    // Only an amount the AI must read asks first; "8 oz" never leaves the phone.
    if (servingNeedsAi(food, text) && !(await askAiConsent())) return;
    const current = ++request.current;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const response = await interpretFoodServing(food, text, await workerAccessToken());
      if (current === request.current) setResult(response);
    } catch (cause) {
      if (current === request.current) {
        haptics.error();
        setError(cause instanceof Error ? cause.message : 'Could not interpret this amount. Try again or enter it manually.');
      }
    } finally {
      if (current === request.current) setBusy(false);
    }
  };

  return (
    <View style={{ marginTop: 12 }}>
      <Label>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          disabled={disabled}
          onPress={() => {
            haptics.tap();
            toggle(!open);
          }}
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, paddingHorizontal: 18, backgroundColor: pressed ? c.pressed : 'transparent' })}>
          <SymbolView name="sparkles" size={16} tintColor={c.ink} />
          <BlancText variant="body" style={{ flex: 1 }}>
            {open ? 'Close amount helper' : 'Describe amount'}
          </BlancText>
          <SymbolView name={open ? 'chevron.up' : 'chevron.down'} size={12} weight="semibold" tintColor={c.upcoming} />
        </Pressable>
        {open ? (
          <View>
            <Hairline />
            <View style={{ paddingVertical: 16, paddingHorizontal: 18, gap: 12 }}>
              <BlancText variant="footnote" tone="graphite">
                1 serving = {food.serving_label || `${display(food.serving_size)} ${food.serving_unit}`}. Gemini reads your amount; review it before applying.
              </BlancText>
              <TextInput
                selectionColor={c.ink}
                value={text}
                maxLength={500}
                editable={!disabled}
                onChangeText={(next) => {
                  request.current++;
                  setText(next);
                  setResult(null);
                  setError('');
                  setBusy(false);
                }}
                placeholder="e.g. I ate 6 pieces"
                placeholderTextColor={c.upcoming}
                accessibilityLabel="How much did you eat?"
                returnKeyType="go"
                onSubmitEditing={() => {
                  if (!disabled && !busy && text.trim()) void interpret();
                }}
                lineBreakModeIOS="tail"
                style={[typeScale.field, { color: c.ink, padding: 0, minHeight: 44 }]}
              />
              <Capsule title={busy ? 'Interpreting…' : 'Interpret amount'} variant="quiet" busy={busy} disabled={disabled || !text.trim()} onPress={() => void interpret()} />
              {result?.status === 'clarification' ? (
                <BlancText variant="secondary">{result.message} Update your description, or close the helper to enter servings manually.</BlancText>
              ) : null}
              {result?.status === 'resolved' ? (
                <View style={{ gap: 6 }}>
                  <BlancText
                    variant="secondary"
                    // The bold servings are a nested text, which VoiceOver reads raw.
                    accessibilityLabel={speak(
                      `${display(result.quantity)} ${result.unit === 'piece' && result.quantity !== 1 ? 'pieces' : result.unit} ÷ ${display(result.basisQuantity)} per serving = ${display(result.servings)} servings`,
                    )}>
                    {display(result.quantity)} {result.unit === 'piece' && result.quantity !== 1 ? 'pieces' : result.unit} ÷ {display(result.basisQuantity)} per serving ={' '}
                    <BlancText variant="secondary" weight="600">
                      {display(result.servings)} servings
                    </BlancText>
                  </BlancText>
                  {result.assumption ? (
                    <BlancText variant="footnote" tone="graphite">
                      {result.assumption}
                    </BlancText>
                  ) : null}
                  {Math.abs(logServings - result.servings) > 1e-9 ? (
                    <BlancText variant="footnote" tone="graphite">
                      {logServings > 0 ? `Will log ${display(logServings)} servings, rounded to two decimals.` : 'This amount is too small to log. Enter at least 0.01 servings.'}
                    </BlancText>
                  ) : null}
                  <BlancText
                    variant="meta"
                    tone="graphite"
                    accessibilityLabel={spokenMacros(
                      { calories: food.calories * logServings, protein: food.protein * logServings, carbs: food.carbs * logServings, fat: food.fat * logServings },
                      display,
                    )}>
                    {display(food.calories * logServings)} kcal · P {display(food.protein * logServings)} · C {display(food.carbs * logServings)} · F {display(food.fat * logServings)}
                  </BlancText>
                  <Capsule
                    title="Use this amount"
                    disabled={disabled || logServings <= 0}
                    onPress={() => {
                      onApply(logServings);
                      toggle(false);
                    }}
                  />
                </View>
              ) : null}
            </View>
          </View>
        ) : null}
      </Label>
      {open && error ? <FormNote alert>{error}</FormNote> : null}
    </View>
  );
}
