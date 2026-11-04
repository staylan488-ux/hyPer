import { format } from 'date-fns';
import { useRef, useState } from 'react';
import { ActionSheetIOS, Pressable, TextInput, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { normalizeDecimalText } from '@/lib/decimalText';
import { getMealTotals, type MealDraft, type MealIngredient } from '@/lib/mealComposition';
import { resolveMealDestination } from '@/lib/mealDestination';
import { nutritionGroupLabel } from '@/lib/nutritionGroups';
import { assertComposedMealOptions, saveComposedMeal } from '@/lib/saveMealComposition';
import { savedMealNamed } from '@/lib/savedMealFromLog';
import type { Food } from '@/types';
import { BlancText } from '~/components/BlancText';
import { Capsule } from '~/components/Capsule';
import { FieldRow, FormNote, PickerRow, ToggleRow, type TextField } from '~/components/Form';
import { Label } from '~/components/Label';
import { HoldMenu, hasHoldMenu, showActionSheet, type MenuAction } from '~/components/HoldMenu';
import { Hairline, Row } from '~/components/Row';
import { Section } from '~/components/Section';
import { closeOpenSwipeRow, SwipeRow } from '~/components/SwipeRow';
import { speak, spokenUnit, useAnnounce, useLargeText } from '~/lib/accessibility';
import { formatWhole } from '~/lib/format';
import { timeAsDate } from '~/lib/foodLogger';
import { groupsForDay } from '~/lib/fuel';
import { haptics } from '~/lib/haptics';
import { rowEnter, rowExit, rowLayout } from '~/lib/motion';
import { space, type as typeScale, useBlanc } from '~/theme/blanc';

import { useLogger } from './context';

const amount = (value: number) => Number(value.toFixed(3));

/**
 * The meal being built: name, ingredients and amounts, when, then log it. With
 * `saveOnly` (logged food saved as a meal) it is kept in Saved, not logged.
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
  const valid = Boolean(draft.name.trim()) && draft.ingredients.length > 0 && Boolean(draft.time) && invalidRows.length === 0;
  const frozen = busy || draft.locked;
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
          setError('That destination is no longer available. The meal is now Unassigned; review it and save again.');
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
    const options = ['Unassigned', ...groups.map((candidate) => nutritionGroupLabel(candidate, groups)), 'Cancel'];
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
        </Label>
      </View>

      {/* The meal's totals read as one fact. */}
      <View
        accessible
        accessibilityLabel={speak(
          `${formatWhole(totals.calories)} kcal · protein ${amount(totals.protein)} g · carbs ${amount(totals.carbs)} g · fat ${amount(totals.fat)} g`,
        )}
        style={{ paddingHorizontal: space.gutter, marginTop: 22 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
          <BlancText variant="figure" size={56}>
            {formatWhole(totals.calories)}
          </BlancText>
          <BlancText variant="secondary" tone="graphite">
            kcal
          </BlancText>
        </View>
        <BlancText variant="secondary" tone="graphite">
          P {amount(totals.protein)} g · C {amount(totals.carbs)} g · F {amount(totals.fat)} g
        </BlancText>
      </View>

      <Section title="Ingredients" note={String(draft.ingredients.length)} action={frozen ? undefined : { title: 'Add', onPress: onAddIngredients }}>
        <Label style={{ overflow: 'hidden' }} layout={rowLayout}>
          {draft.ingredients.map((item, index) => (
            <Animated.View key={item.id} entering={rowEnter} exiting={rowExit} layout={rowLayout}>
              {index > 0 ? <Hairline /> : null}
              <IngredientRow
                item={item}
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
              <Row title="Add to" value={group ? nutritionGroupLabel(group, groups) : 'Unassigned'} chevron={!frozen} onPress={frozen ? undefined : chooseGroup} />
              <Hairline />
              <ToggleRow label="Save as reusable meal" value={draft.saveAsReusableMeal} disabled={frozen} onChange={(saveAsReusableMeal) => update({ saveAsReusableMeal })} />
            </Label>
          </Section>
        ) : null}

        {error ? <FormNote alert>{error}</FormNote> : null}
        <View style={{ paddingHorizontal: space.gutter, marginTop: 20, gap: 12 }}>
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

function IngredientRow({ item, disabled, onChange, onInvalid, onRemove }: {
  item: MealIngredient;
  disabled: boolean;
  onChange: (servings: number) => void;
  onInvalid: (invalid: boolean) => void;
  onRemove: () => void;
}) {
  const c = useBlanc();
  const large = useLargeText();
  const [value, setValue] = useState(String(amount(item.servings * item.food.serving_size)));
  const field = useRef<TextField>(null);
  const typed = Number(normalizeDecimalText(value));
  const valid = Number.isFinite(typed) && typed > 0;
  useAnnounce(valid ? null : 'Enter an amount greater than zero.');
  const menu: MenuAction[] = [{ title: 'Remove', symbol: 'trash', destructive: true, removes: true, run: onRemove }];
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
      style={{ paddingVertical: 10, paddingLeft: 18, paddingRight: 16, backgroundColor: c.label }}>
      {/* At the accessibility sizes the name takes its own line and the amount sits under it. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, ...(large ? { flexWrap: 'wrap' } : null) }}>
        <View
          accessible
          accessibilityLabel={`${item.food.name}, ${speak(`${Math.round(item.food.calories * item.servings)} kcal · protein ${amount(item.food.protein * item.servings)} g`)}`}
          // the row's swipe and hold, as on its amount field
          accessibilityActions={disabled ? undefined : [{ name: 'remove', label: 'Remove' }]}
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === 'remove') onRemove();
          }}
          style={large ? { flexBasis: '100%' } : { flex: 1, minWidth: 0 }}>
          <BlancText variant="bodyStrong" numberOfLines={large ? undefined : 1}>
            {item.food.name}
          </BlancText>
          <BlancText variant="meta" tone="graphite" style={{ marginTop: 2 }} numberOfLines={large ? undefined : 1}>
            {Math.round(item.food.calories * item.servings)} kcal · P {amount(item.food.protein * item.servings)} g
          </BlancText>
        </View>
        <TextInput
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
          style={[typeScale.field, { color: valid ? c.ink : c.live, minWidth: 56, minHeight: 44, textAlign: 'right', padding: 0, fontVariant: ['tabular-nums'] }]}
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
      {!valid ? (
        <BlancText variant="footnote" tone="live" style={{ marginTop: 4 }}>
          Enter an amount greater than zero.
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
