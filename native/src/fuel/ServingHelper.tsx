import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native';

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
 * The line under Amount where an amount can be typed in any unit ("250 g",
 * "200 ml", "1.5 cups"). Plain amounts are worked out on the phone from this
 * food's own serving; anything else ("6 pieces") is read by Gemini, and the
 * arithmetic still stays here.
 */
export function ServingHelper({ food, disabled, open, onApply, onOpenChange }: {
  food: Food;
  disabled: boolean;
  /**
   * True while typed text waits to be applied (Log entry waits too). The
   * review sets it false when Amount is typed by hand, which clears the line.
   */
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
  // The answer lands after return (a moment later from Gemini): VoiceOver hears it (errors announce themselves).
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
  // Set aside by the review (Amount typed by hand): drop what was typed here.
  useEffect(() => {
    if (open) return;
    request.current++;
    setText('');
    setResult(null);
    setError('');
    setBusy(false);
  }, [open]);
  if (!Number.isFinite(food.serving_size) || food.serving_size <= 0 || !food.serving_unit.trim()) return null;


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
    <View>
      <Label>
        <Hairline />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, paddingHorizontal: 18 }}>
          <SymbolView name="scalemass" size={16} tintColor={text ? c.ink : c.upcoming} />
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
              onOpenChange(Boolean(next.trim()));
            }}
            placeholder="Or type 250 g, 200 ml, 12 oz"
            placeholderTextColor={c.upcoming}
            accessibilityLabel="Or type an amount, like 250 g or 200 ml"
            accessibilityHint="Works it out in servings"
            autoCorrect={false}
            returnKeyType="go"
            onSubmitEditing={() => {
              if (!disabled && !busy && text.trim()) void interpret();
            }}
            lineBreakModeIOS="tail"
            style={[typeScale.field, { flex: 1, color: c.ink, padding: 0, minHeight: 44 }]}
          />
          {busy ? <ActivityIndicator color={c.graphite} /> : null}
          {!busy && !result && text.trim() ? (
            <Pressable
              accessibilityRole="button"
              disabled={disabled}
              hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
              onPress={() => {
                haptics.tap();
                void interpret();
              }}
              style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', opacity: pressed ? 0.45 : 1 })}>
              <BlancText variant="bodyStrong" size={15}>
                Convert
              </BlancText>
            </Pressable>
          ) : null}
        </View>
        {result ? (
          <View style={{ paddingBottom: 16, paddingHorizontal: 18, gap: 12 }}>
            {result.status === 'clarification' ? (
              <BlancText variant="secondary">{result.message} Change what you typed, or enter servings above.</BlancText>
            ) : null}
            {result.status === 'resolved' ? (
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
                    onOpenChange(false);
                  }}
                />
              </View>
            ) : null}
          </View>
        ) : null}
      </Label>
      {error ? <FormNote alert>{error}</FormNote> : null}
    </View>
  );
}
