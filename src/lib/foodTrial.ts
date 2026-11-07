import { isPreviewActive } from '@/preview/flag';
import type { PhotoAnalysisImage } from '@/lib/photoAnalysis';
import type { Food } from '@/types';
import { FOOD_TRIAL_MODEL, trialFoodTotals as itemTotals, validateTrialItems, type FoodTrialResult, type TrialFoodItem as TrialItem } from '../../supabase/functions/analyze-food-trial/model';
export { trialFoodTotals } from '../../supabase/functions/analyze-food-trial/model';
export type { FoodTrialResult, TrialFoodItem, TrialUsage } from '../../supabase/functions/analyze-food-trial/model';

import { createSseReader, parseProgress, type AnalysisProgress } from '../../supabase/functions/analyze-food-trial/progress';
export type { AnalysisProgress } from '../../supabase/functions/analyze-food-trial/progress';

import { getServingOptions, normalizeServingInput, resolveServingInterpretation, resolveServingLocally, type ServingFood, type ServingInterpretation } from '../../supabase/functions/analyze-food-trial/serving';

const MODE_KEY = 'hyper.food-analysis.mode';
export function getFoodAnalysisMode(): 'worker' | 'gemini' {
  const mode = globalThis.localStorage?.getItem(MODE_KEY);
  return mode === 'gemini' || (mode !== 'worker' && import.meta.env.VITE_FOOD_ANALYSIS_MODE === 'gemini') ? 'gemini' : 'worker';
}
export function saveFoodAnalysisMode(mode: 'worker' | 'gemini') {
  globalThis.localStorage?.setItem(MODE_KEY, mode);
}

const endpoint = () => {
  const url = import.meta.env.VITE_SUPABASE_URL;
  if (!url) throw new Error('Hosted food trial is not configured in this build.');
  return `${url.replace(/\/+$/, '')}/functions/v1/analyze-food-trial`;
};

/** The stream of steps closed before the outcome arrived: the analysis may still be running. */
class FollowInterrupted extends Error {}

function outcome(status: number, payload: unknown): Record<string, unknown> {
  const body = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : null;
  if (status < 200 || status > 299) throw new Error(typeof body?.error === 'string' && body.error ? body.error : `Food trial returned ${status}.`);
  if (!body) throw new Error('Food trial returned an invalid response.');
  return body;
}

/**
 * Sends a request. With `onProgress`, the meal analysis is followed: the
 * service answers with its steps as server-sent events and the outcome last.
 * A service without steps (an older one, a replay or a refusal) answers with
 * one JSON reply, read as before.
 */
async function post(body: object, accessToken: string, onProgress?: (step: AnalysisProgress) => void): Promise<Record<string, unknown>> {
  if (!accessToken) throw new Error('Sign in to use the food trial.');
  const response = await fetch(endpoint(), {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(onProgress ? { ...body, progress: true } : body), signal: AbortSignal.timeout(110000),
  });
  if (!onProgress || !response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
    return outcome(response.status, await response.json().catch(() => null));
  }
  let result: { status: number; body: unknown } | null = null;
  const events = createSseReader(data => {
    let event: Record<string, unknown>;
    try { event = JSON.parse(data); } catch { return; }
    if (event?.type === 'result' && Number.isInteger(event.status)) result = { status: event.status as number, body: event.body };
    else if (event?.type === 'progress' && !result) {
      const step = parseProgress(event);
      // The screen only watches: a failure drawing a step never stops the analysis.
      if (step) {
        try { onProgress(step); } catch { /* display only */ }
      }
    }
  });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    events.push(decoder.decode(value, { stream: true }));
  }
  events.push(decoder.decode());
  events.end();
  const settled = result as { status: number; body: unknown } | null;
  if (!settled) throw new FollowInterrupted('The analysis stream ended early.');
  return outcome(settled.status, settled.body);
}

export async function getFoodTrialStatus(accessToken: string): Promise<Record<string, unknown>> {
  if (isPreviewActive()) return { preview: true, maxAttempts: 24, attemptsUsed: 0, message: 'Preview fixture only; no API usage.' };
  return post({ action: 'status' }, accessToken);
}

