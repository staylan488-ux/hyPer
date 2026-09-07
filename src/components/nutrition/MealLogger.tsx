import { useCallback, useState } from 'react';
import { format, isToday } from 'date-fns';
import { Button, DateField, Input, SelectSheet, TimeField } from '@/components/shared';
import { useAuthStore } from '@/stores/authStore';
import { FoodLogger, type FoodLoggerProps, type FoodCaptureMethod } from './FoodLogger';
import { toLocalTimeInput } from './foodLoggerUtils';
import { clearMealDraft, decodeMealComposition, getMealTotals, loadMealDraft, saveMealDraft, scaleMealIngredients, type MealDraft, type MealIngredient } from '@/lib/mealComposition';
import { saveComposedMeal } from '@/lib/saveMealComposition';
import { resolveMealDestination } from '@/lib/mealDestination';
import { nutritionGroupLabel, sortNutritionGroups } from '@/lib/nutritionGroups';
import type { Food } from '@/types';

const amount = (value: number) => Number(value.toFixed(3));

function IngredientRow({ item, disabled, onChange, onInvalid, onRemove }: {
  item: MealIngredient; disabled: boolean; onChange: (servings: number) => void;
  onInvalid: (invalid: boolean) => void; onRemove: () => void;
}) {
  const [value, setValue] = useState(String(amount(item.servings * item.food.serving_size)));
  const valid = Number.isFinite(Number(value)) && Number(value) > 0;
  return <div className="space-y-3 py-4 border-t border-[var(--color-border)]">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0"><p className="t-heading break-words">{item.food.name}</p><p className="t-caption mt-1">{Math.round(item.food.calories * item.servings)} kcal · P {amount(item.food.protein * item.servings)} g</p></div>
      <Button variant="ghost" disabled={disabled} onClick={onRemove} aria-label={`Remove ${item.food.name}`}>Remove</Button>
    </div>
    <Input label={`Amount (${item.food.serving_unit})`} type="number" inputMode="decimal" min="0.001" step="any" value={value} disabled={disabled}
      onChange={(event) => {
        const next = event.target.value;
        setValue(next);
        const servings = Number(next) / item.food.serving_size;
        const invalid = !Number.isFinite(servings) || servings <= 0 || !Number.isFinite(servings * (item.food.calories + item.food.protein + item.food.carbs + item.food.fat));
        onInvalid(invalid);
        if (!invalid) onChange(servings);
      }} />
    {!valid && <p className="t-caption text-[var(--color-accent)]">Enter an amount greater than zero.</p>}
  </div>;
}

interface MealLoggerProps extends FoodLoggerProps {
  initialSavedMeal?: Food;
  onBusyChange?: (busy: boolean) => void;
  onCancel?: () => void;
}

export function MealLogger(props: MealLoggerProps) {
  const userId = useAuthStore((state) => state.user?.id) || '';
  // Remount on account or entry changes so an account can never inherit another draft.
  return <MealLoggerSession key={`${userId}:${props.initialEntry?.id || props.initialSavedMeal?.id || 'new'}`} {...props} userId={userId} />;
}

