import { normalizeCoachInput, type CoachInput } from './coach.ts';
import { normalizeServingInput, type ServingInput } from './serving.ts';
import { sseEvent, type ProgressListener } from './progress.ts';
import { NOT_APPROVED_MESSAGE } from '../_shared/approval.ts';

export interface MealInput {
  images: { angle: 'top' | 'side'; imageBase64: string; mimeType: string }[];
  hint: string;
  clarificationUsed?: boolean;
}

export interface TrialConfig {
  /** The most paid requests any account may make per UTC date (1–40). Each
   * account's own limit comes from `access` and is capped by this. */
  maxAttempts: number;
  /** Browser origins allowed to call. The app sends none; may be empty. */
  allowedOrigins: string[];
}

/** Who may use paid analysis, and how much (public.ai_access). */
export interface AiAccess {
  approved: boolean;
  /** Paid requests this account may make per UTC date; 0 means none. */
  dailyLimit: number;
}

export type AiFeature = 'food-analysis' | 'interpret-serving' | 'suggest-targets';

/** The daily dollar budget across all accounts and the AI off-switch
 * (public.app_config, ai_spend_daily and ai_spend_claims). */
export interface SpendBudget {
  /** Today's switch, budget and what is already reserved or spent. Free to ask. */
  status(date: string): Promise<{ enabled: boolean; budgetUsd: number; committedUsd: number }>;
  /** Reserves `reserveUsd` of today's budget for one paid request, atomically. */
  claim(request: { key: string; userId: string; date: string; feature: AiFeature; reserveUsd: number }): Promise<'claimed' | 'exhausted' | 'disabled' | 'duplicate'>;
  /** Replaces the reservation with what the request cost, once it is known. */
  settle(key: string, costUsd: number): Promise<void>;
}

/**
 * What each paid request reserves of the daily budget before it runs: more
 * than it can cost, worked out from the limits in model.ts, serving.ts,
 * coach.ts and tavily.ts at the prices model.ts uses from 2027-01-01 (the
 * higher ones). A meal analysis makes at most three Gemini calls of at most
 * 8,192 output tokens each, under 30,000 input tokens each (two photos, two
 * 16,000-character pages and ten search snippets), and at most 2 searches and
 * 2 page reads: about $0.34. A serving interpretation is one call of 2,048
 * output tokens, a target suggestion one call of 4,096. This assumes thinking
 * tokens count within the output limit; if Gemini bills more, the recorded
 * cost says so. The real cost replaces the reservation as soon as the request
 * ends, so the budget can only be passed if one request costs more than its
 * reservation, and ai_spend_claims shows any that did.
 */
export const RESERVE_USD: Record<AiFeature, number> = {
  'food-analysis': 0.40,
  'interpret-serving': 0.05,
  'suggest-targets': 0.10,
};

/** Whether reserving `reserveUsd` more would pass the budget, compared in
 * millionths of a dollar as the database does. */
function wouldPassBudget(today: { budgetUsd: number; committedUsd: number }, reserveUsd: number): boolean {
  return Math.round(today.committedUsd * 1e6) + Math.ceil(reserveUsd * 1e6) > Math.round(today.budgetUsd * 1e6);
}

/** The recorded cost of a finished request in dollars, or null when any part
 * of it is unknown (the reservation then stands). */
export function recordedCostUsd(usage: unknown): number | null {
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return null;
  const { estimatedTokenUsd, webResearch } = usage as { estimatedTokenUsd?: unknown; webResearch?: unknown };
  if (typeof estimatedTokenUsd !== 'number' || !Number.isFinite(estimatedTokenUsd) || estimatedTokenUsd < 0) return null;
  if (webResearch === undefined) return estimatedTokenUsd;
  const web = webResearch && typeof webResearch === 'object' ? (webResearch as { estimatedUsd?: unknown }).estimatedUsd : undefined;
  if (typeof web !== 'number' || !Number.isFinite(web) || web < 0) return null;
  return estimatedTokenUsd + web;
}

export interface TrialLedger {
  assertPrivate(): Promise<void>;
  insert(path: string, value: unknown): Promise<boolean>;
  read(path: string): Promise<unknown | null>;
}

