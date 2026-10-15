import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown, ImagePlus, Sparkles, Trash2 } from 'lucide-react';
import { Button, FormField, Input } from '@/components/shared';
import { supabase } from '@/lib/supabase';
import { analyzeFoodTrial, trialFoodTotals, type FoodTrialResult, type TrialFoodItem } from '@/lib/foodTrial';
import { buildClarifiedMealHint, isValidTrialReview } from './foodTrialReview';
import type { PhotoAnalysisImage } from '@/lib/photoAnalysis';
import './fuel.css';

export interface FoodTrialDraftState {
  hasDraft: boolean;
  busy: boolean;
}

interface FoodTrialLoggerProps {
  whenRow: ReactNode;
  prepareImage: (file: File) => Promise<{ imageBase64: string; mimeType: string }>;
  onSave: (items: TrialFoodItem[], onItemSaved: (item: TrialFoodItem) => void, saveAsReusableMeal: boolean) => Promise<void>;
  initialHint?: string;
  editingEntry?: boolean;
  addingIngredients?: boolean;
  onAnalysisBusyChange?: (busy: boolean) => void;
  onDraftStateChange?: (state: FoodTrialDraftState) => void;
}

const MACROS = ['calories', 'protein', 'carbs', 'fat'] as const;
const formatAmount = (value: number) => Math.round(value * 10) / 10;

