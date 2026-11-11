import { describe, expect, it, vi } from 'vitest';
import { ANALYSIS_VERSION, RESERVE_USD, createTrialHandler, normalizeInput, recordedCostUsd, validateConfig } from '../supabase/functions/analyze-food-trial/gateway';
import type { AiAccess, MealInput, TrialConfig, TrialLedger } from '../supabase/functions/analyze-food-trial/gateway';
import { memoryBudget } from './helpers/memoryBudget';
import { createStorageLedger } from '../supabase/functions/analyze-food-trial/storageLedger';
import type { ProgressListener } from '../supabase/functions/analyze-food-trial/progress';

const USER = '11111111-1111-4111-8111-111111111111';
const FRIEND = '22222222-2222-4222-8222-222222222222';
const NOW = Date.parse('2026-09-05T12:00:00Z');
const config: TrialConfig = {
  maxAttempts: 3, allowedOrigins: ['http://localhost:5173', 'http://localhost:8081'],
};
const photo = { angle: 'top', mimeType: 'image/jpeg', imageBase64: btoa('\xff\xd8\xffmeal') };

function harness(overrides: Partial<TrialConfig> = {}, budgetUsd = 5) {
  const objects = new Map<string, unknown>();
  const ledger: TrialLedger = {
    assertPrivate: vi.fn(async () => {}),
    insert: vi.fn(async (path, value) => {
      if (objects.has(path)) return false;
      objects.set(path, structuredClone(value));
      return true;
    }),
    read: vi.fn(async path => objects.get(path) ?? null),
  };
  const analyze = vi.fn<(input: MealInput, onProgress?: ProgressListener) => Promise<Record<string, unknown>>>(async () => ({ items: [{ name: 'Meal' }], usage: { inputTokens: 20, outputTokens: 10, thinkingTokens: 5 } }));
  const interpretServing = vi.fn(async () => ({ provider: 'gemini', interpretation: { status: 'resolved', quantity: 6, optionId: 'defined', servings: 1.2, unit: 'piece', basisQuantity: 5 } }));
  const authenticate = vi.fn(async token => token === 'friend' ? FRIEND : token === 'valid' ? USER : token === 'other' ? '33333333-3333-4333-8333-333333333333' : null);
  let time = NOW;
  // Followed analyses the runtime is asked to keep alive.
  const work: Promise<unknown>[] = [];
  // Approved unless a test says otherwise, with room up to config.maxAttempts.
  const access = vi.fn<(userId: string) => Promise<AiAccess>>(async () => ({ approved: true, dailyLimit: 40 }));
  const budget = memoryBudget(budgetUsd);
  vi.spyOn(budget, 'status');
  vi.spyOn(budget, 'claim');
  vi.spyOn(budget, 'settle');
  const handler = createTrialHandler({ config: { ...config, ...overrides }, ledger, analyze, interpretServing, authenticate, access, budget, now: () => time, waitUntil: promise => { work.push(promise); } });
  const request = (body: unknown, token = 'valid', origin = 'http://localhost:8081') => handler(new Request('http://trial', {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', origin }, body: JSON.stringify(body),
  }));
  return { objects, ledger, analyze, interpretServing, authenticate, access, budget, handler, request, work, setTime: (value: number) => { time = value; } };
}

/** The data of each server-sent event in a followed response. */
async function streamed(response: Response): Promise<Record<string, unknown>[]> {
  return (await response.text()).split('\n\n').filter(Boolean).map(block => JSON.parse(block.replace(/^data: /, '')));
}

