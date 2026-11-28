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

/** Must stay in lockstep with ANALYSIS_VERSION in supabase/functions/analyze-food-trial/gateway.ts. */
export const FOOD_ANALYSIS_VERSION = 'gemini-tavily-v3';

/** A refusal from the service, with its code ("daily_quota_exhausted", ...) when it sent one. */
export class FoodAnalysisRefusal extends Error {
  readonly code: string | null;
  readonly status: number;
  readonly requestId: string | null;
  constructor(message: string, code: string | null, status: number, requestId: string | null = null) {
    super(message);
    this.name = 'FoodAnalysisRefusal';
    this.code = code;
    this.status = status;
    this.requestId = requestId;
  }
}

/**
 * Why the AI can't take a request today, if that's the reason: this account's
 * daily requests are used up, the day's budget for everyone is, or the owner
 * switched food analysis off. Anything else is null (an ordinary failure).
 */
export function aiLimitOf(error: unknown): 'daily' | 'everyone' | 'paused' | null {
  if (!(error instanceof FoodAnalysisRefusal)) return null;
  if (error.code === 'daily_quota_exhausted') return 'daily';
  if (error.code === 'global_quota_exhausted') return 'everyone';
  if (error.code === 'analysis_paused') return 'paused';
  return null;
}

/** The stream of steps closed before the outcome arrived: the analysis may still be running. */
class FollowInterrupted extends Error {}

const INTERRUPTED_MESSAGE = 'Connection interrupted. Your analysis may still be running. Retry the same input on the same UTC date to check it without starting another paid analysis.';

function isTransientNetworkError(error: unknown): boolean {
  return error instanceof TypeError
    || error instanceof FollowInterrupted
    || (error instanceof DOMException && ['AbortError', 'TimeoutError'].includes(error.name));
}

function abortError(): DOMException {
  return new DOMException('Request aborted', 'AbortError');
}

function raceAbort(timeoutMs: number, caller?: AbortSignal): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const onCallerAbort = () => controller.abort(caller?.reason ?? abortError());
  if (caller?.aborted) {
    onCallerAbort();
    return { signal: controller.signal, cleanup: () => {} };
  }
  caller?.addEventListener('abort', onCallerAbort, { once: true });
  const timer = setTimeout(() => {
    controller.abort(new DOMException(`Request timed out after ${timeoutMs / 1000} s`, 'TimeoutError'));
  }, timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      caller?.removeEventListener('abort', onCallerAbort);
    },
  };
}

function sleepAbortable(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason ?? abortError());
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function utcDateKey(atMs = Date.now()): string {
  return new Date(atMs).toISOString().slice(0, 10);
}

/**
 * Computes the same deterministic SHA-256 request ID that analyze-food-trial's
 * gateway computes for a meal, so a client whose stream was interrupted (for
 * example after switching apps) can poll the read-only status endpoint without
 * ever starting a second paid analysis.
 */
export async function mealRequestId(input: {
  images: PhotoAnalysisImage[];
  hint: string;
  clarificationUsed?: boolean;
}): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle || typeof subtle.digest !== 'function') return null;
  const hint = input.hint.trim().normalize('NFC');
  const images = input.images
    .map(({ angle, imageBase64, mimeType }) => ({ angle, imageBase64: imageBase64.replace(/\s+/g, ''), mimeType }))
    .sort((a, b) => a.angle.localeCompare(b.angle) || a.imageBase64.localeCompare(b.imageBase64));
  const clarificationUsed = input.clarificationUsed === true || /(?:^|\n)Answer:/i.test(hint);
  const canonical = JSON.stringify({ version: FOOD_ANALYSIS_VERSION, input: { images, hint, clarificationUsed } });
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function outcome(status: number, payload: unknown): Record<string, unknown> {
  const body = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : null;
  // The service's own words when it gives some; otherwise plain ones (no
  // internal names or bare status codes on the person's screen).
  if (status < 200 || status > 299) {
    const code = typeof body?.code === 'string' ? body.code : null;
    const requestId = typeof body?.requestId === 'string' ? body.requestId : null;
    if (typeof body?.error === 'string' && body.error) throw new FoodAnalysisRefusal(body.error, code, status, requestId);
    throw new FoodAnalysisRefusal(status >= 500 ? 'Food analysis isn’t available right now. Try again in a moment.' : `Couldn’t analyze this meal (error ${status}). Try again.`, code, status, requestId);
  }
  if (!body) throw new Error('Food analysis sent back an answer it couldn’t read. Try again.');
  return body;
}