interface Dependencies {
  config: TrialConfig;
  authenticate(token: string): Promise<string | null>;
  /** Approval and the account's daily limit. Throws when it cannot tell. */
  access(userId: string): Promise<AiAccess>;
  budget: SpendBudget;
  ledger: TrialLedger;
  /** Runs the meal analysis; `onProgress` hears its steps when the app asked to follow them. */
  analyze(input: MealInput, onProgress?: ProgressListener): Promise<unknown>;
  interpretServing?(input: ServingInput): Promise<unknown>;
  suggestTargets?(input: CoachInput): Promise<unknown>;
  now?: () => number;
  /** Keeps a streamed analysis running to its saved result if the app goes away. */
  waitUntil?(work: Promise<unknown>): void;
}

interface SavedResponse { status: number; body: Record<string, unknown> }
const MAX_BODY_BYTES = 9_000_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
// Change the content namespace when the analysis pipeline changes, while retaining
// the same daily quota objects. A provider change must never refresh the quota.
export const ANALYSIS_VERSION = 'gemini-tavily-v3';
export { NOT_APPROVED_MESSAGE };
export const GLOBAL_QUOTA_MESSAGE = 'Food analysis has reached today’s limit for everyone. It starts over at midnight UTC. You can still enter the meal yourself.';
export const PAUSED_MESSAGE = 'Food analysis is switched off for now. You can still enter the meal yourself.';

export function validateConfig(config: TrialConfig): void {
  if (!Number.isInteger(config.maxAttempts) || config.maxAttempts < 1 || config.maxAttempts > 40
    || config.allowedOrigins.some(origin => {
      try {
        const url = new URL(origin);
        return !['http:', 'https:'].includes(url.protocol) || `${url.protocol}//${url.host}` !== origin;
      } catch { return true; }
    })) throw new Error('Invalid food analysis configuration');
}

class RequestError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

async function boundedJson(request: Request): Promise<Record<string, unknown>> {
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) {
    throw new RequestError(413, 'request_too_large', 'Meal upload is too large. Use smaller photos.');
  }
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    throw new RequestError(415, 'invalid_content_type', 'Send a JSON meal request.');
  }
  if (!request.body) throw new RequestError(400, 'invalid_request', 'Missing meal request.');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let expired = false;
  const timer = setTimeout(() => { expired = true; void reader.cancel(); }, 15_000);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (expired) throw new RequestError(408, 'request_timeout', 'Meal upload timed out.');
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new RequestError(413, 'request_too_large', 'Meal upload is too large. Use smaller photos.');
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const body: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid JSON object');
    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError(400, 'invalid_request', 'Invalid meal request.');
  } finally { clearTimeout(timer); reader.releaseLock(); }
}