export const previewFoodTrialResult: FoodTrialResult = {
  provider: 'gemini', model: FOOD_TRIAL_MODEL, modelVersion: null, responseId: null, researchProvider: 'tavily',
  summary: 'Preview fixture only. These are invented test values, not a verified product label or a live Gemini answer.',
  items: [{ name: 'Example samosas (test fixture)', quantity: 6, unit: 'piece', basisQuantity: 3,
    calories: 180, protein: 6, carbs: 24, fat: 7, evidence: 'estimate',
    notes: 'Illustrative 3-piece basis for testing quantity arithmetic. Check your actual package.', sourceIndexes: [], amountConfirmed: false }],
  sources: [], searchSuggestionsHtml: null, originalText: 'Offline preview fixture. No live research or measured usage.',
  usage: { promptTokens: null, outputTokens: null, thinkingTokens: null, cachedTokens: null, toolPromptTokens: null,
    totalTokens: null, searchQueries: null, estimatedTokenUsd: null, searchUsdIfAllowanceExhausted: null,
    priceDate: '', elapsedMs: 0, raw: {} },
};

/**
 * Preview: the steps of a researched meal at about a live pace, so the
 * progress display can be seen without a live service. Sample data, never
 * real research. (The live service sends no thought headings yet, so neither
 * does this.)
 */
const PREVIEW_STEPS: [AnalysisProgress, number][] = [
  [{ step: 'look' }, 2500], [{ step: 'search', products: ['Example samosas'] }, 1200], [{ step: 'compare', pages: 6 }, 1800],
  [{ step: 'read', sites: ['example.com'] }, 1500], [{ step: 'estimate' }, 2500],
];
async function previewSteps(onProgress: (step: AnalysisProgress) => void) {
  for (const [step, wait] of PREVIEW_STEPS) {
    onProgress(step);
    await new Promise(resolve => setTimeout(resolve, wait));
  }
}

export async function analyzeFoodTrial(input: { images: PhotoAnalysisImage[]; hint: string; accessToken: string; clarificationUsed?: boolean; onProgress?: (step: AnalysisProgress) => void }): Promise<FoodTrialResult> {
  const hint = input.hint.trim();
  if (input.images.length > 2 || hint.length > 1500 || (!input.images.length && hint.length < 5)) {
    throw new Error('Add a meal description (5–1,500 characters), or one or two photos.');
  }
  if (isPreviewActive()) {
    if (input.onProgress) await previewSteps(input.onProgress);
    return structuredClone(previewFoodTrialResult);
  }
  try {
    // No patientPost retries. Server computes a durable content hash, so a user retry
    // of identical input can retrieve an outcome but cannot start a second paid call.
    const payload = await post({ images: input.images, hint, ...(input.clarificationUsed ? { clarificationUsed: true } : {}) }, input.accessToken, input.onProgress);
    if (payload.provider !== 'gemini' || payload.model !== FOOD_TRIAL_MODEL) throw new Error('The trial returned an unexpected model. Nothing was saved.');
    if (payload.researchProvider !== 'tavily') throw new Error('The meal research service needs an update. Nothing was saved.');
    const items = validateTrialItems(payload.items);
    if (payload.clarification != null && (typeof payload.clarification !== 'string' || !payload.clarification.trim() || payload.clarification.length > 180 || items.length)) throw new Error('The trial returned invalid clarification details.');
    if (input.clarificationUsed && payload.clarification) throw new Error('We couldn’t make an estimate from these details. Change the meal description and try again.');
    if (!items.length && !payload.clarification) throw new Error('No food could be identified. Change the meal description and try again.');
    if (typeof payload.summary !== 'string' || typeof payload.originalText !== 'string' || !Array.isArray(payload.sources) || !payload.usage) throw new Error('The trial returned incomplete food details.');
    const sourceMap = new Map<number, number>();
    const sources: FoodTrialResult['sources'] = [];
    payload.sources.forEach((source, index) => {
      if (!source || typeof source.title !== 'string' || typeof source.url !== 'string') return;
      try {
        const url = new URL(source.url);
        if (url.protocol === 'https:' && !url.username && !url.password) {
          sourceMap.set(index, sources.length);
          sources.push({ title: source.title, url: url.toString() });
        }
      } catch { /* Invalid provenance is omitted. */ }
    });
    items.forEach((item, index) => {
      const raw = (payload.items as { sourceIndexes?: unknown }[])[index];
      item.sourceIndexes = Array.isArray(raw.sourceIndexes) ? raw.sourceIndexes.flatMap(i => Number.isInteger(i) && sourceMap.has(i) ? [sourceMap.get(i)!] : []) : [];
    });
    return { ...payload, items, sources, searchSuggestionsHtml: null } as unknown as FoodTrialResult;
  } catch (error) {
    if (error instanceof TypeError || error instanceof FollowInterrupted || (error instanceof DOMException && ['AbortError', 'TimeoutError'].includes(error.name))) {
      throw new Error('Connection interrupted. Your analysis may still be running. Retry the same input on the same UTC date to check it without starting another paid analysis.');
    }
    throw error;
  }
}