describe('a followed meal analysis', () => {
  it('streams each step, then the saved outcome, and replays it to plain and followed requests alike', async () => {
    const h = harness();
    h.analyze.mockImplementationOnce(async (_input, onProgress) => {
      onProgress?.({ step: 'look' });
      onProgress?.({ step: 'search', products: ['Fixture samosas'] });
      return { items: [{ name: 'Samosas' }], usage: { thinkingTokens: 7 } };
    });
    const response = await h.request({ hint: 'six samosas', progress: true });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:8081');
    const events = await streamed(response);
    expect(events.slice(0, 2)).toEqual([{ type: 'progress', step: 'look' }, { type: 'progress', step: 'search', products: ['Fixture samosas'] }]);
    expect(events[2]).toMatchObject({ type: 'result', status: 200, body: { items: [{ name: 'Samosas' }], usage: { thinkingTokens: 7 }, analysisVersion: ANALYSIS_VERSION } });
    expect(events).toHaveLength(3);
    // The option is not part of the meal: one analysis, one result.
    const plain = await h.request({ hint: 'six samosas' });
    expect(plain.headers.get('content-type')).toBe('application/json');
    expect(await plain.json()).toMatchObject({ replayed: true, requestId: (events[2].body as { requestId: string }).requestId });
    expect(await (await h.request({ hint: 'six samosas', progress: true })).json()).toMatchObject({ replayed: true });
    expect(h.analyze).toHaveBeenCalledOnce();
    expect(h.analyze.mock.calls[0][0]).toEqual({ images: [], hint: 'six samosas', clarificationUsed: false });
  });

  it('runs to its saved result after the app goes away', async () => {
    const h = harness();
    let finish!: (value: Record<string, unknown>) => void;
    h.analyze.mockImplementationOnce((_input, onProgress) => new Promise(done => { onProgress?.({ step: 'look' }); finish = done; }));
    const response = await h.request({ hint: 'six samosas', progress: true });
    await response.body!.cancel();
    finish({ items: [{ name: 'Samosas' }], usage: {} });
    expect(h.work).toHaveLength(1);
    await Promise.all(h.work);
    expect(await (await h.request({ hint: 'six samosas' })).json()).toMatchObject({ replayed: true, items: [{ name: 'Samosas' }] });
    expect(h.analyze).toHaveBeenCalledOnce();
  });

  it('streams a failure as its saved outcome, without upstream text', async () => {
    const h = harness();
    h.analyze.mockRejectedValueOnce(Object.assign(new Error('secret upstream response'), { usage: { thinkingTokens: 3 } }));
    const events = await streamed(await h.request({ hint: 'six samosas', progress: true }));
    expect(events.at(-1)).toMatchObject({ type: 'result', status: 502, body: { code: 'analysis_failed', usage: { thinkingTokens: 3 } } });
    expect(JSON.stringify(events)).not.toContain('secret');
    expect((await h.request({ hint: 'six samosas' })).status).toBe(502);
  });

  it('answers refusals, the daily limit and the other actions with plain JSON', async () => {
    const h = harness({ maxAttempts: 1 });
    expect((await h.request({ hint: 'six samosas', progress: 'yes' })).status).toBe(400);
    expect((await h.request({ hint: 'six samosas', progress: true }, 'bad')).status).toBe(401);
    await (await h.request({ hint: 'first meal', progress: true })).text();
    const limited = await h.request({ hint: 'second meal', progress: true });
    expect(limited.status).toBe(429);
    expect(limited.headers.get('content-type')).toBe('application/json');
    const serving = await h.request({ action: 'interpret-serving', progress: true, food: { name: 'Samosas', serving_size: 5, serving_unit: 'piece', calories: 300, protein: 10, carbs: 30, fat: 15 }, text: 'I ate 6 pieces' }, 'friend');
    expect(serving.headers.get('content-type')).toBe('application/json');
    expect(h.analyze).toHaveBeenCalledOnce();
  });
});

