import { isAppSandboxActive, isPreviewActive } from '@/preview/flag';
import type { PhotoAnalysisImage } from '@/lib/photoAnalysis';
import { FOOD_TRIAL_MODEL, validateTrialItems, type FoodTrialResult } from '../../supabase/functions/analyze-food-trial/model';
export { trialFoodTotals } from '../../supabase/functions/analyze-food-trial/model';
export type { FoodTrialResult, TrialFoodItem, TrialUsage } from '../../supabase/functions/analyze-food-trial/model';

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

async function post(body: unknown, accessToken: string): Promise<Record<string, unknown>> {
  if (!accessToken) throw new Error('Sign in to use the food trial.');
  const response = await fetch(endpoint(), {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(110000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error || `Food trial returned ${response.status}.`);
  if (!payload || typeof payload !== 'object') throw new Error('Food trial returned an invalid response.');
  return payload;
}

export async function getFoodTrialStatus(accessToken: string): Promise<Record<string, unknown>> {
  if (isPreviewActive() && !isAppSandboxActive()) return { preview: true, maxAttempts: 24, attemptsUsed: 0, message: 'Preview fixture only; no API usage.' };
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

export async function analyzeFoodTrial(input: { images: PhotoAnalysisImage[]; hint: string; accessToken: string; clarificationUsed?: boolean }): Promise<FoodTrialResult> {
  const hint = input.hint.trim();
  if (input.images.length > 2 || hint.length > 1500 || (!input.images.length && hint.length < 5)) {
    throw new Error('Add a meal description (5–1,500 characters), or one or two photos.');
  }
  if (isPreviewActive() && !isAppSandboxActive()) return structuredClone(previewFoodTrialResult);
  try {
    // No patientPost retries. Server computes a durable content hash, so a user retry
    // of identical input can retrieve an outcome but cannot start a second paid call.
    const payload = await post({ images: input.images, hint, ...(input.clarificationUsed ? { clarificationUsed: true } : {}) }, input.accessToken);
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
    if (error instanceof TypeError || (error instanceof DOMException && ['AbortError', 'TimeoutError'].includes(error.name))) {
      throw new Error('Connection interrupted. Your analysis may still be running. Retry the same input on the same UTC date to check it without starting another paid analysis.');
    }
    throw error;
  }
}