export function normalizeInput(body: Record<string, unknown>): MealInput {
  if (body.hint !== undefined && typeof body.hint !== 'string') throw new RequestError(400, 'invalid_request', 'Invalid meal description.');
  if (body.clarificationUsed !== undefined && typeof body.clarificationUsed !== 'boolean') throw new RequestError(400, 'invalid_request', 'Invalid clarification state.');
  const hint = ((body.hint ?? '') as string).trim().normalize('NFC');
  const rawImages = body.images ?? [];
  if (hint.length > 1500 || !Array.isArray(rawImages) || rawImages.length > 2) {
    throw new RequestError(400, 'invalid_request', 'Use up to two photos and a description of at most 1,500 characters.');
  }
  const images = rawImages.map((raw): MealInput['images'][number] => {
    if (!raw || typeof raw !== 'object') throw new RequestError(400, 'invalid_image', 'Invalid meal photo.');
    const { angle, imageBase64, mimeType } = raw;
    if ((angle !== 'top' && angle !== 'side') || !['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)
      || typeof imageBase64 !== 'string' || imageBase64.length < 4 || imageBase64.length > 4_400_000
      || imageBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(imageBase64)) {
      throw new RequestError(400, 'invalid_image', 'Use a valid JPEG, PNG or WebP photo.');
    }
    // Check the actual file signature, not only the caller's MIME declaration.
    let binary: string;
    try { binary = atob(imageBase64); } catch { throw new RequestError(400, 'invalid_image', 'Invalid photo encoding.'); }
    const valid = mimeType === 'image/jpeg' ? binary.startsWith('\xff\xd8\xff')
      : mimeType === 'image/png' ? binary.startsWith('\x89PNG\r\n\x1a\n')
      : binary.startsWith('RIFF') && binary.slice(8, 12) === 'WEBP';
    if (!valid) throw new RequestError(400, 'invalid_image', 'Photo content does not match its file type.');
    return { angle, imageBase64: btoa(binary), mimeType };
  }).sort((a, b) => a.angle.localeCompare(b.angle) || a.imageBase64.localeCompare(b.imageBase64));
  if (!images.length && hint.length < 5) throw new RequestError(400, 'invalid_request', 'Add a photo or describe your meal.');
  return { images, hint, clarificationUsed: body.clarificationUsed === true || /(?:^|\n)Answer:/i.test(hint) };
}

async function inputHash(input: MealInput | ServingInput | CoachInput, version: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ version, input })));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function createTrialHandler(deps: Dependencies): (request: Request) => Promise<Response> {
  validateConfig(deps.config);
  const { config, ledger } = deps;
  const now = deps.now ?? Date.now;
  return async (request) => {
    const origin = request.headers.get('origin');
    const allowed = !origin || config.allowedOrigins.includes(origin);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, idempotency-key',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      ...(origin && allowed ? { 'Access-Control-Allow-Origin': origin } : {}),
    };
    const respond = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers });
    const pending = (requestId: string) => respond(409, { code: 'analysis_pending', error: 'This analysis is running or its outcome is unknown. Checking the same meal on this UTC date will not start a second analysis.', requestId });
    try {
      if (!allowed) return respond(403, { code: 'origin_forbidden', error: 'This app origin is not enabled.' });
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
      if (request.method !== 'POST') return respond(405, { code: 'method_not_allowed', error: 'Use POST.' });
      const auth = request.headers.get('authorization');
      if (!auth || !/^Bearer \S+$/i.test(auth)) return respond(401, { code: 'unauthorized', error: 'Sign in to analyze a meal.' });
      const userId = await deps.authenticate(auth.slice(7));
      if (!userId || !UUID.test(userId)) return respond(401, { code: 'unauthorized', error: 'Sign in to analyze a meal.' });
      // Before anything is read or claimed. A failed check lands in the 503 below.
      const access = await deps.access(userId);
      if (!access.approved) return respond(403, { code: 'not_approved', error: NOT_APPROVED_MESSAGE });
      const dailyLimit = Number.isInteger(access.dailyLimit) ? Math.max(0, Math.min(access.dailyLimit, config.maxAttempts)) : 0;
      const body = await boundedJson(request);
      if (body.action !== undefined && body.action !== 'analyze' && body.action !== 'status' && body.action !== 'interpret-serving' && body.action !== 'suggest-targets') throw new RequestError(400, 'invalid_request', 'Unknown food analysis action.');
      // `progress: true` follows a meal analysis step by step (streamAnalysis).
      // It is not part of the meal, so a followed and a plain request share one result.
      if (body.progress !== undefined && typeof body.progress !== 'boolean') throw new RequestError(400, 'invalid_request', 'Invalid progress option.');
      const follow = body.progress === true;
      // Identity comes only from getUser. Each UTC date gets its own fixed quota.
      const date = new Date(now()).toISOString().slice(0, 10);
      const base = `food-v1/${userId.toLowerCase()}/${date}`;
      await ledger.assertPrivate();
      if (body.action === 'status') {
        if (body.requestId !== undefined) {
          if (typeof body.requestId !== 'string' || !HASH.test(body.requestId)) throw new RequestError(400, 'invalid_request', 'Invalid analysis ID.');
          const saved = await ledger.read(`${base}/results/${body.requestId}.json`) as SavedResponse | null;
          if (saved) return respond(saved.status, { ...saved.body, replayed: true });
          const claim = await ledger.read(`${base}/claims/${body.requestId}.json`);
          return claim ? pending(body.requestId) : respond(404, { code: 'analysis_not_found', error: 'Analysis not found.' });
        }
        const slots = await Promise.all(Array.from({ length: dailyLimit }, (_, index) => ledger.read(`${base}/slots/${index}.json`)));
        const attempts = await Promise.all(slots.filter(Boolean).map(async raw => {
          const claim = raw as { requestId: string; createdAt: string; analysisVersion?: string };
          const result = await ledger.read(`${base}/results/${claim.requestId}.json`) as SavedResponse | null;
          return { ...claim, analysisVersion: result?.body.analysisVersion ?? claim.analysisVersion ?? 'legacy-google', status: result?.status ?? null, usage: result?.body.usage ?? null, code: result?.body.code ?? null };
        }));
        // Free to ask; the everyone-limit and the switch are left out when they cannot be read.
        let shared: { globalLimitReached: boolean; aiEnabled: boolean } | undefined;
        try {
          const today = await deps.budget.status(date);
          shared = { aiEnabled: today.enabled, globalLimitReached: wouldPassBudget(today, RESERVE_USD['food-analysis']) };
        } catch { /* unknown */ }
        return respond(200, { date, maxAttempts: dailyLimit, attemptsUsed: attempts.length, attempts, ...shared });
      }
      let input: MealInput | ServingInput | CoachInput;
      const isServing = body.action === 'interpret-serving';
      const isCoach = body.action === 'suggest-targets';
      // Target suggestions share the daily request limit with meal analysis.
      const analysisVersion = isServing ? 'gemini-serving-v1' : isCoach ? 'gemini-coach-v1' : ANALYSIS_VERSION;
      const feature: AiFeature = isServing ? 'interpret-serving' : isCoach ? 'suggest-targets' : 'food-analysis';
      const reserveUsd = RESERVE_USD[feature];
      if (isServing) {
        try { input = normalizeServingInput(body); }
        catch { throw new RequestError(400, 'invalid_request', 'Describe an amount using a food with a valid serving definition.'); }
        if (!deps.interpretServing) throw new RequestError(503, 'serving_unavailable', 'Serving interpretation is unavailable. Enter the amount manually.');
      } else if (isCoach) {
        try { input = normalizeCoachInput(body); }
        catch { throw new RequestError(400, 'invalid_request', 'Describe your goal (5–2,000 characters) and complete your nutrition profile.'); }
        if (!deps.suggestTargets) throw new RequestError(503, 'coach_unavailable', 'Target suggestions are unavailable right now.');
      } else input = normalizeInput(body);
      const requestId = await inputHash(input, analysisVersion);
      const resultPath = `${base}/results/${requestId}.json`;
      // Same user's identical input replays within this UTC date.
      const saved = await ledger.read(resultPath) as SavedResponse | null;
      if (saved) return respond(saved.status, { ...saved.body, replayed: true });
      // Switched off, no allowance, or everyone's budget spent: refuse before
      // claiming anything, so nothing is counted and the same meal can run later.
      const today = await deps.budget.status(date);
      if (!today.enabled) return respond(503, { code: 'analysis_paused', error: PAUSED_MESSAGE, requestId, analysisVersion });
      if (!dailyLimit) return respond(429, { code: 'daily_quota_exhausted', error: DAILY_QUOTA_MESSAGE, requestId, analysisVersion });
      if (wouldPassBudget(today, reserveUsd)) {
        return respond(429, { code: 'global_quota_exhausted', error: GLOBAL_QUOTA_MESSAGE, requestId, analysisVersion });
      }
      const claim = { requestId, createdAt: new Date(now()).toISOString(), analysisVersion };
      if (!await ledger.insert(`${base}/claims/${requestId}.json`, claim)) {
        const result = await ledger.read(resultPath) as SavedResponse | null;
        return result ? respond(result.status, { ...result.body, replayed: true }) : pending(requestId);
      }
      let reserved = false;
      for (let index = 0; index < dailyLimit; index++) {
        if (await ledger.insert(`${base}/slots/${index}.json`, claim)) { reserved = true; break; }
      }
      // Runs the reserved request and saves its outcome, success or failure.
      const complete = async (onProgress?: ProgressListener): Promise<SavedResponse> => {
        let response: SavedResponse;
        try {
          const result = !('action' in input)
            ? await (onProgress ? deps.analyze(input, onProgress) : deps.analyze(input))
            : input.action === 'suggest-targets' ? await deps.suggestTargets!(input) : await deps.interpretServing!(input);
          if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Invalid model result');
          // The adapter returns normalized meal JSON and provenance. Explicitly
          // exclude internal tool transcripts, fetched pages and research snippets.
          const normalized: Record<string, unknown> = {};
          for (const field of ['provider', 'model', 'modelVersion', 'responseId', 'researchProvider', 'summary', 'clarification', 'items', 'sources', 'originalText', 'usage', ...(isServing ? ['interpretation'] : []), ...(isCoach ? ['recommendation'] : [])]) {
            if (field in result) normalized[field] = (result as Record<string, unknown>)[field];
          }
          response = { status: 200, body: { ...normalized, searchSuggestionsHtml: null, requestId, analysisVersion, limits: { date, maxAttempts: dailyLimit } } };
        } catch (error) {
          // Never leak upstream response text, credentials or prompts. Preserve structured usage on failures.
          const usage = error && typeof error === 'object' && 'usage' in error ? error.usage : undefined;
          response = { status: 502, body: { code: 'analysis_failed', error: 'Analysis did not finish successfully. This attempt remains counted; review or enter the meal manually.', requestId, analysisVersion, ...(usage ? { usage } : {}) } };
        }
        if (!await ledger.insert(resultPath, response)) throw new Error('Result already exists');
        // The reservation stands when the cost is unknown or cannot be recorded.
        const cost = recordedCostUsd(response.body.usage);
        if (cost !== null) await deps.budget.settle(resultPath, cost).catch(() => {});
        return response;
      };
      // Then this request's reservation of everyone's budget, claimed
      // atomically after the account's own slot, so concurrent requests can
      // never reserve more than the budget. An unreadable budget refuses (no paid call).
      let refusal: SavedResponse | null = null;
      if (!reserved) refusal = { status: 429, body: { code: 'daily_quota_exhausted', error: DAILY_QUOTA_MESSAGE, requestId, analysisVersion } };
      else {
        let outcome: Awaited<ReturnType<SpendBudget['claim']>> | null = null;
        try { outcome = await deps.budget.claim({ key: resultPath, userId, date, feature, reserveUsd }); } catch { /* refused below */ }
        if (outcome === 'exhausted') refusal = { status: 429, body: { code: 'global_quota_exhausted', error: GLOBAL_QUOTA_MESSAGE, requestId, analysisVersion } };
        else if (outcome === 'disabled') refusal = { status: 503, body: { code: 'analysis_paused', error: PAUSED_MESSAGE, requestId, analysisVersion } };
        else if (outcome !== 'claimed') refusal = { status: 503, body: { code: 'analysis_unavailable', error: UNAVAILABLE, requestId, analysisVersion } };
      }
      // A refusal after a claim is saved like any outcome: asking again replays
      // it instead of starting a paid call.
      if (refusal) {
        if (!await ledger.insert(resultPath, refusal)) throw new Error('Result already exists');
        return respond(refusal.status, refusal.body);
      }
      if (follow && !('action' in input)) return streamAnalysis(complete);
      const response = await complete();
      return respond(response.status, response.body);
    } catch (error) {
      if (error instanceof RequestError) return respond(error.status, { error: error.message, code: error.code });
      return respond(503, { code: 'analysis_unavailable', error: UNAVAILABLE });
    }

    /**
     * The app asked to follow the analysis: answer at once with server-sent
     * events, one per step, then the saved outcome as the last event
     * ({ type: 'result', status, body }, the same status and body a plain
     * request gets). The analysis runs to its saved result even if the app
     * goes away, so asking again replays it.
     */
    function streamAnalysis(complete: (onProgress: ProgressListener) => Promise<SavedResponse>): Response {
      const encoder = new TextEncoder();
      const pipe: { channel?: ReadableStreamDefaultController<Uint8Array> } = {};
      let open = true;
      const send = (value: unknown) => {
        if (!open || !pipe.channel) return;
        try { pipe.channel.enqueue(encoder.encode(sseEvent(value))); } catch { open = false; }
      };
      const stream = new ReadableStream<Uint8Array>({
        start(controller) { pipe.channel = controller; },
        cancel() { open = false; },
      });
      const work = (async () => {
        let outcome: SavedResponse;
        try { outcome = await complete(step => send({ type: 'progress', ...step })); }
        catch { outcome = { status: 503, body: { code: 'analysis_unavailable', error: UNAVAILABLE } }; }
        send({ type: 'result', status: outcome.status, body: outcome.body });
        if (open) { open = false; try { pipe.channel?.close(); } catch { /* already gone */ } }
      })();
      deps.waitUntil?.(work);
      return new Response(stream, { status: 200, headers: { ...headers, 'Content-Type': 'text/event-stream; charset=utf-8', 'X-Accel-Buffering': 'no' } });
    }
  };
}

const UNAVAILABLE = 'Food analysis is temporarily unavailable. No automatic paid retry will run.';
const DAILY_QUOTA_MESSAGE = 'Today’s food analysis request limit has been reached. It resets at midnight UTC.';
