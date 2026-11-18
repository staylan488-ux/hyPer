import { format } from 'date-fns';
import { useRef, useState } from 'react';
import { ActionSheetIOS, Pressable, TextInput, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { normalizeDecimalText } from '@/lib/decimalText';
import { getMealTotals, mealAmount, rescaleMealIngredients, type MealDraft, type MealIngredient } from '@/lib/mealComposition';
import { resolveMealDestination } from '@/lib/mealDestination';
import { NO_MEAL, nutritionGroupTitle } from '@/lib/nutritionGroups';
import { assertComposedMealOptions, saveComposedMeal } from '@/lib/saveMealComposition';
import { savedMealNamed } from '@/lib/savedMealFromLog';
import type { Food } from '@/types';
import { BlancText } from '~/components/BlancText';
import { Capsule } from '~/components/Capsule';
import { FieldRow, FormNote, PickerRow, ToggleRow, type TextField } from '~/components/Form';
import { Label } from '~/components/Label';
import { HoldMenu, hasHoldMenu, showActionSheet, type MenuAction } from '~/components/HoldMenu';
import { RollingText } from '~/components/RollingText';
import { Hairline, Row } from '~/components/Row';
import { Section } from '~/components/Section';
import { closeOpenSwipeRow, SwipeRow } from '~/components/SwipeRow';
import { speak, spokenUnit, useAnnounce, useLargeText } from '~/lib/accessibility';
import { formatWhole } from '~/lib/format';
import { timeAsDate } from '~/lib/foodLogger';
import { groupsForDay } from '~/lib/fuel';
import { haptics } from '~/lib/haptics';
import { figureLayout, rowEnter, rowExit, rowLayout } from '~/lib/motion';
import { space, type as typeScale, useBlanc } from '~/theme/blanc';

import { useLogger } from './context';

const amount = (value: number) => Number(value.toFixed(3));
/** A macro total to one decimal, as a saved meal's own figures are kept: half of 94.7 g reads 47.4, not 47.35. */
const macro = (value: number) => Number(value.toFixed(1));
const AMOUNT_INVALID = 'Enter an amount greater than zero.';

/**
 * The meal being built: name, ingredients and amounts, when, then log it. With
 * `saveOnly` (logged food saved as a meal) it is kept in Saved, not logged.
 * A meal that already exists (one from Saved or Recent opened to log, or a
 * logged meal being edited) has an Amount, as a food does: "0.5" logs half of
 * it, and every ingredient follows.
 */
export function MealReview({ draft, update, userId, savedTarget, saveOnly = false, editingEntryId, onAddIngredients, onPause, onSaved, storageFailed }: {
  draft: MealDraft;
  update: (patch: Partial<MealDraft>) => void;
  userId: string;
  savedTarget?: Food;
  saveOnly?: boolean;
  editingEntryId?: string;
  onAddIngredients: () => void;
  /** After a failed save of a new meal: back to logging, with the meal kept to resume. */
  onPause: () => void;
  onSaved: () => void;
  storageFailed: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [invalidRows, setInvalidRows] = useState<string[]>([]);
  const totals = getMealTotals(draft.ingredients);
  const groups = groupsForDay(draft.date);
  const group = groups.find((candidate) => candidate.id === draft.groupId) ?? null;
  const frozen = busy || draft.locked;
  // How much of the meal: only where there is a whole meal to take part of.
  const sized = !saveOnly && !savedTarget && (draft.method === 'saved' || Boolean(editingEntryId));
  const [amountText, setAmountText] = useState(() => String(draft.amount ?? 1));
  // Counts the rescales, so each ingredient's field shows its new amount.
  const [rescales, setRescales] = useState(0);
  const typedAmount = mealAmount(Number(normalizeDecimalText(amountText)));
  // Not an amount, or one an ingredient can't follow: the meal stays as it was and Log waits.
  const amountInvalid = sized && typedAmount !== (draft.amount ?? 1);
  useAnnounce(amountInvalid ? AMOUNT_INVALID : null);
  const changeAmount = (text: string) => {
    // A log keeps two decimals, so the field takes no third: what shows is what logs.
    if (/[.,]\d{3,}$/.test(text.trim())) return;
    setAmountText(text);
    const next = mealAmount(Number(normalizeDecimalText(text)));
    if (next === null || next === (draft.amount ?? 1)) return;
    try {
      update({ amount: next, ingredients: rescaleMealIngredients(draft, next) });
    } catch {
      return;
    }
    // every row now shows a valid amount again
    setInvalidRows([]);
    setRescales((count) => count + 1);
  };
  const valid = Boolean(draft.name.trim()) && draft.ingredients.length > 0 && Boolean(draft.time) && invalidRows.length === 0 && !amountInvalid;
  // Saved meals are one per name: a taken name puts this meal in that one's place.
  const { savedMeals, beginSave } = useLogger();
  const replaces = saveOnly ? savedMealNamed(savedMeals, draft.name, draft.entryId) : undefined;

  const save = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError('');
    const release = beginSave();
    try {
      // A draft can outlive its meal group, or be restored on another day:
      // check the group still exists before writing.
      let mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack' | null = null;
      if (!savedTarget && !saveOnly && draft.groupId) {
        const destination = await resolveMealDestination(draft.groupId, userId, draft.date);
        if (!destination.groupId) {
          update({ groupId: null });
          setError('That meal is gone, so this now adds to no meal. Review it and save again.');
          haptics.error();
          return;
        }
        mealType = destination.mealType;
      }
      const options = saveOnly
        ? { saveOnly, editSavedMealId: replaces?.id }
        : { editEntryId: editingEntryId, editSavedMealId: savedTarget?.id, mealType };
      // A save that can never go through must not lock the meal: a locked
      // meal can't be changed or discarded, only saved again.
      assertComposedMealOptions(options);
      const locked = { ...draft, name: draft.name.trim(), locked: true };
      update(locked);
      await saveComposedMeal(locked, userId, options);
      haptics.success();
      onSaved();
    } catch (failure) {
      haptics.error();
      setError(`${failure instanceof Error ? failure.message : 'Could not save the meal.'} Your meal is kept here. Retry to finish saving.`);
    } finally {
      setBusy(false);
      release();
    }
  };

  const chooseGroup = () => {
    const options = [NO_MEAL, ...groups.map((candidate) => nutritionGroupTitle(candidate, groups)), 'Cancel'];
    ActionSheetIOS.showActionSheetWithOptions({ title: 'Add to', options, cancelButtonIndex: options.length - 1 }, (index) => {
      if (index === options.length - 1) return;
      haptics.select();
      update({ groupId: index === 0 ? null : groups[index - 1].id });
    });
  };

  return (
    <View>
      {storageFailed ? <FormNote alert>This device couldn’t keep your latest changes. Keep this sheet open until you log the meal.</FormNote> : null}

      <View style={{ marginTop: 14 }}>
        <Label>
          <FieldRow label="Name" wide grows value={draft.name} maxLength={500} editable={!frozen} placeholder="e.g. Protein shake" onChangeText={(name) => update({ name })} />
          {sized ? (
            <>
              <Hairline />
              <FieldRow
                label="Amount"
                value={amountText}
                onChangeText={changeAmount}
                keyboardType="decimal-pad"
                selectTextOnFocus
                maxLength={7}
                editable={!frozen}
                unit={typedAmount === 1 ? 'meal' : 'meals'}
                invalid={amountInvalid}
              />
            </>
          ) : null}
        </Label>
        {amountInvalid ? <FormNote alert>{AMOUNT_INVALID}</FormNote> : null}
      </View>

      {/* The meal's totals read as one fact. */}
      <View
        accessible
        accessibilityLabel={speak(
          `${formatWhole(totals.calories)} kcal · protein ${macro(totals.protein)} g · carbs ${macro(totals.carbs)} g · fat ${macro(totals.fat)} g`,
        )}
        style={{ paddingHorizontal: space.gutter, marginTop: 22 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
          <RollingText variant="figure" size={56}>
            {formatWhole(totals.calories)}
          </RollingText>
          <Animated.View layout={figureLayout}>
            <BlancText variant="secondary" tone="graphite">
              kcal
            </BlancText>
          </Animated.View>
        </View>
        <BlancText variant="secondary" tone="graphite">
          P {macro(totals.protein)} g · C {macro(totals.carbs)} g · F {macro(totals.fat)} g
        </BlancText>
      </View>

      <Section title="Ingredients" action={frozen ? undefined : { title: 'Add', symbol: 'plus', onPress: onAddIngredients }}>
        <Label style={{ overflow: 'hidden' }} layout={rowLayout}>
          {draft.ingredients.map((item, index) => (
            <Animated.View key={item.id} entering={rowEnter} exiting={rowExit} layout={rowLayout}>
              {index > 0 ? <Hairline /> : null}
              <IngredientRow
                item={item}
                rescales={rescales}
                disabled={frozen}
                onChange={(servings) => update({ ingredients: draft.ingredients.map((part) => (part.id === item.id ? { ...part, servings } : part)) })}
                onInvalid={(invalid) =>
                  setInvalidRows((rows) => (invalid ? [...new Set([...rows, item.id])] : rows.filter((id) => id !== item.id)))
                }
                onRemove={() => {
                  haptics.success();
                  update({ ingredients: draft.ingredients.filter((part) => part.id !== item.id) });
                  setInvalidRows((rows) => rows.filter((id) => id !== item.id));
                }}
              />
            </Animated.View>
          ))}
          {draft.ingredients.length === 0 ? (
            <Animated.View entering={rowEnter} layout={rowLayout}>
              <Row title="No ingredients yet" quiet />
            </Animated.View>
          ) : null}
        </Label>
      </Section>

      {/* Closes up under the ingredients as one is removed. */}
      <Animated.View layout={rowLayout}>
        {saveOnly ? (
          <FormNote>
            {replaces
              ? `Replaces your saved meal “${replaces.name.trim()}”. Past entries stay as they were.`
              : 'Nothing is logged now. Log it any time from Saved.'}
          </FormNote>
        ) : null}
        {!savedTarget && !saveOnly ? (
          <Section title="When">
            <Label>
              <PickerRow
                label="Day"
                mode="date"
                value={new Date(`${draft.date}T12:00:00`)}
                max={new Date()}
                disabled={frozen}
                onChange={(date) => update({ date: format(date, 'yyyy-MM-dd'), groupId: null })}
              />
              <Hairline />
              <PickerRow
                label="Time"
                mode="time"
                value={timeAsDate(new Date(`${draft.date}T12:00:00`), draft.time)}
                disabled={frozen}
                onChange={(date) => update({ time: format(date, 'HH:mm') })}
              />
              <Hairline />
              <Row form title="Add to" value={group ? nutritionGroupTitle(group, groups) : NO_MEAL} chevron={!frozen} onPress={frozen ? undefined : chooseGroup} />
              {/* A meal opened from Saved is saved already; Edit saved meal changes it. */}
              {draft.method === 'saved' ? null : (
                <>
                  <Hairline />
                  <ToggleRow label="Save as reusable meal" value={draft.saveAsReusableMeal} disabled={frozen} onChange={(saveAsReusableMeal) => update({ saveAsReusableMeal })} />
                </>
              )}
            </Label>
          </Section>
        ) : null}

        {error ? <FormNote alert>{error}</FormNote> : null}
        {/* The one thing still missing, so the dimmed button says why. */}
        {!error && !draft.locked && !draft.name.trim() && draft.ingredients.length > 0 ? (
          <FormNote>{`Name the meal to ${saveOnly || savedTarget || editingEntryId ? 'save' : 'log'} it.`}</FormNote>
        ) : null}
        <View style={{ paddingHorizontal: space.inset, marginTop: 20, gap: 12 }}>
          <Capsule
            title={draft.locked ? 'Retry save' : saveOnly ? 'Save meal' : savedTarget || editingEntryId ? 'Save changes' : 'Log meal'}
            size="large"
            fill
            busy={busy}
            disabled={!valid}
            onPress={() => void save()}
          />
          {draft.locked && !busy && !editingEntryId && !savedTarget && !saveOnly ? <Capsule title="Back to food logging" variant="quiet" fill onPress={onPause} /> : null}
        </View>
      </Animated.View>
    </View>
  );
}

function IngredientRow({ item, rescales, disabled, onChange, onInvalid, onRemove }: {
  item: MealIngredient;
  /** Goes up when the meal's Amount rescales every ingredient: the field then shows the new amount. */
  rescales: number;
  disabled: boolean;
  onChange: (servings: number) => void;
  onInvalid: (invalid: boolean) => void;
  onRemove: () => void;
}) {
  const c = useBlanc();
  const large = useLargeText();
  const [value, setValue] = useState(String(amount(item.servings * item.food.serving_size)));
  const [shown, setShown] = useState(rescales);
  if (shown !== rescales) {
    setShown(rescales);
    setValue(String(amount(item.servings * item.food.serving_size)));
  }
  const [blurred, setBlurred] = useState(false);
  const field = useRef<TextField>(null);
  const typed = Number(normalizeDecimalText(value));
  const valid = Number.isFinite(typed) && typed > 0;
  const shownInvalid = !valid && (value.trim() !== '' || blurred);
  useAnnounce(shownInvalid ? AMOUNT_INVALID : null);
  const menu: MenuAction[] = [{ title: 'Remove', symbol: 'trash', destructive: true, removes: true, run: onRemove }];
  // "559 kcal · 31 g protein", without protein that rounds to none.
  const line = `${formatWhole(item.food.calories * item.servings)} kcal${Math.round(item.food.protein * item.servings) > 0 ? ` · ${formatWhole(item.food.protein * item.servings)} g protein` : ''}`;
  // A tap anywhere on the row puts the cursor in its amount; a hold offers Remove.
  const content = (
    <Pressable
      accessible={false}
      disabled={disabled}
      onPress={() => {
        // a tap while another row stands open only closes that row
        if (!closeOpenSwipeRow()) field.current?.focus();
      }}
      onLongPress={
        hasHoldMenu
          ? undefined
          : () => {
              if (closeOpenSwipeRow()) return;
              haptics.select();
              showActionSheet(item.food.name, menu);
            }
      }
      style={{ paddingVertical: 10, paddingLeft: 18, paddingRight: 16 }}>
      {/* At the accessibility sizes the name takes its own line and the amount sits under it. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, ...(large ? { flexWrap: 'wrap' } : null) }}>
        <View
          accessible
          accessibilityLabel={`${item.food.name}, ${speak(line)}`}
          // the row's swipe and hold, as on its amount field
          accessibilityActions={disabled ? undefined : [{ name: 'remove', label: 'Remove' }]}
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === 'remove') onRemove();
          }}
          style={large ? { flexBasis: '100%' } : { flex: 1, minWidth: 0 }}>
          <BlancText variant="bodyStrong" numberOfLines={large ? undefined : 1}>
            {item.food.name}
          </BlancText>
          <BlancText variant="secondary" tone="graphite" style={{ marginTop: 1 }} numberOfLines={large ? undefined : 1}>
            {line}
          </BlancText>
        </View>
        <TextInput
          selectionColor={c.ink}
          ref={field}
          value={value}
          editable={!disabled}
          keyboardType="decimal-pad"
          returnKeyType="done"
          selectTextOnFocus
          accessibilityLabel={`Amount of ${item.food.name}, ${spokenUnit(item.food.serving_unit)}`}
          accessibilityActions={disabled ? undefined : [{ name: 'remove', label: 'Remove' }]}
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === 'remove') onRemove();
          }}
          onFocus={() => setBlurred(false)}
          onBlur={() => setBlurred(true)}
          onChangeText={(next) => {
            setValue(next);
            const servings = Number(normalizeDecimalText(next)) / item.food.serving_size;
            const invalid =
              !Number.isFinite(servings) ||
              servings <= 0 ||
              !Number.isFinite(servings * (item.food.calories + item.food.protein + item.food.carbs + item.food.fat));
            onInvalid(invalid);
            if (!invalid) onChange(servings);
          }}
          lineBreakModeIOS="tail"
          style={[typeScale.field, { color: !shownInvalid ? c.ink : c.live, minWidth: 56, minHeight: 44, textAlign: 'right', padding: 0, fontVariant: ['tabular-nums'] }]}
        />
        {/* The field's name says the unit. */}
        <BlancText
          variant="body"
          tone="graphite"
          numberOfLines={large ? undefined : 1}
          style={large ? undefined : { maxWidth: 64 }}
          accessibilityElementsHidden
          importantForAccessibility="no">
          {item.food.serving_unit}
        </BlancText>
      </View>
      {shownInvalid ? (
        <BlancText variant="footnote" tone="live" style={{ marginTop: 4 }}>
          {AMOUNT_INVALID}
        </BlancText>
      ) : null}
    </Pressable>
  );
  // swipe to remove, like any list on iOS
  return disabled ? content : (
    <SwipeRow name={item.food.name} actions={[{ label: 'Remove', destructive: true, onPress: onRemove }]}>
      <HoldMenu actions={menu} backdrop={c.label}>
        {content}
      </HoldMenu>
    </SwipeRow>
  );
}