/**
 * Sends a request. With `onProgress`, the meal analysis is followed: the
 * service answers with its steps as server-sent events and the outcome last.
 * A service without steps (an older one, a replay or a refusal) answers with
 * one JSON reply, read as before. The steps are read with TextDecoder; a
 * runtime without one asks for the one reply instead, so the analysis still
 * runs, without its steps.
 */
async function post(
  body: object,
  accessToken: string,
  follow?: (step: AnalysisProgress) => void,
  options?: { signal?: AbortSignal; timeoutMs?: number; onStreamStart?: () => void },
): Promise<Record<string, unknown>> {
  if (!accessToken) throw new Error('Sign in to use the food trial.');
  const onProgress = typeof TextDecoder === 'function' ? follow : undefined;
  const timeoutMs = options?.timeoutMs ?? 110_000;
  const { signal, cleanup } = options?.signal
    ? raceAbort(timeoutMs, options.signal)
    : { signal: AbortSignal.timeout(timeoutMs), cleanup: () => {} };
  try {
    const response = await fetch(endpoint(), {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(onProgress ? { ...body, progress: true } : body),
      signal,
    });
    if (!onProgress || !response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
      return outcome(response.status, await response.json().catch(() => null));
    }
    options?.onStreamStart?.();
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
  } finally {
    cleanup();
  }
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
async function previewSteps(onProgress: (step: AnalysisProgress) => void, signal?: AbortSignal) {
  for (const [step, wait] of PREVIEW_STEPS) {
    if (signal?.aborted) throw signal.reason ?? abortError();
    onProgress(step);
    await sleepAbortable(wait, signal);
  }
}

function parseFoodTrialPayload(payload: Record<string, unknown>, clarificationUsed?: boolean): FoodTrialResult {
  if (payload.provider !== 'gemini' || payload.model !== FOOD_TRIAL_MODEL) throw new Error('The trial returned an unexpected model. Nothing was saved.');
  if (payload.researchProvider !== 'tavily') throw new Error('The meal research service needs an update. Nothing was saved.');
  const items = validateTrialItems(payload.items);
  if (payload.clarification != null && (typeof payload.clarification !== 'string' || !payload.clarification.trim() || payload.clarification.length > 180 || items.length)) throw new Error('The trial returned invalid clarification details.');
  if (clarificationUsed && payload.clarification) throw new Error('We couldn’t make an estimate from these details. Change the meal description and try again.');
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
}

export type FoodTrialStatusCheck =
  | { status: 'done'; result: FoodTrialResult }
  | { status: 'pending'; requestId: string }
  | { status: 'not_found' };

/**
 * Read-only lookup for an analysis that was already sent. Never claims a quota
 * slot or starts a paid call: returns the saved result if finished, `pending`
 * if the server is still working, or `not_found` if no claim exists yet.
 */
export async function checkFoodTrialResult(
  requestId: string,
  accessToken: string,
  options?: { clarificationUsed?: boolean; signal?: AbortSignal },
): Promise<FoodTrialStatusCheck> {
  try {
    const payload = await post({ action: 'status', requestId }, accessToken, undefined, { signal: options?.signal, timeoutMs: 15_000 });
    return { status: 'done', result: parseFoodTrialPayload(payload, options?.clarificationUsed) };
  } catch (error) {
    if (error instanceof FoodAnalysisRefusal) {
      if (error.status === 409 && error.code === 'analysis_pending') {
        return { status: 'pending', requestId: error.requestId ?? requestId };
      }
      if (error.status === 404 && error.code === 'analysis_not_found') {
        return { status: 'not_found' };
      }
    }
    throw error;
  }
}

/**
 * Recovery hooks used by the iOS app so switching away mid-analysis never drops
 * a running server job: if the stream breaks after the app goes to the
 * background or iOS suspends it, the client waits until it can talk again and
 * collects the saved answer from the read-only status endpoint.
 */
export interface FoodTrialRecovery {
  getAccessToken: () => Promise<string>;
  /** True once the app is backgrounded and iOS's background grace period has ended. */
  isBackgroundSuspended: () => boolean;
  /** Resolves once the app returns to the foreground (or immediately if visible). */
  waitForForeground: (signal?: AbortSignal) => Promise<void>;
  /** True if the app left the foreground at any point during this analysis. */
  wasBackgrounded?: () => boolean;
  pollIntervalMs?: number;
  notFoundDelayMs?: number;
  retryDelayMs?: number;
  /** Maximum elapsed time to keep polling while the server stays `pending`. */
  maxPendingMs?: number;
}

export async function analyzeFoodTrial(input: {
  images: PhotoAnalysisImage[];
  hint: string;
  accessToken: string;
  clarificationUsed?: boolean;
  onProgress?: (step: AnalysisProgress) => void;
  signal?: AbortSignal;
  recover?: FoodTrialRecovery;
}): Promise<FoodTrialResult> {
  const hint = input.hint.trim();
  if (input.images.length > 2 || hint.length > 1500 || (!input.images.length && hint.length < 5)) {
    throw new Error('Add a meal description (5–1,500 characters), or one or two photos.');
  }
  if (isPreviewActive()) {
    if (input.onProgress) await previewSteps(input.onProgress, input.signal);
    if (input.signal?.aborted) throw input.signal.reason ?? abortError();
    return structuredClone(previewFoodTrialResult);
  }
  const requestBody = { images: input.images, hint, ...(input.clarificationUsed ? { clarificationUsed: true } : {}) };
  const startedAt = Date.now();
  const startedUtcDate = utcDateKey(startedAt);
  const recover = input.recover;
  let activeRequestId = recover ? await mealRequestId({ images: input.images, hint, clarificationUsed: input.clarificationUsed }) : null;
  let sawStream = false;

  try {
    // No patientPost retries by default. Server computes a durable content hash, so a user retry
    // of identical input can retrieve an outcome but cannot start a second paid call.
    const payload = await post(requestBody, input.accessToken, input.onProgress, {
      signal: input.signal,
      onStreamStart: () => { sawStream = true; },
    });
    return parseFoodTrialPayload(payload, input.clarificationUsed);
  } catch (error) {
    if (input.signal?.aborted) throw error;
    const pendingOnStart = error instanceof FoodAnalysisRefusal && error.status === 409 && error.code === 'analysis_pending';
    const recoverable = recover && (pendingOnStart || isTransientNetworkError(error));
    if (!recoverable) {
      if (isTransientNetworkError(error)) throw new Error(INTERRUPTED_MESSAGE);
      throw error;
    }
    if (pendingOnStart && error.requestId) activeRequestId = error.requestId;
    if (!activeRequestId) throw new Error(INTERRUPTED_MESSAGE);

    const pollIntervalMs = recover.pollIntervalMs ?? 2_000;
    const notFoundDelayMs = recover.notFoundDelayMs ?? 1_500;
    const retryDelayMs = recover.retryDelayMs ?? 1_500;
    const maxPendingMs = recover.maxPendingMs ?? 125_000;
    const immediateForegroundDrop = !pendingOnStart && !sawStream && !recover.wasBackgrounded?.()
      && !recover.isBackgroundSuspended() && error instanceof TypeError && Date.now() - startedAt < 1_500;
    const maxNetworkRetries = immediateForegroundDrop ? 1 : 4;

    let consecutiveNetworkErrors = 0;
    let notFoundCount = 0;
    let repostedOnce = false;
    let foregroundPendingMs = 0;

    for (;;) {
      if (input.signal?.aborted) throw input.signal.reason ?? abortError();
      if (recover.isBackgroundSuspended()) {
        consecutiveNetworkErrors = 0;
        await recover.waitForForeground(input.signal);
        if (input.signal?.aborted) throw input.signal.reason ?? abortError();
      }
      let token: string;
      try {
        token = await recover.getAccessToken();
      } catch (tokenError) {
        if (input.signal?.aborted) throw tokenError;
        if (recover.isBackgroundSuspended()) continue;
        if (isTransientNetworkError(tokenError)) {
          consecutiveNetworkErrors += 1;
          if (consecutiveNetworkErrors >= maxNetworkRetries) throw new Error(INTERRUPTED_MESSAGE);
          await sleepAbortable(retryDelayMs * consecutiveNetworkErrors, input.signal);
          continue;
        }
        throw tokenError;
      }

      try {
        const check = await checkFoodTrialResult(activeRequestId, token, {
          clarificationUsed: input.clarificationUsed,
          signal: input.signal,
        });
        consecutiveNetworkErrors = 0;
        if (check.status === 'done') return check.result;
        if (check.status === 'pending') {
          notFoundCount = 0;
          activeRequestId = check.requestId;
          // Always allow at least one fresh check after returning from background;
          // only give up once past the server's deadline AND actively waiting in front.
          if (Date.now() - startedAt > maxPendingMs && foregroundPendingMs >= 15_000) {
            throw new Error(INTERRUPTED_MESSAGE);
          }
          await sleepAbortable(pollIntervalMs, input.signal);
          if (!recover.isBackgroundSuspended()) foregroundPendingMs += pollIntervalMs;
          continue;
        }
        // status === 'not_found': give the server a moment to record its claim first.
        notFoundCount += 1;
        if (notFoundCount === 1) {
          await sleepAbortable(notFoundDelayMs, input.signal);
          continue;
        }
        // Still no claim under our hash on the same UTC date: the initial upload was
        // dropped before reaching the server (or the server upgraded its hash version).
        // Re-posting once on the same UTC date is idempotent on the server's ledger.
        if (!repostedOnce && utcDateKey() === startedUtcDate && (sawStream || recover.wasBackgrounded?.())) {
          repostedOnce = true;
          try {
            const payload = await post(requestBody, token, input.onProgress, {
              signal: input.signal,
              onStreamStart: () => { sawStream = true; },
            });
            return parseFoodTrialPayload(payload, input.clarificationUsed);
          } catch (repostError) {
            if (input.signal?.aborted) throw repostError;
            if (repostError instanceof FoodAnalysisRefusal && repostError.status === 409 && repostError.code === 'analysis_pending') {
              if (repostError.requestId) activeRequestId = repostError.requestId;
              notFoundCount = 0;
              await sleepAbortable(pollIntervalMs, input.signal);
              continue;
            }
            if (isTransientNetworkError(repostError)) {
              notFoundCount = 0;
              continue;
            }
            throw repostError;
          }
        }
        throw new Error(INTERRUPTED_MESSAGE);
      } catch (checkError) {
        if (input.signal?.aborted) throw checkError;
        if (!isTransientNetworkError(checkError)) throw checkError;
        if (recover.isBackgroundSuspended()) continue;
        consecutiveNetworkErrors += 1;
        if (consecutiveNetworkErrors >= maxNetworkRetries) throw new Error(INTERRUPTED_MESSAGE);
        await sleepAbortable(retryDelayMs * consecutiveNetworkErrors, input.signal);
      }
    }
  }
}

type ServingFoodWithCalories = ServingFood & { calories?: number };

const CALORIE_TARGET_PATTERN = /^(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(k?cals?|calories?)$/;
const CALORIE_PREFIX_PATTERN = /^(?:(?:i\s+(?:ate|had|want|need|aim\s+for)|about|around|roughly|~)\s+)+/;

/** Resolve a calorie target like "500 cal" or "500 kcal" locally from the food's calories per serving. */
export function resolveCaloriesLocally(food: ServingFoodWithCalories, text: string): ServingInterpretation | null {
  const cleaned = text.toLowerCase().replace(/[“”"]/g, '').replace(/\s+/g, ' ').trim().replace(/[.!]+$/, '');
  if (!cleaned || /\b(and|plus|with|or|per|each)\b/.test(cleaned)) return null;
  const stripped = cleaned.replace(CALORIE_PREFIX_PATTERN, '').trim();
  const match = stripped.match(CALORIE_TARGET_PATTERN);
  if (!match) return null;
  const quantity = Number(match[1].replace(/,/g, ''));
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return { status: 'clarification', message: 'Enter a calorie target greater than zero.' };
  }
  const perServing = food.calories;
  if (typeof perServing !== 'number' || !Number.isFinite(perServing) || perServing <= 0) {
    return { status: 'clarification', message: 'This food has 0 calories, so it cannot be calculated from a calorie target.' };
  }
  const rawServings = quantity / perServing;
  if (!Number.isFinite(rawServings) || rawServings > 1000) {
    return { status: 'clarification', message: 'That amount is too large. Check the calories and try again.' };
  }
  const servings = Math.round(rawServings * 1000) / 1000;
  return { status: 'resolved', quantity, optionId: 'calories', servings, unit: 'kcal', basisQuantity: perServing };
}

/** Whether reading this amount needs the AI ("8 oz", "500 cal" and other plain conversions don't). */
export function servingNeedsAi(food: ServingFoodWithCalories, text: string): boolean {
  try {
    const input = normalizeServingInput({ action: 'interpret-serving', food, text });
    if (resolveCaloriesLocally(food, input.text)) return false;
    return !resolveServingLocally(input.food, input.text);
  } catch {
    // An amount the service would refuse anyway: no reason to ask first.
    return false;
  }
}

/** Interpret only the amount. Nutrition and division stay in application code. */
export async function interpretFoodServing(food: ServingFoodWithCalories, text: string, accessToken: string): Promise<ServingInterpretation> {
  const input = normalizeServingInput({ action: 'interpret-serving', food, text });
  // "500 cal", "500 kcal": deterministic calorie-target math stays on the phone.
  const calorieTarget = resolveCaloriesLocally(food, input.text);
  if (calorieTarget) return calorieTarget;
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