describe('authenticated food analysis gateway', () => {
  it('fails closed on broad origins or excessive daily request limits', () => {
    for (const override of [{ maxAttempts: 41 }, { maxAttempts: 0 }, { maxAttempts: 1.5 }, { allowedOrigins: ['*'] }, { allowedOrigins: ['capacitor://localhost'] }]) {
      expect(() => validateConfig({ ...config, ...override })).toThrow();
    }
    expect(() => validateConfig(config)).not.toThrow();
    // The app sends no Origin, so no browser origin at all is fine.
    expect(() => validateConfig({ ...config, allowedOrigins: [] })).not.toThrow();
  });

  it('accepts any normally authenticated user and rejects unsigned requests/origins before storage or model access', async () => {
    const h = harness();
    expect((await h.request({ hint: 'six samosas' }, 'bad')).status).toBe(401);
    expect((await h.request({ hint: 'six samosas' }, 'valid', 'https://evil.example')).status).toBe(403);
    expect(h.ledger.assertPrivate).not.toHaveBeenCalled();
    for (const token of ['valid', 'friend', 'other']) {
      const response = await h.request({ hint: 'six samosas' }, token);
      expect(response.status).toBe(200);
      expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:8081');
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
    expect(h.analyze).toHaveBeenCalledTimes(3);
  });

  it('allows authenticated text-only and photo-only meals without storing submitted payloads', async () => {
    const h = harness();
    expect((await h.request({ hint: '  six chicken samosas  ' })).status).toBe(200);
    expect(h.analyze).toHaveBeenNthCalledWith(1, { images: [], hint: 'six chicken samosas', clarificationUsed: false });
    expect((await h.request({ images: [photo] })).status).toBe(200);
    expect(h.analyze).toHaveBeenNthCalledWith(2, { images: [photo], hint: '', clarificationUsed: false });
    expect(JSON.stringify([...h.objects.values()])).not.toContain('imageBase64');
    expect(JSON.stringify([...h.objects.values()])).not.toContain('six chicken samosas');
  });

  it('rejects malformed/oversized descriptions, image encodings and actual file type mismatches', () => {
    for (const body of [{}, { hint: 'rice' }, { hint: 'x'.repeat(1501) }, { images: [photo, photo, photo] },
      { images: [{ ...photo, imageBase64: '!!!!' }] }, { images: [{ ...photo, imageBase64: 'YQ==' }] },
      { images: [{ ...photo, mimeType: 'image/gif' }] }, { images: [{ ...photo, angle: 'front' }] },
      { images: [{ ...photo, imageBase64: 'A'.repeat(4_400_004) }] }, { hint: 123 }]) {
      expect(() => normalizeInput(body)).toThrow();
    }
    expect(normalizeInput({ images: [{ angle: 'top', mimeType: 'image/png', imageBase64: btoa('\x89PNG\r\n\x1a\n') }] }).images).toHaveLength(1);
    expect(normalizeInput({ images: [{ angle: 'side', mimeType: 'image/webp', imageBase64: btoa('RIFF1234WEBP') }] }).images).toHaveLength(1);
  });

  it('normalizes the clarification budget and rejects non-boolean values', () => {
    expect(normalizeInput({ hint: 'six samosas' }).clarificationUsed).toBe(false);
    expect(normalizeInput({ hint: 'six samosas', clarificationUsed: true }).clarificationUsed).toBe(true);
    for (const clarificationUsed of ['true', 'false', 1, null, {}]) {
      expect(() => normalizeInput({ hint: 'six samosas', clarificationUsed })).toThrow();
    }
  });

  it('uses a separate request identity after the one clarification while preserving replay and daily accounting', async () => {
    const h = harness();
    const first = await (await h.request({ hint: 'six samosas' })).json();
    const explicitUnused = await (await h.request({ hint: 'six samosas', clarificationUsed: false })).json();
    expect(explicitUnused).toMatchObject({ requestId: first.requestId, replayed: true });
    const answered = await (await h.request({ hint: 'six samosas', clarificationUsed: true })).json();
    expect(answered.requestId).not.toBe(first.requestId);
    expect(h.analyze).toHaveBeenNthCalledWith(2, { images: [], hint: 'six samosas', clarificationUsed: true });
    expect((await (await h.request({ hint: 'six samosas', clarificationUsed: true })).json()).replayed).toBe(true);
    expect(h.analyze).toHaveBeenCalledTimes(2);
    expect(await (await h.request({ action: 'status' })).json()).toMatchObject({ attemptsUsed: 2 });
  });

  it('does not replay a v1 label-question dead end under the updated analysis version', async () => {
    const h = harness({ maxAttempts: 2 });
    const input = { images: [], hint: 'six samosas' };
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ version: 'gemini-tavily-v1', input })));
    const oldRequestId = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    const base = `food-v1/${USER}/2026-09-05`;
    h.objects.set(`${base}/slots/0.json`, { requestId: oldRequestId, analysisVersion: 'gemini-tavily-v1', createdAt: new Date(NOW).toISOString() });
    h.objects.set(`${base}/results/${oldRequestId}.json`, { status: 200, body: { requestId: oldRequestId, items: [], clarification: 'Could you add the exact package nutrition label?' } });
    const result = await (await h.request(input)).json();
    expect(result.requestId).not.toBe(oldRequestId);
    expect(result.analysisVersion).not.toBe('gemini-tavily-v1');
    expect(result.items).toHaveLength(1);
    expect(h.analyze).toHaveBeenCalledOnce();
    expect(await (await h.request({ action: 'status' })).json()).toMatchObject({ attemptsUsed: 2 });
  });

  it('bounds streamed bodies even without content-length and rejects invalid JSON/method', async () => {
    const h = harness();
    const headers = { authorization: 'Bearer valid', 'content-type': 'application/json' };
    const huge = new Request('http://trial', { method: 'POST', headers, body: ' '.repeat(9_000_001) });
    expect((await h.handler(huge)).status).toBe(413);
    expect((await h.handler(new Request('http://trial', { method: 'POST', headers, body: '{bad' }))).status).toBe(400);
    expect((await h.handler(new Request('http://trial'))).status).toBe(405);
    expect((await h.handler(new Request('http://trial', { method: 'OPTIONS', headers: { origin: 'http://localhost:8081' } }))).status).toBe(204);
    expect(h.analyze).not.toHaveBeenCalled();
  });

  it('atomically claims concurrent identical requests and replays the saved outcome without another paid call', async () => {
    const h = harness();
    let resolve!: (value: { foods: { name: string }[]; usage: { inputTokens: number; outputTokens: number; thinkingTokens: number } }) => void;
    h.analyze.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const first = h.request({ hint: 'six samosas' });
    await vi.waitFor(() => expect(h.analyze).toHaveBeenCalledTimes(1));
    const pending = await h.request({ hint: '  six samosas ' });
    expect(pending.status).toBe(409);
    const { requestId } = await pending.json();
    expect((await h.request({ action: 'status', requestId })).status).toBe(409);
    resolve({ foods: [{ name: 'Samosas' }], usage: { inputTokens: 50, outputTokens: 25, thinkingTokens: 10 } });
    expect((await first).status).toBe(200);
    const replay = await (await h.request({ hint: 'six samosas' })).json();
    expect(replay).toMatchObject({ requestId, replayed: true, usage: { thinkingTokens: 10 } });
    expect((await h.request({ action: 'status', requestId }, 'friend')).status).toBe(404);
    expect((await h.request({ action: 'status', requestId })).status).toBe(200);
    expect((await h.request({ hint: 'six samosas' })).status).toBe(200);
    expect(h.analyze).toHaveBeenCalledTimes(1);
  });

  it('enforces the daily fixed-slot quota under concurrent distinct requests and reports usage', async () => {
    const h = harness({ maxAttempts: 2 });
    const results = await Promise.all(Array.from({ length: 10 }, (_, n) => h.request({ hint: `meal number ${n}` })));
    expect(results.filter(response => response.status === 200)).toHaveLength(2);
    expect(results.filter(response => response.status === 429)).toHaveLength(8);
    expect(h.analyze).toHaveBeenCalledTimes(2);
    const status = await (await h.request({ action: 'status' })).json();
    expect(status).toMatchObject({ date: '2026-09-05', maxAttempts: 2, attemptsUsed: 2 });
    expect(status.attempts).toHaveLength(2);
    expect(status.attempts[0].usage).toMatchObject({ thinkingTokens: 5 });
  });

  it('retains failed calls and their usage, sanitizes errors and never refunds a slot', async () => {
    const h = harness({ maxAttempts: 1 });
    h.analyze.mockRejectedValueOnce(Object.assign(new Error('secret key and upstream response'), { usage: { thinkingTokens: 99 } }));
    const first = await h.request({ hint: 'six samosas' });
    expect(first.status).toBe(502);
    const body = await first.json();
    expect(body.usage).toEqual({ thinkingTokens: 99 });
    expect(JSON.stringify(body)).not.toContain('secret');
    expect((await h.request({ hint: 'six samosas' })).status).toBe(502);
    expect((await h.request({ hint: 'other meal' })).status).toBe(429);
    expect(h.analyze).toHaveBeenCalledTimes(1);
  });

  it('fails closed on ambiguous storage errors before paid call; a lost saved result never repeats a paid call', async () => {
    const h = harness();
    vi.mocked(h.ledger.insert).mockRejectedValueOnce(new Error('network failed during claim'));
    expect((await h.request({ hint: 'six samosas' })).status).toBe(503);
    expect(h.analyze).not.toHaveBeenCalled();
    const original = h.ledger.insert;
    h.ledger.insert = async (path, value) => {
      if (path.includes('/results/')) throw new Error('lost write response');
      return original(path, value);
    };
    expect((await h.request({ hint: 'six samosas' })).status).toBe(503);
    expect((await h.request({ hint: 'six samosas' })).status).toBe(409);
    expect(h.analyze).toHaveBeenCalledTimes(1);
  });

  it('does not proceed if the private bucket check fails', async () => {
    const h = harness();
    vi.mocked(h.ledger.assertPrivate).mockRejectedValueOnce(new Error('public bucket'));
    expect((await h.request({ hint: 'six samosas' })).status).toBe(503);
    expect(h.analyze).not.toHaveBeenCalled();
  });

  it('versions Tavily request identity without resetting quota consumed by old Google requests', async () => {
    const h = harness({ maxAttempts: 2 });
    const input = normalizeInput({ hint: 'six samosas' });
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(input)));
    const oldRequestId = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    const base = `food-v1/${USER}/2026-09-05`;
    h.objects.set(`${base}/slots/0.json`, { requestId: oldRequestId, createdAt: new Date(NOW).toISOString() });
    h.objects.set(`${base}/results/${oldRequestId}.json`, { status: 200, body: { requestId: oldRequestId, summary: 'Old grounded answer', usage: { estimatedTokenUsd: 0.001, searchUsdIfAllowanceExhausted: 0.014 } } });
    const response = await (await h.request({ hint: 'six samosas' })).json();
    expect(response.requestId).not.toBe(oldRequestId);
    expect(response.analysisVersion).toBe(ANALYSIS_VERSION);
    expect(response.summary).not.toBe('Old grounded answer');
    expect(h.analyze).toHaveBeenCalledTimes(1);
    expect((await h.request({ hint: 'another meal' })).status).toBe(429);
    const status = await (await h.request({ action: 'status' })).json();
    expect(status.attemptsUsed).toBe(2);
    expect(status.attempts.map((attempt: { analysisVersion: string }) => attempt.analysisVersion)).toEqual(['legacy-google', ANALYSIS_VERSION]);
    expect(status.attempts[0].usage.searchUsdIfAllowanceExhausted).toBe(0.014);
    expect((await (await h.request({ hint: 'six samosas' })).json()).replayed).toBe(true);
    expect(h.analyze).toHaveBeenCalledTimes(1);
  });

  it('stores normalized meal provenance and usage, excluding internal research payload fields', async () => {
    const h = harness();
    h.analyze.mockResolvedValueOnce({ provider: 'gemini', researchProvider: 'tavily', model: 'gemini-3.8-flash',
      summary: 'Meal ready.', items: [{ name: 'Samosas', calories: 180 }], sources: [{ title: 'Product', url: 'https://example.com/food' }],
      originalText: '{"summary":"Meal ready.","items":[{"name":"Samosas","calories":180}]}',
      usage: { modelCalls: 3, estimatedTokenUsd: 0.013, webResearch: { provider: 'tavily', reportedCredits: 2, complete: true } },
      fetchedPages: ['FULL SOURCE PAGE MUST NOT BE RETAINED'], toolTranscript: ['INTERNAL RESEARCH'], searchSuggestionsHtml: '<div>OLD GOOGLE SUGGESTIONS</div>',
    });
    const result = await (await h.request({ hint: 'six samosas' })).json();
    expect(result.researchProvider).toBe('tavily');
    expect(result.usage.modelCalls).toBe(3);
    expect(result.sources).toEqual([{ title: 'Product', url: 'https://example.com/food' }]);
    const stored = JSON.stringify([...h.objects.values()]);
    expect(stored).not.toContain('FULL SOURCE PAGE');
    expect(stored).not.toContain('INTERNAL RESEARCH');
    expect(stored).not.toContain('OLD GOOGLE SUGGESTIONS');
  });

  it('isolates owners and resets the request quota at the next UTC date without enrollment configuration', async () => {
    const h = harness({ maxAttempts: 1 });
    const first = await (await h.request({ hint: 'six samosas' })).json();
    expect(first.limits).toEqual({ date: '2026-09-05', maxAttempts: 1 });
    expect((await h.request({ hint: 'different meal' })).status).toBe(429);
    expect((await h.request({ action: 'status', requestId: first.requestId }, 'other')).status).toBe(404);
    expect((await h.request({ hint: 'different meal', userId: USER }, 'other')).status).toBe(200);
    const ownStatus = await (await h.request({ action: 'status' })).json();
    expect(ownStatus.attemptsUsed).toBe(1);
    h.setTime(Date.parse('2026-09-06T00:00:00Z'));
    const fresh = await (await h.request({ action: 'status' })).json();
    expect(fresh).toMatchObject({ date: '2026-09-06', attemptsUsed: 0 });
    expect((await h.request({ action: 'status', requestId: first.requestId })).status).toBe(404);
    expect((await h.request({ hint: 'six samosas' })).status).toBe(200);
    expect(h.analyze).toHaveBeenCalledTimes(3);
    expect([...h.objects.keys()].filter(path => path.includes('/slots/'))).toEqual(expect.arrayContaining([
      `food-v1/${USER}/2026-09-05/slots/0.json`,
      'food-v1/33333333-3333-4333-8333-333333333333/2026-09-05/slots/0.json',
      `food-v1/${USER}/2026-09-06/slots/0.json`,
    ]));
  });
});