/** Interpret only the amount. Nutrition and division stay in application code. */
export async function interpretFoodServing(food: ServingFood, text: string, accessToken: string): Promise<ServingInterpretation> {
  const input = normalizeServingInput({ action: 'interpret-serving', food, text });
  // "272 ml", "1.5 cups", "8 oz": plain conversions need no Gemini call.
  const local = resolveServingLocally(input.food, input.text);
  if (local) return local;
  if (isPreviewActive()) {
    // Deliberately narrow offline fixture; never make a live provider call in preview.
    const match = input.text.match(/^(?:I ate )?(\d+(?:\.\d+)?)\s+([a-z]+)\.?$/i);
    const option = match && getServingOptions(food).find(option => option.unit.replace(/s$/, '') === match[2].toLowerCase().replace(/s$/, ''));
    return resolveServingInterpretation(food, option ? { status: 'resolved', quantity: Number(match![1]), optionId: option.id, message: '' }
      : { status: 'clarification', message: 'Preview accepts a number and a defined unit, such as “I ate 6 pieces.”' });
  }
  try {
    const payload = await post(input, accessToken);
    if (payload.provider !== 'gemini' || payload.model !== FOOD_TRIAL_MODEL || !payload.interpretation) {
      throw new Error('Serving interpretation needs a service update. Enter the amount manually.');
    }
    // Recompute against the selected record; never trust a returned multiplier or macros.
    return resolveServingInterpretation(food, payload.interpretation);
  } catch (error) {
    if (error instanceof TypeError || (error instanceof DOMException && ['AbortError', 'TimeoutError'].includes(error.name))) {
      throw new Error('Connection interrupted. Retry the same description to check this attempt, or enter the amount manually.');
    }
    throw error;
  }
}

/**
 * Target suggestions from the hosted Gemini service: the raw numbers and
 * words, which src/lib/nutritionCoach normalizes. Counts toward the same
 * daily request limit as meal analysis; an identical request on the same UTC
 * date replays its answer instead of starting another.
 */
export async function requestHostedTargetSuggestion(goals: string, context: unknown, accessToken: string): Promise<Record<string, unknown>> {
  try {
    const payload = await post({ action: 'suggest-targets', goals, context }, accessToken);
    if (payload.provider !== 'gemini' || payload.model !== FOOD_TRIAL_MODEL || !payload.recommendation || typeof payload.recommendation !== 'object') {
      throw new Error('Target suggestions need a service update. Try again later.');
    }
    return payload.recommendation as Record<string, unknown>;
  } catch (error) {
    if (error instanceof TypeError || (error instanceof DOMException && ['AbortError', 'TimeoutError'].includes(error.name))) {
      throw new Error('Connection interrupted. Ask again with the same goal to check this attempt without starting another.');
    }
    throw error;
  }
}

/** The log source for a Gemini item: label-based or estimated. */
export function trialLogSource(item: TrialItem): 'gemini_label' | 'gemini_estimate' {
  return item.evidence === 'label' ? 'gemini_label' : 'gemini_estimate';
}

/**
 * The foods row a reviewed Gemini item saves as: its eaten amount is one
 * serving, a saved meal when "Save as reusable meal" is on, and its
 * description records the evidence and whether the amount was confirmed.
 */
export function trialItemFood(item: TrialItem, saveAsReusableMeal: boolean, stamp = Date.now()): Food {
  return {
    id: `photo-gemini-${stamp}`,
    user_id: null,
    name: item.name.trim(),
    ...itemTotals(item),
    serving_size: item.quantity,
    serving_unit: item.unit,
    source: saveAsReusableMeal ? 'saved_meal' : 'manual_entry',
    fdc_id: null,
    description: `${item.evidence === 'label' ? 'Label-based nutrition.' : 'Estimated nutrition.'} ${item.amountConfirmed ? 'Amount supplied or adjusted by user.' : 'Estimated amount reviewed when saved.'} ${item.notes}`,
  };
}

/** A reviewed Gemini item as a meal-builder ingredient food. */
export function trialIngredientFood(item: TrialItem, newId: () => string = () => crypto.randomUUID()): Food {
  return {
    id: `photo-${newId()}`,
    user_id: null,
    name: item.name.trim(),
    ...itemTotals(item),
    serving_size: item.quantity,
    serving_unit: item.unit,
    source: 'manual_entry',
    fdc_id: null,
    description: item.notes,
  };
}
