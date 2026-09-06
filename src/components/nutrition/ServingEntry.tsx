import { useEffect, useId, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/shared';
import { supabase } from '@/lib/supabase';
import { interpretFoodServing } from '@/lib/foodTrial';
import { isAppSandboxActive, isPreviewActive } from '@/preview/flag';
import type { Food } from '@/types';
import type { ServingInterpretation } from '../../../supabase/functions/analyze-food-trial/serving';

const display = (value: number) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(value);

export function ServingEntry({ food, disabled, onApply, onReviewChange }: {
  food: Food;
  disabled: boolean;
  onApply: (servings: number) => void;
  onReviewChange: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ServingInterpretation | null>(null);
  const request = useRef(0);
  // Match nutrition_logs.servings DECIMAL(10,2), so review totals survive persistence.
  const logServings = result?.status === 'resolved' ? Math.round(result.servings * 100) / 100 : 0;
  const inputId = useId();
  const panelId = useId();
  useEffect(() => () => { request.current++; onReviewChange(false); }, [onReviewChange]);
  const changeOpen = (next: boolean) => {
    request.current++;
    setBusy(false);
    setOpen(next);
    setResult(null);
    setError('');
    onReviewChange(next);
  };
  const interpret = async () => {
    const current = ++request.current;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (current !== request.current) return;
      if (sessionError) throw new Error('Could not check your session. Try again or enter the amount manually.');
      const response = await interpretFoodServing(food, text, data.session?.access_token ?? '');
      if (current === request.current) setResult(response);
    } catch (cause) {
      if (current === request.current) setError(cause instanceof Error ? cause.message : 'Could not interpret this amount. Try again or enter it manually.');
    } finally {
      if (current === request.current) setBusy(false);
    }
  };
  if (!Number.isFinite(food.serving_size) || food.serving_size <= 0 || !food.serving_unit.trim()) return null;

  return (
    <div className="border-t border-[var(--color-border)] pt-2">
      <Button type="button" variant="ghost" className="px-0" disabled={disabled}
        aria-expanded={open} aria-controls={panelId} onClick={() => changeOpen(!open)}>
        <Sparkles size={15} aria-hidden="true" /> {open ? 'Close amount helper' : 'Describe amount'}
      </Button>
      {open && <div id={panelId} className="space-y-3 pt-2">
        <p className="t-caption">Gemini reads your amount using this food’s serving definition. Review the result before applying it.</p>
        <p className="t-caption">1 serving = {food.serving_label || `${display(food.serving_size)} ${food.serving_unit}`}</p>
        <label htmlFor={inputId} className="t-label-sm block">How much did you eat?</label>
        <textarea id={inputId} value={text} rows={2} maxLength={500} disabled={disabled}
          placeholder="e.g. I ate 6 pieces" className="well w-full p-3 text-[1rem] text-[var(--color-text)]"
          onChange={event => {
            request.current++;
            setText(event.target.value);
            setResult(null);
            setError('');
            setBusy(false);
          }} />
        {isPreviewActive() && !isAppSandboxActive() && <p className="t-caption">Offline preview fixture · no Gemini request.</p>}
        <Button type="button" variant="secondary" onClick={() => void interpret()} loading={busy}
          disabled={disabled || !text.trim()}>{busy ? 'Interpreting…' : 'Interpret amount'}</Button>
        <div aria-live="polite" aria-atomic="true" className="space-y-3">
          {error && <p className="t-caption text-[var(--color-accent)]">{error}</p>}
          {result?.status === 'clarification' && <p className="t-body">{result.message} Update your description, or close the helper to enter servings manually.</p>}
          {result?.status === 'resolved' && <>
            <p className="t-body">{display(result.quantity)} {result.unit === 'piece' && result.quantity !== 1 ? 'pieces' : result.unit} ÷ {display(result.basisQuantity)} per serving = <strong>{display(result.servings)} servings</strong></p>
            {Math.abs(logServings - result.servings) > 1e-9 && <p className="t-caption">{logServings > 0 ? `Will log ${display(logServings)} servings, rounded to two decimals.` : 'This amount is too small to log. Enter at least 0.01 servings.'}</p>}
            <p className="t-caption">{display(food.calories * logServings)} kcal · {display(food.protein * logServings)}g protein · {display(food.carbs * logServings)}g carbs · {display(food.fat * logServings)}g fat</p>
            <Button type="button" disabled={disabled || logServings <= 0} onClick={() => {
              onApply(logServings);
              changeOpen(false);
            }}>Use this amount</Button>
          </>}
        </div>
      </div>}
    </div>
  );
}