describe('Supabase storage ledger adapter', () => {
  const ledger = (response: Response) => {
    const send = vi.fn<typeof fetch>(async () => response);
    return { send, api: createStorageLedger({ url: 'https://project.supabase.co', serviceRoleKey: 'server-secret', bucket: 'food-trial', fetch: send }) };
  };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

  it('uses insert-only uploads and recognizes only explicit object collisions', async () => {
    const ok = ledger(json({ Key: 'claim' }));
    expect(await ok.api.insert('trial/user/slots/0.json', { requestId: 'hash' })).toBe(true);
    expect(ok.send.mock.calls[0]?.[1]).toMatchObject({ method: 'POST', headers: { 'x-upsert': 'false' } });
    for (const error of [{ code: 'ResourceAlreadyExists' }, { error: 'Duplicate', message: 'The resource already exists' }]) {
      expect(await ledger(json(error, 400)).api.insert('claim', {})).toBe(false);
    }
    for (const error of [{ error: 'Bad Request' }, { code: 'AccessDenied' }, { code: 'NoSuchBucket' }]) {
      await expect(ledger(json(error, 400)).api.insert('claim', {})).rejects.toThrow('Ledger claim failed');
    }
  });

  it('requires an existing private bucket and distinguishes missing objects from storage failure', async () => {
    await expect(ledger(json({ id: 'food-trial', public: false })).api.assertPrivate()).resolves.toBeUndefined();
    await expect(ledger(json({ id: 'food-trial', public: true })).api.assertPrivate()).rejects.toThrow();
    await expect(ledger(json({ code: 'NoSuchBucket' }, 404)).api.read('claim')).rejects.toThrow();
    expect(await ledger(json({ code: 'NoSuchKey' }, 404)).api.read('claim')).toBeNull();
    expect(await ledger(json({ error: 'not_found', message: 'Object not found' }, 400)).api.read('claim')).toBeNull();
  });
});