function MealLoggerSession({ userId, initialSavedMeal, onBusyChange, onCancel, ...props }: MealLoggerProps & { userId: string }) {
  const { initialEntry, selectedDate, groups = [], onComplete } = props;
  const [savedTarget, setSavedTarget] = useState<Food | undefined>(initialSavedMeal);
  const draftKey = initialEntry ? `edit:${initialEntry.id}` : savedTarget ? `saved:${savedTarget.id}` : 'new';
  const makeDraft = (food?: { name: string; description?: string | null }, servings = 1): MealDraft => ({
    name: food?.name || '', ingredients: food ? scaleMealIngredients(decodeMealComposition(food.description)!.ingredients, servings) : [],
    date: initialEntry?.date || format(selectedDate, 'yyyy-MM-dd'),
    time: toLocalTimeInput(initialEntry?.logged_at || null, isToday(selectedDate) ? new Date() : selectedDate),
    groupId: initialEntry?.group_id || null, method: 'barcode', entryId: crypto.randomUUID(), saveAsReusableMeal: !!initialSavedMeal, locked: false,
  });
  const [draft, setDraft] = useState<MealDraft | null>(() => loadMealDraft(userId, draftKey)
    || (initialSavedMeal ? makeDraft(initialSavedMeal) : decodeMealComposition(initialEntry?.food?.description) ? makeDraft(initialEntry!.food!, initialEntry!.servings) : null));
  const [review, setReview] = useState(!!draft);
  const [paused, setPaused] = useState(false);
  const [captureKey, setCaptureKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [storageFailed, setStorageFailed] = useState(false);
  const [invalidRows, setInvalidRows] = useState<string[]>([]);
  const update = useCallback((patch: Partial<MealDraft>) => {
    setDraft((current) => {
      if (!current) return current;
      const next = { ...current, ...patch };
      setStorageFailed(!saveMealDraft(userId, next, draftKey));
      return next;
    });
  }, [userId, draftKey]);
  const methodChange = useCallback((method: FoodCaptureMethod) => update({ method }), [update]);
  const start = (food?: Food, editSaved = false) => {
    const next = makeDraft(food);
    next.saveAsReusableMeal = editSaved;
    const targetKey = editSaved && food ? `saved:${food.id}` : 'new';
    setSavedTarget(editSaved ? food : undefined);
    const restored = loadMealDraft(userId, targetKey);
    const value = restored || next;
    setDraft(value);
    setStorageFailed(!saveMealDraft(userId, value, targetKey));
    setReview(!!food || !!restored);
  };
  const discard = () => {
    if (busy) return;
    clearMealDraft(userId, draftKey);
    setDraft(null); setSavedTarget(undefined); setReview(false); setInvalidRows([]); setError('');
    if (initialEntry || initialSavedMeal) onCancel?.();
  };
  const addIngredients = (ingredients: MealIngredient[]) => {
    if (!draft) return;
    const nextIngredients = ingredients.flatMap((item) => {
      const composition = decodeMealComposition(item.food.description);
      return composition ? scaleMealIngredients(composition.ingredients, item.servings).map((part) => ({ ...part, id: crypto.randomUUID() })) : [item];
    });
    try {
      getMealTotals([...draft.ingredients, ...nextIngredients]);
      update({ ingredients: [...draft.ingredients, ...nextIngredients] });
      setCaptureKey((key) => key + 1);
      setError('');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not add ingredient.'); throw failure; }
  };
  const save = async () => {
    if (!draft || busy || invalidRows.length) return;
    setBusy(true); onBusyChange?.(true); setError('');
    try {
      // A draft can outlive its destination, or be restored on a different day.
      // Resolve the actual group before writing instead of trusting the current screen's groups.
      let mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack' | null = null;
      if (!savedTarget && draft.groupId) {
        const destination = await resolveMealDestination(draft.groupId, userId, draft.date);
        if (!destination.groupId) {
          update({ groupId: null });
          setError('That destination is no longer available. The meal is now Unassigned; review it and save again.');
          return;
        }
        mealType = destination.mealType;
      }
      const locked = { ...draft, name: draft.name.trim(), locked: true };
      update(locked);
      await saveComposedMeal(locked, userId, {
        editEntryId: initialEntry?.id, editSavedMealId: savedTarget?.id,
        mealType,
      });
      clearMealDraft(userId, draftKey);
      onComplete();
    } catch (failure) {
      setError(`${failure instanceof Error ? failure.message : 'Could not save the meal.'} Your meal is kept here. Retry to finish saving.`);
    } finally { setBusy(false); onBusyChange?.(false); }
  };

  if (!draft || paused) return <div className="space-y-5">
    {paused ? <Button variant="secondary" className="w-full" onClick={() => setPaused(false)}>Resume pending meal</Button> : !initialEntry && <Button variant="secondary" className="w-full" onClick={() => start()}>Build a meal</Button>}
    <FoodLogger {...props} onComposeMeal={paused ? undefined : start} />
  </div>;

  const totals = getMealTotals(draft.ingredients);
  const valid = !!draft.name.trim() && draft.ingredients.length > 0 && !!draft.time && !invalidRows.length;
  const orderedGroups = sortNutritionGroups(groups.filter((group) => group.date === draft.date));
  return <div className="space-y-5">
    <div className="flex items-center justify-between gap-3">
      <span className="t-label">{savedTarget ? 'Edit saved meal' : initialEntry ? 'Edit meal' : 'Build a meal'}</span>
      {!draft.locked && <Button variant="ghost" disabled={busy} onClick={discard}>Discard draft</Button>}
      {draft.locked && !busy && !initialEntry && !savedTarget && <Button variant="ghost" onClick={() => setPaused(true)}>Back to food logging</Button>}
    </div>
    {storageFailed && <p role="alert" className="t-caption text-[var(--color-accent)]">This device couldn’t keep your latest changes. Keep this sheet open until you log the meal.</p>}
    {error && <p role="alert" className="t-caption text-[var(--color-accent)]">{error}</p>}
    {review ? <>
      <Input label="Meal name" placeholder="e.g., Protein shake" value={draft.name} maxLength={500} disabled={busy || draft.locked} onChange={(event) => update({ name: event.target.value })} />
      <div><h3 className="t-title">{Math.round(totals.calories)} kcal</h3><p className="t-data-sm mt-2">P {amount(totals.protein)} g · C {amount(totals.carbs)} g · F {amount(totals.fat)} g</p></div>
      <div>{draft.ingredients.map((item) => <IngredientRow key={item.id} item={item} disabled={busy || draft.locked}
        onChange={(servings) => update({ ingredients: draft.ingredients.map((part) => part.id === item.id ? { ...part, servings } : part) })}
        onInvalid={(invalid) => setInvalidRows((rows) => invalid ? [...new Set([...rows, item.id])] : rows.filter((id) => id !== item.id))}
        onRemove={() => { update({ ingredients: draft.ingredients.filter((part) => part.id !== item.id) }); setInvalidRows((rows) => rows.filter((id) => id !== item.id)); }} />)}</div>
      {!draft.locked && <Button variant="secondary" className="w-full" disabled={busy || !!invalidRows.length} onClick={() => setReview(false)}>Add ingredients</Button>}
      {!savedTarget && <>
        <fieldset disabled={busy || draft.locked} className="grid grid-cols-2 gap-3">
          <DateField value={new Date(`${draft.date}T12:00:00`)} max={new Date()} onChange={(date) => { if (!busy && !draft.locked) update({ date: format(date, 'yyyy-MM-dd'), groupId: null }); }} />
          <TimeField value={draft.time} onChange={(time) => { if (!busy && !draft.locked) update({ time }); }} />
        </fieldset>
        <SelectSheet title="Add to" value={draft.groupId || ''} disabled={busy || draft.locked} onChange={(groupId) => update({ groupId: groupId || null })}
          options={[{ value: '', label: 'Unassigned' }, ...orderedGroups.map((group) => ({ value: group.id, label: nutritionGroupLabel(group, orderedGroups) }))]} />
        <label className="min-h-11 flex items-center gap-3"><input type="checkbox" className="w-[18px] h-[18px] accent-[var(--color-text)]" checked={draft.saveAsReusableMeal} disabled={busy || draft.locked} onChange={(event) => update({ saveAsReusableMeal: event.target.checked })} /><span className="t-label">Save as reusable meal</span></label>
      </>}
      <Button className="w-full" size="lg" disabled={!valid || busy} loading={busy} onClick={() => void save()}>{draft.locked ? 'Retry save' : savedTarget || initialEntry ? 'Save changes' : 'Log meal'}</Button>
    </> : <>
      <FoodLogger key={captureKey} selectedDate={selectedDate} onComplete={() => {}} onAddIngredients={addIngredients} initialMethod={draft.method} onMethodChange={methodChange} />
      <div className="sticky bottom-0 bg-[var(--color-base)] border-t border-[var(--color-border)] pt-3 pb-2 flex items-center gap-3">
        <div className="flex-1"><p className="t-label">{draft.ingredients.length} ingredient{draft.ingredients.length === 1 ? '' : 's'}</p><p className="t-caption mt-1">{Math.round(totals.calories)} kcal</p></div>
        <Button disabled={!draft.ingredients.length} onClick={() => setReview(true)}>Review meal</Button>
      </div>
    </>}
  </div>;
}
