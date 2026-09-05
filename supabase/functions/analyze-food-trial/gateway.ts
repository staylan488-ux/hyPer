export interface MealInput {
  images: { angle: 'top' | 'side'; imageBase64: string; mimeType: string }[];
  hint: string;
}

export interface TrialConfig {
  maxAttempts: number;
  allowedOrigins: string[];
}

export interface TrialLedger {
  assertPrivate(): Promise<void>;
  insert(path: string, value: unknown): Promise<boolean>;
  read(path: string): Promise<unknown | null>;
}

interface Dependencies {
  config: TrialConfig;
  authenticate(token: string): Promise<string | null>;
  ledger: TrialLedger;
  analyze(input: MealInput): Promise<unknown>;
  now?: () => number;
}

interface SavedResponse { status: number; body: Record<string, unknown> }
const MAX_BODY_BYTES = 9_000_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
// Change the content namespace when the analysis pipeline changes, while retaining
// the same daily quota objects. A provider change must never refresh the quota.
export const ANALYSIS_VERSION = 'gemini-tavily-v1';

export function validateConfig(config: TrialConfig): void {
  if (!Number.isInteger(config.maxAttempts) || config.maxAttempts < 1 || config.maxAttempts > 40
    || !config.allowedOrigins.length || config.allowedOrigins.some(origin => {
      try {
        const url = new URL(origin);
        return !['http:', 'https:', 'capacitor:'].includes(url.protocol) || `${url.protocol}//${url.host}` !== origin;
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
  return { images, hint };
}

async function inputHash(input: MealInput): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ version: ANALYSIS_VERSION, input })));
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
      const body = await boundedJson(request);
      if (body.action !== undefined && body.action !== 'analyze' && body.action !== 'status') throw new RequestError(400, 'invalid_request', 'Unknown food analysis action.');
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
        const slots = await Promise.all(Array.from({ length: config.maxAttempts }, (_, index) => ledger.read(`${base}/slots/${index}.json`)));
        const attempts = await Promise.all(slots.filter(Boolean).map(async raw => {
          const claim = raw as { requestId: string; createdAt: string; analysisVersion?: string };
          const result = await ledger.read(`${base}/results/${claim.requestId}.json`) as SavedResponse | null;
          return { ...claim, analysisVersion: result?.body.analysisVersion ?? claim.analysisVersion ?? 'legacy-google', status: result?.status ?? null, usage: result?.body.usage ?? null, code: result?.body.code ?? null };
        }));
        return respond(200, { date, maxAttempts: config.maxAttempts, attemptsUsed: attempts.length, attempts });
      }
      const input = normalizeInput(body);
      const requestId = await inputHash(input);
      const resultPath = `${base}/results/${requestId}.json`;
      // Same user's identical input replays within this UTC date.
      const saved = await ledger.read(resultPath) as SavedResponse | null;
      if (saved) return respond(saved.status, { ...saved.body, replayed: true });
      const claim = { requestId, createdAt: new Date(now()).toISOString(), analysisVersion: ANALYSIS_VERSION };
      if (!await ledger.insert(`${base}/claims/${requestId}.json`, claim)) {
        const result = await ledger.read(resultPath) as SavedResponse | null;
        return result ? respond(result.status, { ...result.body, replayed: true }) : pending(requestId);
      }
      let reserved = false;
      for (let index = 0; index < config.maxAttempts; index++) {
        if (await ledger.insert(`${base}/slots/${index}.json`, claim)) { reserved = true; break; }
      }
      let response: SavedResponse;
      if (!reserved) response = { status: 429, body: { code: 'daily_quota_exhausted', error: 'Today’s food analysis request limit has been reached. It resets at midnight UTC.', requestId, analysisVersion: ANALYSIS_VERSION } };
      else {
        try {
          const result = await deps.analyze(input);
          if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Invalid model result');
          // The adapter returns normalized meal JSON and provenance. Explicitly
          // exclude internal tool transcripts, fetched pages and research snippets.
          const normalized: Record<string, unknown> = {};
          for (const field of ['provider', 'model', 'modelVersion', 'responseId', 'researchProvider', 'summary', 'clarification', 'items', 'sources', 'originalText', 'usage']) {
            if (field in result) normalized[field] = (result as Record<string, unknown>)[field];
          }
          response = { status: 200, body: { ...normalized, searchSuggestionsHtml: null, requestId, analysisVersion: ANALYSIS_VERSION, limits: { date, maxAttempts: config.maxAttempts } } };
        } catch (error) {
          // Never leak upstream response text, credentials or prompts. Preserve structured usage on failures.
          const usage = error && typeof error === 'object' && 'usage' in error ? error.usage : undefined;
          response = { status: 502, body: { code: 'analysis_failed', error: 'Analysis did not finish successfully. This attempt remains counted; review or enter the meal manually.', requestId, analysisVersion: ANALYSIS_VERSION, ...(usage ? { usage } : {}) } };
        }
      }
      if (!await ledger.insert(resultPath, response)) throw new Error('Result already exists');
      return respond(response.status, response.body);
    } catch (error) {
      if (error instanceof RequestError) return respond(error.status, { error: error.message, code: error.code });
      return respond(503, { code: 'analysis_unavailable', error: 'Food analysis is temporarily unavailable. No automatic paid retry will run.' });
    }
  };
}