describe('serving interpretation through the shared gateway', () => {
  const food = { name: 'Samosas', serving_size: 5, serving_unit: 'pieces' };
  const input = { action: 'interpret-serving', text: 'I ate 6 pieces', food };
  it('authenticates, dispatches without meal research, and replays identical requests', async () => {
    const h = harness();
    expect((await h.request(input, 'bad')).status).toBe(401);
    expect(h.interpretServing).not.toHaveBeenCalled();
    const first = await (await h.request(input)).json();
    const again = await (await h.request(input)).json();
    expect(first).toMatchObject({ analysisVersion: 'gemini-serving-v1', interpretation: { servings: 1.2 } });
    expect(again).toMatchObject({ replayed: true, requestId: first.requestId });
    expect(h.analyze).not.toHaveBeenCalled();
    expect(h.interpretServing).toHaveBeenCalledOnce();
    const changedFood = await (await h.request({ ...input, food: { ...food, serving_size: 3 } })).json();
    expect(changedFood.requestId).not.toBe(first.requestId);
    expect(h.interpretServing).toHaveBeenCalledTimes(2);
  });
  it('shares meal quota and rejects invalid definitions before a paid call', async () => {
    const h = harness({ maxAttempts: 1 });
    expect((await h.request({ ...input, food: { ...food, serving_size: 0 } })).status).toBe(400);
    expect(h.interpretServing).not.toHaveBeenCalled();
    expect((await h.request(input)).status).toBe(200);
    expect((await h.request({ hint: 'rice and chicken' })).status).toBe(429);
    expect(h.analyze).not.toHaveBeenCalled();
  });
});

