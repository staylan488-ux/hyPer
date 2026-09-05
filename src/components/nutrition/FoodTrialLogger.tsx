import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ImagePlus, Sparkles, Trash2 } from 'lucide-react';
import { Button, FormField, Input } from '@/components/shared';
import { supabase } from '@/lib/supabase';
import { analyzeFoodTrial, trialFoodTotals, type FoodTrialResult, type TrialFoodItem } from '@/lib/foodTrial';
import { buildClarifiedMealHint, isValidTrialReview } from './foodTrialReview';
import type { PhotoAnalysisImage } from '@/lib/photoAnalysis';

interface FoodTrialLoggerProps {
  whenRow: ReactNode;
  prepareImage: (file: File) => Promise<{ imageBase64: string; mimeType: string }>;
  onSave: (items: TrialFoodItem[], onItemSaved: (item: TrialFoodItem) => void) => Promise<void>;
  initialHint?: string;
  editingEntry?: boolean;
}

const MACROS = ['calories', 'protein', 'carbs', 'fat'] as const;
const formatAmount = (value: number) => Math.round(value * 10) / 10;

export function FoodTrialLogger({ whenRow, prepareImage, onSave, initialHint = '', editingEntry = false }: FoodTrialLoggerProps) {
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
  useEffect(() => { photosRef.current = photos; }, [photos]);
  useEffect(() => () => photosRef.current.forEach((photo) => URL.revokeObjectURL(photo.preview)), []);

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
      await onSave(items, (savedItem) => setItems((current) => current.filter((item) => item !== savedItem)));
    } catch (failure) {
      setError(`${failure instanceof Error ? failure.message : 'Could not save the meal.'} Saved foods are removed; retry the remaining foods.`);
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  };
  const totals = items.reduce((sum, item) => {
    const itemTotals = trialFoodTotals(item);
    return { calories: sum.calories + itemTotals.calories, protein: sum.protein + itemTotals.protein, carbs: sum.carbs + itemTotals.carbs, fat: sum.fat + itemTotals.fat };
  }, { calories: 0, protein: 0, carbs: 0, fat: 0 });
  const changeMeal = () => { setResult(null); setItems([]); setAnswer(''); setClarificationUsed(false); setError(null); };
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
    {photos.length > 0 && <div className="grid grid-cols-2 gap-3">{photos.map((photo, index) => <div key={photo.preview} className="space-y-2">
      <img src={photo.preview} alt={`Meal photo ${index + 1}`} className="w-full h-36 object-cover rounded-xl" />
      <Button variant="ghost" disabled={!!busy} onClick={() => { URL.revokeObjectURL(photo.preview); setPhotos((current) => current.filter((entry) => entry !== photo)); }}>Remove photo {index + 1}</Button>
    </div>)}</div>}
    <Button variant="secondary" className="w-full" disabled={!!busy || photos.length === 2} onClick={() => inputRef.current?.click()}><ImagePlus className="w-4 h-4" />Add photo</Button>
  </>;

  return <div className="space-y-6">
    {!result ? <>
      <FormField label="Your meal">
        <textarea value={hint} onChange={(event) => setHint(event.target.value.slice(0, 1500))} maxLength={1500} disabled={!!busy} rows={3}
          placeholder="e.g., Six Trader Joe’s chicken tikka samosas"
          className="well w-full min-h-24 px-3 py-3 text-[1rem] text-[var(--color-text)] outline-none resize-y placeholder:text-[var(--color-muted)]" />
      </FormField>
      {photoControls}
      <p className="t-caption">Photo, text, or both. Include the amount and any added oil or sauce you know about.</p>
      <Button className="w-full" loading={busy === 'analysis'} disabled={!!busy || (!hint.trim() && !photos.length)} onClick={() => void analyze()}><Sparkles className="w-4 h-4" />Analyze meal</Button>
    </> : (result.clarification || result.items.length === 0) && !saveStarted ? <>
      {clarificationUsed ? <div><p className="t-label">Your meal</p><h3 className="t-heading mt-3">{busy === 'analysis' ? 'Making your estimate…' : 'We couldn’t estimate this meal yet.'}</h3></div> : <>
        <div><p className="t-label">One quick detail</p><h3 className="t-heading mt-3">{result.clarification || 'What is the main food in this meal?'}</h3></div>
        <Input label="Your answer (optional)" value={answer} disabled={!!busy} onChange={(event) => setAnswer(event.target.value)} placeholder="Or let us use an estimate" />
      </>}
      <div className="flex gap-3"><Button variant="secondary" disabled={!!busy} onClick={changeMeal}>Change meal</Button><Button className="flex-1" loading={busy === 'analysis'} disabled={!!busy} onClick={() => void analyze(true)}>{clarificationUsed ? 'Retry estimate' : answer.trim() ? 'Update estimate' : 'Use an estimate'}</Button></div>
    </> : <>
      <div>
        <p className="t-label">Your meal</p>
        <h3 className="t-title mt-3">{formatAmount(totals.calories)} kcal</h3>
        <p className="t-data-sm mt-3">P {formatAmount(totals.protein)} g · C {formatAmount(totals.carbs)} g · F {formatAmount(totals.fat)} g</p>
        {result.summary && <p className="t-caption mt-3">{result.summary}</p>}
      </div>
      {editingEntry && items.length > 1 && <p className="t-caption" role="status">Keep one food to replace this entry. Add other foods separately.</p>}
      {items.map((item, index) => {
        const itemTotals = trialFoodTotals(item);
        return <div key={index} className="space-y-3 border-t border-[var(--color-border)] pt-4">
          <div className="flex items-start justify-between gap-4"><div className="min-w-0"><h4 className="t-heading break-words">{item.name}</h4><p className="t-caption mt-1">{item.quantity} {item.unit} · {item.evidence === 'label' ? 'Label-based' : 'Estimated'}</p></div><span className="t-data-sm shrink-0">{formatAmount(itemTotals.calories)} kcal</span></div>
          <p className="t-data-sm">P {formatAmount(itemTotals.protein)} g · C {formatAmount(itemTotals.carbs)} g · F {formatAmount(itemTotals.fat)} g</p>
          <details>
            <summary className="t-caption cursor-pointer min-h-11 flex items-center">Adjust {item.name}</summary>
            <div className="space-y-4 pt-1 pb-3">
              <Input label="Food name" value={item.name} disabled={!!busy || saveStarted} onChange={(event) => update(index, { name: event.target.value })} />
              <div className="grid grid-cols-2 gap-3"><Input label="Amount eaten" type="number" inputMode="decimal" min="0.01" step="any" value={item.quantity} disabled={!!busy || saveStarted} onChange={(event) => update(index, { quantity: Number(event.target.value), amountConfirmed: true })} /><Input label="Unit" value={item.unit} disabled={!!busy || saveStarted} onChange={(event) => update(index, { unit: event.target.value, amountConfirmed: true })} /></div>
              <p className="t-caption">Nutrition below is per {item.basisQuantity} {item.unit}. Your meal total scales with the amount eaten.</p>
              <Input label={`Nutrition per (${item.unit || 'units'})`} type="number" inputMode="decimal" min="0.01" step="any" value={item.basisQuantity} disabled={!!busy || saveStarted} onChange={(event) => update(index, { basisQuantity: Number(event.target.value) })} />
              <div className="grid grid-cols-2 gap-3">{MACROS.map((key) => <Input key={key} label={key === 'calories' ? 'Calories (kcal)' : `${key[0].toUpperCase()}${key.slice(1)} (g)`} type="number" inputMode="decimal" min="0" step="any" value={item[key]} disabled={!!busy || saveStarted} onChange={(event) => update(index, { [key]: Number(event.target.value) })} />)}</div>
              {item.notes && <p className="t-caption">{item.notes}</p>}
              <Button variant="ghost" disabled={!!busy || saveStarted} onClick={() => setItems((current) => current.filter((_, position) => position !== index))}><Trash2 className="w-4 h-4" />Remove food</Button>
            </div>
          </details>
        </div>;
      })}
      {result.sources.length > 0 && <details className="t-caption"><summary className="min-h-11 flex items-center cursor-pointer">Sources ({result.sources.length})</summary><div className="space-y-3 pb-3">{result.sources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer" className="block underline underline-offset-2 break-words">{source.title}</a>)}</div></details>}
      {whenRow}
      <div className="flex gap-3"><Button variant="secondary" disabled={!!busy || saveStarted} onClick={changeMeal}>Change meal</Button><Button className="flex-1" loading={busy === 'save'} disabled={!!busy || !valid} onClick={() => void save()}>{editingEntry ? 'Save changes' : 'Save meal'}</Button></div>
    </>}
    {error && <p className="t-caption text-[var(--color-accent)]" role="alert">{error}</p>}
  </div>;
}