export function FoodTrialLogger({ whenRow, prepareImage, onSave, initialHint = '', editingEntry = false, addingIngredients = false, onAnalysisBusyChange, onDraftStateChange }: FoodTrialLoggerProps) {
  const [hint, setHint] = useState(initialHint);
  const [answer, setAnswer] = useState('');
  const [photos, setPhotos] = useState<{ file: File; preview: string }[]>([]);
  const [clarificationUsed, setClarificationUsed] = useState(false);
  const [result, setResult] = useState<FoodTrialResult | null>(null);
  const [items, setItems] = useState<TrialFoodItem[]>([]);
  const [busy, setBusy] = useState<'analysis' | 'save' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const photosRef = useRef(photos);
  const inputRef = useRef<HTMLInputElement>(null);
  const [saveStarted, setSaveStarted] = useState(false);
  const [saveAsReusableMeal, setSaveAsReusableMeal] = useState(false);
  useEffect(() => { photosRef.current = photos; }, [photos]);
  useEffect(() => () => photosRef.current.forEach((photo) => URL.revokeObjectURL(photo.preview)), []);
  // lets the sheet ask before discarding a running analysis; never left on
  // after this logger unmounts
  const analyzing = busy === 'analysis';
  useEffect(() => {
    onAnalysisBusyChange?.(analyzing);
    return () => onAnalysisBusyChange?.(false);
  }, [analyzing, onAnalysisBusyChange]);
  const hasDraft = !!hint.trim() || photos.length > 0 || result !== null;
  useEffect(() => {
    onDraftStateChange?.({ hasDraft, busy: busy !== null });
  }, [hasDraft, busy, onDraftStateChange]);
  useEffect(() => () => onDraftStateChange?.({ hasDraft: false, busy: false }), [onDraftStateChange]);

  const update = (index: number, patch: Partial<TrialFoodItem>) => {
    setItems((current) => current.map((item, position) => position === index ? { ...item, ...patch } : item));
  };
  const analyze = async (clarify = false) => {
    if (busyRef.current || (!clarify && !hint.trim() && !photos.length)) return;
    busyRef.current = true;
    setBusy('analysis');
    setError(null);
    try {
      const requestHint = clarify ? buildClarifiedMealHint(hint, result?.clarification || result?.summary || '', answer) : hint;
      if (clarify) setClarificationUsed(true);
      const { data } = await supabase.auth.getSession();
      if (!data.session?.access_token) throw new Error('Sign in again to analyze your meal.');
      const images: PhotoAnalysisImage[] = await Promise.all(photos.map(async (photo, index) => ({
        ...await prepareImage(photo.file), angle: index === 0 ? 'top' as const : 'side' as const,
      })));
      const response = await analyzeFoodTrial({ images, hint: requestHint, accessToken: data.session.access_token, ...(clarify ? { clarificationUsed: true } : {}) });
      setAnswer('');
      setResult(response);
      setItems(response.items.map((item) => ({ ...item })));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not analyze the meal.');
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  };
  const valid = !result?.clarification && isValidTrialReview(items, editingEntry);
  const save = async () => {
    if (busyRef.current || !valid) return;
    busyRef.current = true;
    setBusy('save');
    setError(null);
    setSaveStarted(true);
    try {
      await onSave(items, (savedItem) => setItems((current) => current.filter((item) => item !== savedItem)), saveAsReusableMeal);
    } catch (failure) {
      if (addingIngredients) {
        setSaveStarted(false);
        setError(failure instanceof Error ? failure.message : 'Could not add ingredients.');
      } else {
        setError(`${failure instanceof Error ? failure.message : 'Could not save the meal.'} Saved foods are removed; retry the remaining foods.`);
      }
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  };
  const totals = items.reduce((sum, item) => {
    const itemTotals = trialFoodTotals(item);
    return { calories: sum.calories + itemTotals.calories, protein: sum.protein + itemTotals.protein, carbs: sum.carbs + itemTotals.carbs, fat: sum.fat + itemTotals.fat };
  }, { calories: 0, protein: 0, carbs: 0, fat: 0 });
  const changeMeal = () => { setResult(null); setItems([]); setAnswer(''); setClarificationUsed(false); setError(null); setSaveAsReusableMeal(false); };
  const photoControls = <>
    <input ref={inputRef} type="file" accept="image/*" multiple className="hidden" onChange={(event) => {
      const selected = Array.from(event.target.files || []);
      event.target.value = '';
      if (selected.some((file) => !file.type.startsWith('image/') || file.size > 10 * 1024 * 1024)) {
        setError('Choose image files under 10 MB each.'); return;
      }
      if (selected.length + photos.length > 2) { setError('Choose up to two photos.'); return; }
      setError(null);
      setPhotos((current) => [...current, ...selected.map((file) => ({ file, preview: URL.createObjectURL(file) }))]);
    }} />
    {photos.length > 0 && <div className="grid grid-cols-2 gap-3">{photos.map((photo, index) => <div key={photo.preview} className="space-y-1">
      <div className="fuel-photo"><img src={photo.preview} alt={`Meal photo ${index + 1}`} className="h-36" /></div>
      <Button variant="ghost" size="sm" className="-ml-3" disabled={!!busy} onClick={() => { URL.revokeObjectURL(photo.preview); setPhotos((current) => current.filter((entry) => entry !== photo)); }}>Remove photo {index + 1}</Button>
    </div>)}</div>}
    <Button variant="secondary" className="w-full" disabled={!!busy || photos.length === 2} onClick={() => inputRef.current?.click()}><ImagePlus className="w-4 h-4" />Add photo</Button>
  </>;

  return <div className="fuel-stack is-loose">
    {!result ? <>
      <FormField label="Your meal">
        <textarea value={hint} onChange={(event) => setHint(event.target.value.slice(0, 1500))} maxLength={1500} disabled={!!busy} rows={3}
          placeholder="e.g., Six Trader Joe’s chicken tikka samosas"
          className="metal-input w-full min-h-24 px-3.5 py-3 text-[1rem] text-[var(--metal-ink)] resize-y placeholder:text-[var(--metal-ink-3)]" />
      </FormField>
      {photoControls}
      <p className="fuel-note">Photo, text, or both. Include the amount and any added oil or sauce you know about.</p>
      <Button className="w-full" loading={busy === 'analysis'} disabled={!!busy || (!hint.trim() && !photos.length)} onClick={() => void analyze()}><Sparkles className="w-4 h-4" />Analyze meal</Button>
    </> : (result.clarification || result.items.length === 0) && !saveStarted ? <>
      {clarificationUsed ? <div><p className="metal-eyebrow">Your meal</p><h3 className="metal-row-title mt-2">{busy === 'analysis' ? 'Making your estimate…' : 'We couldn’t estimate this meal yet.'}</h3></div> : <>
        <div><p className="metal-eyebrow">One quick detail</p><h3 className="metal-row-title mt-2">{result.clarification || 'What is the main food in this meal?'}</h3></div>
        <Input label="Your answer (optional)" value={answer} disabled={!!busy} onChange={(event) => setAnswer(event.target.value)} placeholder="Or let us use an estimate" />
      </>}
      {photoControls}
      <p className="fuel-note">Add a meal or nutrition label photo. Up to two photos, 10 MB each. Remove a photo to replace it.</p>
      <div className="flex gap-3"><Button variant="secondary" disabled={!!busy} onClick={changeMeal}>Change meal</Button><Button className="flex-1" loading={busy === 'analysis'} disabled={!!busy} onClick={() => void analyze(true)}>{clarificationUsed ? 'Retry estimate' : answer.trim() || photos.length ? 'Update estimate' : 'Use an estimate'}</Button></div>
    </> : <>
      <div>
        <p className="metal-eyebrow">Your meal</p>
        <h3 className="metal-big"><span className="metal-num">{formatAmount(totals.calories)}</span>{' '}<span className="metal-unit">kcal</span></h3>
        <p className="fuel-macro-line">P {formatAmount(totals.protein)} g · C {formatAmount(totals.carbs)} g · F {formatAmount(totals.fat)} g</p>
        {result.summary && <p className="fuel-note mt-3">{result.summary}</p>}
      </div>
      {editingEntry && items.length > 1 && <p className="fuel-note" role="status">Keep one food to replace this entry. Add other foods separately.</p>}
      {items.map((item, index) => {
        const itemTotals = trialFoodTotals(item);
        return <div key={index} className="fuel-ruled pt-3.5">
          <div className="flex items-start justify-between gap-4"><div className="min-w-0"><h4 className="fuel-food-name">{item.name}</h4><p className="fuel-food-detail">{item.quantity} {item.unit} · {item.evidence === 'label' ? 'Label-based' : 'Estimated'}</p></div><span className="fuel-entry-kcal">{formatAmount(itemTotals.calories)}<small>kcal</small></span></div>
          <p className="fuel-food-detail mt-1">P {formatAmount(itemTotals.protein)} g · C {formatAmount(itemTotals.carbs)} g · F {formatAmount(itemTotals.fat)} g</p>
          <details className="fuel-ingredients is-flush">
            <summary>Adjust {item.name}<ChevronDown strokeWidth={1.5} aria-hidden /></summary>
            <div className="space-y-4 pt-1 pb-3">
              <Input label="Food name" value={item.name} disabled={!!busy || saveStarted} onChange={(event) => update(index, { name: event.target.value })} />
              <div className="grid grid-cols-2 gap-3"><Input label="Amount eaten" type="number" inputMode="decimal" min="0.01" step="any" value={item.quantity} disabled={!!busy || saveStarted} onChange={(event) => update(index, { quantity: Number(event.target.value), amountConfirmed: true })} /><Input label="Unit" value={item.unit} disabled={!!busy || saveStarted} onChange={(event) => update(index, { unit: event.target.value, amountConfirmed: true })} /></div>
              <p className="fuel-note">Nutrition below is per {item.basisQuantity} {item.unit}. Your meal total scales with the amount eaten.</p>
              <Input label={`Nutrition per (${item.unit || 'units'})`} type="number" inputMode="decimal" min="0.01" step="any" value={item.basisQuantity} disabled={!!busy || saveStarted} onChange={(event) => update(index, { basisQuantity: Number(event.target.value) })} />
              <div className="grid grid-cols-2 gap-3">{MACROS.map((key) => <Input key={key} label={key === 'calories' ? 'Calories (kcal)' : `${key[0].toUpperCase()}${key.slice(1)} (g)`} type="number" inputMode="decimal" min="0" step="any" value={item[key]} disabled={!!busy || saveStarted} onChange={(event) => update(index, { [key]: Number(event.target.value) })} />)}</div>
              {item.notes && <p className="fuel-note">{item.notes}</p>}
              <Button variant="danger" size="sm" disabled={!!busy || saveStarted} onClick={() => setItems((current) => current.filter((_, position) => position !== index))}><Trash2 className="w-4 h-4" />Remove food</Button>
            </div>
          </details>
        </div>;
      })}
      {result.sources.length > 0 && <details className="fuel-ingredients is-flush fuel-ruled"><summary>Sources ({result.sources.length})<ChevronDown strokeWidth={1.5} aria-hidden /></summary><div className="fuel-note space-y-3 pb-3">{result.sources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer" className="block break-words">{source.title}</a>)}</div></details>}
      {whenRow}
      {!addingIngredients && <label className="fuel-check -my-2">
        <input type="checkbox" checked={saveAsReusableMeal} disabled={!!busy || saveStarted}
          onChange={(event) => setSaveAsReusableMeal(event.target.checked)}
          className="sr-only" />
        <span className="fuel-check-box" aria-hidden>{saveAsReusableMeal && <Check strokeWidth={3} />}</span>
        <span>
          <span className="fuel-check-label">Save as reusable meal</span>
          <span className="fuel-check-detail">{items.length > 1 ? 'Also add these foods to Saved meals for future logging.' : 'Also add this food to Saved meals for future logging.'}</span>
        </span>
      </label>}
      <div className="flex gap-3"><Button variant="secondary" disabled={!!busy || saveStarted} onClick={changeMeal}>Change meal</Button><Button className="flex-1" loading={busy === 'save'} disabled={!!busy || !valid} onClick={() => void save()}>{addingIngredients ? 'Add ingredients' : editingEntry ? 'Save changes' : 'Log meal'}</Button></div>
    </>}
    {error && <p className="fuel-note is-alert" role="alert">{error}</p>}
  </div>;
}