describe('approval, each account’s limit, the daily budget and the off-switch', () => {
  const serving = { action: 'interpret-serving', text: 'I ate 6 pieces', food: { name: 'Samosas', serving_size: 5, serving_unit: 'pieces' } };
  const slots = (h: ReturnType<typeof harness>, user = USER) => [...h.objects.keys()].filter(path => path.startsWith(`food-v1/${user}/2026-09-05/slots/`));

  it('refuses an account that is not approved before reading, claiming or paying for anything', async () => {
    const h = harness();
    h.access.mockResolvedValue({ approved: false, dailyLimit: 0 });
    for (const body of [{ hint: 'six samosas' }, { hint: 'six samosas', progress: true }, { action: 'status' }, serving]) {
      const response = await h.request(body);
      expect(response.status).toBe(403);
      expect(response.headers.get('content-type')).toBe('application/json');
      expect(await response.json()).toMatchObject({ code: 'not_approved' });
    }
    expect(h.access).toHaveBeenCalledWith(USER);
    expect(h.ledger.assertPrivate).not.toHaveBeenCalled();
    expect(h.ledger.read).not.toHaveBeenCalled();
    expect(h.ledger.insert).not.toHaveBeenCalled();
    expect(h.budget.claim).not.toHaveBeenCalled();
    expect(h.analyze).not.toHaveBeenCalled();
    expect(h.interpretServing).not.toHaveBeenCalled();
  });

  it('fails closed when approval cannot be checked', async () => {
    const h = harness();
    h.access.mockRejectedValue(new Error('database down'));
    const response = await h.request({ hint: 'six samosas' });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'analysis_unavailable' });
    expect(h.ledger.insert).not.toHaveBeenCalled();
    expect(h.analyze).not.toHaveBeenCalled();
  });

  it('uses each account’s own daily limit, capped by the configured ceiling', async () => {
    const h = harness({ maxAttempts: 3 });
    h.access.mockResolvedValue({ approved: true, dailyLimit: 1 });
    expect((await h.request({ hint: 'first meal' })).status).toBe(200);
    const limited = await h.request({ hint: 'second meal' });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ code: 'daily_quota_exhausted' });
    expect(await (await h.request({ action: 'status' })).json()).toMatchObject({ maxAttempts: 1, attemptsUsed: 1 });
    // A raised limit (the owner's 24) still stops at the ceiling.
    h.access.mockResolvedValue({ approved: true, dailyLimit: 24 });
    expect(await (await h.request({ action: 'status' })).json()).toMatchObject({ maxAttempts: 3 });
    expect(h.analyze).toHaveBeenCalledOnce();
  });

  it('refuses an account with no allowance before claiming anything', async () => {
    const h = harness();
    h.access.mockResolvedValue({ approved: true, dailyLimit: 0 });
    const response = await h.request({ hint: 'first meal' });
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ code: 'daily_quota_exhausted' });
    expect(h.ledger.insert).not.toHaveBeenCalled();
    expect(h.budget.claim).not.toHaveBeenCalled();
  });

  it('reserves once per paid action, settles to the recorded cost, and never charges a replay or a status check', async () => {
    const h = harness();
    h.analyze.mockResolvedValueOnce({ items: [{ name: 'Samosas' }], usage: { estimatedTokenUsd: 0.02, webResearch: { estimatedUsd: 0.016 } } });
    await h.request({ hint: 'six samosas' });
    await h.request({ hint: 'six samosas' });
    await h.request({ hint: 'six samosas', progress: true }).then(response => response.text());
    // The serving fake reports no cost, so its reservation stands.
    await h.request(serving);
    const status = await (await h.request({ action: 'status' })).json();
    expect(status).toMatchObject({ attemptsUsed: 2, globalLimitReached: false, aiEnabled: true });
    expect(h.budget.claim).toHaveBeenCalledTimes(2);
    expect(h.budget.claims.size).toBe(2);
    expect(h.budget.committedUsd('2026-09-05')).toBeCloseTo(0.036 + RESERVE_USD['interpret-serving'], 5);
    expect(h.analyze).toHaveBeenCalledOnce();
  });

  it('stops paid calls for everyone at the budget, without using up anyone’s own count', async () => {
    // Room for two meal reservations, not three.
    const h = harness({}, 0.85);
    expect((await h.request({ hint: 'first meal' })).status).toBe(200);
    expect((await h.request({ hint: 'friend meal' }, 'friend')).status).toBe(200);
    const refused = await h.request({ hint: 'second meal' });
    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({ code: 'global_quota_exhausted', error: expect.stringContaining('everyone') });
    expect(h.analyze).toHaveBeenCalledTimes(2);
    // Refused before any claim: this account still has two of its three left.
    expect(slots(h)).toHaveLength(1);
    // A cheaper action still fits.
    expect((await h.request(serving)).status).toBe(200);
    // An earlier result still replays at the ceiling, free.
    expect(await (await h.request({ hint: 'first meal' })).json()).toMatchObject({ replayed: true });
    expect(await (await h.request({ action: 'status' })).json()).toMatchObject({ globalLimitReached: true });
    // The next UTC date starts over.
    h.setTime(Date.parse('2026-09-06T00:00:01Z'));
    expect((await h.request({ hint: 'second meal' })).status).toBe(200);
    expect(h.analyze).toHaveBeenCalledTimes(3);
  });

  it('frees the unused part of a reservation for the next request', async () => {
    const h = harness({}, 0.85);
    h.analyze.mockResolvedValue({ items: [{ name: 'Meal' }], usage: { estimatedTokenUsd: 0.05, webResearch: { estimatedUsd: 0 } } });
    for (const meal of ['one', 'two', 'three', 'four']) expect((await h.request({ hint: `meal ${meal}` }, meal === 'one' ? 'valid' : 'friend')).status).toBe(200);
    expect(h.budget.committedUsd('2026-09-05')).toBeCloseTo(0.2, 6);
  });

  it('never reserves past the budget under concurrent requests from many accounts', async () => {
    const h = harness({}, 1);
    // Every request passes the up-front check before any claim lands.
    h.budget.status = vi.fn(async () => ({ enabled: true, budgetUsd: 1, committedUsd: 0 }));
    const tokens = ['valid', 'friend', 'other'];
    const responses = await Promise.all(Array.from({ length: 9 }, (_, index) => h.request({ hint: `meal number ${index}` }, tokens[index % 3])));
    const statuses = responses.map(response => response.status);
    // $0.40 each: two fit in $1.00, a third would not.
    expect(statuses.filter(status => status === 200)).toHaveLength(2);
    expect(statuses.filter(status => status === 429)).toHaveLength(7);
    expect(h.analyze).toHaveBeenCalledTimes(2);
    expect(h.budget.committedUsd('2026-09-05')).toBeLessThanOrEqual(1);
    // A refusal after a claim is saved and replays, never becoming a paid call.
    const refusedIndex = statuses.findIndex(status => status === 429);
    const again = await h.request({ hint: `meal number ${refusedIndex}` }, tokens[refusedIndex % 3]);
    expect(again.status).toBe(429);
    expect(await again.json()).toMatchObject({ replayed: true });
    expect(h.analyze).toHaveBeenCalledTimes(2);
  });

  it('keeps spending within the budget when every request costs up to its reservation', async () => {
    const h = harness({ maxAttempts: 40 }, 2);
    h.budget.status = vi.fn(async () => ({ enabled: true, budgetUsd: 2, committedUsd: 0 }));
    let spent = 0;
    let call = 0;
    h.analyze.mockImplementation(async () => {
      // Spread from free to the full reservation, the same on every run.
      const cost = ((call++ * 37) % 101) / 100 * RESERVE_USD['food-analysis'];
      spent += cost;
      return { items: [{ name: 'Meal' }], usage: { estimatedTokenUsd: cost } };
    });
    const tokens = ['valid', 'friend', 'other'];
    await Promise.all(Array.from({ length: 60 }, (_, index) => h.request({ hint: `meal number ${index}` }, tokens[index % 3])));
    expect(spent).toBeLessThanOrEqual(2);
    // Recorded in whole millionths of a dollar, rounded up.
    expect(h.budget.committedUsd('2026-09-05')).toBeCloseTo(spent, 3);
  });

  it('stops every paid call at once when AI is switched off, and still replays saved results', async () => {
    const h = harness();
    expect((await h.request({ hint: 'first meal' })).status).toBe(200);
    h.budget.setEnabled(false);
    const paused = await h.request({ hint: 'second meal' });
    expect(paused.status).toBe(503);
    expect(await paused.json()).toMatchObject({ code: 'analysis_paused' });
    expect((await h.request(serving)).status).toBe(503);
    expect(slots(h)).toHaveLength(1);
    expect(await (await h.request({ hint: 'first meal' })).json()).toMatchObject({ replayed: true });
    expect(await (await h.request({ action: 'status' })).json()).toMatchObject({ aiEnabled: false });
    // Switched back on: the refused meal was never counted, so it runs.
    h.budget.setEnabled(true);
    expect((await h.request({ hint: 'second meal' })).status).toBe(200);
    expect(h.analyze).toHaveBeenCalledTimes(2);
  });

  it('fails closed, without a paid call, when the budget cannot be read or claimed', async () => {
    const h = harness();
    h.budget.status = vi.fn(async () => { throw new Error('rpc down'); });
    expect((await h.request({ hint: 'first meal' })).status).toBe(503);
    expect(h.ledger.insert).not.toHaveBeenCalled();
    // The status check still answers; it just leaves the shared parts out.
    const status = await (await h.request({ action: 'status' })).json();
    expect(status).toMatchObject({ attemptsUsed: 0 });
    expect(status).not.toHaveProperty('globalLimitReached');
    expect(status).not.toHaveProperty('aiEnabled');

    const g = harness();
    g.budget.claim = vi.fn(async () => { throw new Error('rpc down'); });
    const failed = await g.request({ hint: 'first meal', progress: true });
    expect(failed.status).toBe(503);
    expect(failed.headers.get('content-type')).toBe('application/json');
    // The claimed attempt stays counted and replays its outcome; no paid call ever ran.
    expect(await (await g.request({ hint: 'first meal' })).json()).toMatchObject({ code: 'analysis_unavailable', replayed: true });
    expect(g.analyze).not.toHaveBeenCalled();
  });

  it('keeps the reservation when settling fails', async () => {
    const h = harness();
    h.budget.settle = vi.fn(async () => { throw new Error('rpc down'); });
    h.analyze.mockResolvedValueOnce({ items: [{ name: 'Meal' }], usage: { estimatedTokenUsd: 0.01 } });
    expect((await h.request({ hint: 'first meal' })).status).toBe(200);
    expect(h.budget.committedUsd('2026-09-05')).toBeCloseTo(RESERVE_USD['food-analysis'], 6);
  });
});

describe('recorded cost of a request', () => {
  it('adds model and web research cost, and is unknown when any part is', () => {
    expect(recordedCostUsd({ estimatedTokenUsd: 0.02, webResearch: { estimatedUsd: 0.016 } })).toBeCloseTo(0.036, 9);
    expect(recordedCostUsd({ estimatedTokenUsd: 0.001 })).toBe(0.001);
    expect(recordedCostUsd({ estimatedTokenUsd: null, knownEstimatedTokenUsd: 0.01 })).toBeNull();
    expect(recordedCostUsd({ estimatedTokenUsd: 0.02, webResearch: {} })).toBeNull();
    expect(recordedCostUsd({ estimatedTokenUsd: -1 })).toBeNull();
    expect(recordedCostUsd(undefined)).toBeNull();
  });
});
