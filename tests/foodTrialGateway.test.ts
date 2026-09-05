import { describe, expect, it, vi } from 'vitest';
import { ANALYSIS_VERSION, createTrialHandler, normalizeInput, validateConfig } from '../supabase/functions/analyze-food-trial/gateway';
import type { MealInput, TrialConfig, TrialLedger } from '../supabase/functions/analyze-food-trial/gateway';
import { createStorageLedger } from '../supabase/functions/analyze-food-trial/storageLedger';

const USER = '11111111-1111-4111-8111-111111111111';
const FRIEND = '22222222-2222-4222-8222-222222222222';
const NOW = Date.parse('2026-09-05T12:00:00Z');
const config: TrialConfig = {
  maxAttempts: 3, allowedOrigins: ['http://localhost:5173', 'capacitor://localhost'],
};
const photo = { angle: 'top', mimeType: 'image/jpeg', imageBase64: btoa('\xff\xd8\xffmeal') };

function harness(overrides: Partial<TrialConfig> = {}) {
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
  const analyze = vi.fn<(input: MealInput) => Promise<Record<string, unknown>>>(async () => ({ items: [{ name: 'Meal' }], usage: { inputTokens: 20, outputTokens: 10, thinkingTokens: 5 } }));
  const authenticate = vi.fn(async token => token === 'friend' ? FRIEND : token === 'valid' ? USER : token === 'other' ? '33333333-3333-4333-8333-333333333333' : null);
  let time = NOW;
  const handler = createTrialHandler({ config: { ...config, ...overrides }, ledger, analyze, authenticate, now: () => time });
  const request = (body: unknown, token = 'valid', origin = 'capacitor://localhost') => handler(new Request('http://trial', {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', origin }, body: JSON.stringify(body),
  }));
  return { objects, ledger, analyze, authenticate, handler, request, setTime: (value: number) => { time = value; } };
}

describe('authenticated food analysis gateway', () => {
  it('fails closed on broad origins or excessive daily request limits', () => {
    for (const override of [{ maxAttempts: 41 }, { maxAttempts: 0 }, { maxAttempts: 1.5 }, { allowedOrigins: ['*'] }]) {
      expect(() => validateConfig({ ...config, ...override })).toThrow();
    }
    expect(() => validateConfig(config)).not.toThrow();
  });

  it('accepts any normally authenticated user and rejects unsigned requests/origins before storage or model access', async () => {
    const h = harness();
    expect((await h.request({ hint: 'six samosas' }, 'bad')).status).toBe(401);
    expect((await h.request({ hint: 'six samosas' }, 'valid', 'https://evil.example')).status).toBe(403);
    expect(h.ledger.assertPrivate).not.toHaveBeenCalled();
    for (const token of ['valid', 'friend', 'other']) {
      const response = await h.request({ hint: 'six samosas' }, token);
      expect(response.status).toBe(200);
      expect(response.headers.get('access-control-allow-origin')).toBe('capacitor://localhost');
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
    expect(h.analyze).toHaveBeenCalledTimes(3);
  });

  it('allows authenticated text-only and photo-only meals without storing submitted payloads', async () => {
    const h = harness();
    expect((await h.request({ hint: '  six chicken samosas  ' })).status).toBe(200);
    expect(h.analyze).toHaveBeenNthCalledWith(1, { images: [], hint: 'six chicken samosas' });
    expect((await h.request({ images: [photo] })).status).toBe(200);
    expect(h.analyze).toHaveBeenNthCalledWith(2, { images: [photo], hint: '' });
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

  it('bounds streamed bodies even without content-length and rejects invalid JSON/method', async () => {
    const h = harness();
    const headers = { authorization: 'Bearer valid', 'content-type': 'application/json' };
    const huge = new Request('http://trial', { method: 'POST', headers, body: ' '.repeat(9_000_001) });
    expect((await h.handler(huge)).status).toBe(413);
    expect((await h.handler(new Request('http://trial', { method: 'POST', headers, body: '{bad' }))).status).toBe(400);
    expect((await h.handler(new Request('http://trial'))).status).toBe(405);
    expect((await h.handler(new Request('http://trial', { method: 'OPTIONS', headers: { origin: 'capacitor://localhost' } }))).status).toBe(204);
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
