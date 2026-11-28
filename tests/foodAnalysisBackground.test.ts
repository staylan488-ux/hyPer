import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/preview/flag', () => ({ isPreviewActive: () => false }));

import { advanceTrail, startTrail } from '@/lib/analysisProgress';
import {
  createFoodAnalysisActivitySync,
  foodAnalysisClarifyPayload,
  foodAnalysisFailedPayload,
  foodAnalysisMealLabel,
  foodAnalysisReadyPayload,
  foodAnalysisRunningPayload,
  type FoodAnalysisActivityPayload,
} from '@/lib/foodAnalysisActivitySync';
import {
  FOOD_ANALYSIS_VERSION,
  analyzeFoodTrial,
  checkFoodTrialResult,
  mealRequestId,
  previewFoodTrialResult,
  type FoodTrialRecovery,
} from '@/lib/foodTrial';
import { ANALYSIS_VERSION, createTrialHandler, type TrialLedger } from '../supabase/functions/analyze-food-trial/gateway';
import { memoryBudget } from './helpers/memoryBudget';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const sse = (events: unknown[]) =>
  new Response(
    new ReadableStream({
      start(controller) {
        const text = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');
        controller.enqueue(new TextEncoder().encode(text));
        controller.close();
      },
    }),
    { headers: { 'content-type': 'text/event-stream; charset=utf-8' } },
  );

describe('mealRequestId parity with analyze-food-trial gateway', () => {
  it('stays in lockstep with gateway ANALYSIS_VERSION and produces the exact ledger requestId', async () => {
    expect(FOOD_ANALYSIS_VERSION).toBe(ANALYSIS_VERSION);

    const USER = '11111111-1111-4111-8111-111111111111';
    const objects = new Map<string, unknown>();
    const ledger: TrialLedger = {
      assertPrivate: async () => {},
      insert: async (path, value) => {
        if (objects.has(path)) return false;
        objects.set(path, structuredClone(value));
        return true;
      },
      read: async (path) => objects.get(path) ?? null,
    };
    const handler = createTrialHandler({
      config: { maxAttempts: 10, allowedOrigins: [] },
      ledger,
      authenticate: async () => USER,
      access: async () => ({ approved: true, dailyLimit: 10 }),
      budget: memoryBudget(10),
      analyze: async () => previewFoodTrialResult,
      now: () => Date.parse('2026-11-27T12:00:00Z'),
    });

    const topPhoto = { angle: 'top' as const, mimeType: 'image/jpeg', imageBase64: btoa('\xff\xd8\xfftop-plate') };
    const sidePhoto = { angle: 'side' as const, mimeType: 'image/jpeg', imageBase64: btoa('\xff\xd8\xffside-plate') };

    const cases = [
      { images: [], hint: '  Six Trader Joe’s samosas  ', clarificationUsed: false },
      { images: [topPhoto], hint: 'café bowl', clarificationUsed: false },
      { images: [topPhoto, sidePhoto], hint: 'Chicken and rice\nQuestion: Sauce?\nAnswer: Teriyaki', clarificationUsed: true },
    ];

    for (const meal of cases) {
      const clientHash = await mealRequestId(meal);
      expect(clientHash).toMatch(/^[0-9a-f]{64}$/);
      const response = await handler(
        new Request('http://trial', {
          method: 'POST',
          headers: { authorization: 'Bearer tok', 'content-type': 'application/json' },
          body: JSON.stringify(meal),
        }),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as { requestId: string };
      expect(clientHash).toBe(body.requestId);

      // Verify the read-only status endpoint finds the exact saved result under that hash.
      const statusResponse = await handler(
        new Request('http://trial', {
          method: 'POST',
          headers: { authorization: 'Bearer tok', 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'status', requestId: clientHash }),
        }),
      );
      expect(statusResponse.status).toBe(200);
      expect((await statusResponse.json()) as { replayed: boolean }).toMatchObject({ replayed: true, requestId: clientHash });
    }
  });
});

describe('background-resilient Gemini food analysis recovery', () => {
  it('polls the read-only status endpoint after a dropped SSE stream and returns the completed estimate', async () => {
    const expectedId = await mealRequestId({ images: [], hint: 'six samosas' });
    const bodies: Record<string, unknown>[] = [];
    const fetcher = vi.fn(async (_url: string, init: { body: string }) => {
      const parsed = JSON.parse(init.body) as Record<string, unknown>;
      bodies.push(parsed);
      if (bodies.length === 1) {
        // Stream drops mid-analysis (for example after switching apps).
        return sse([{ type: 'progress', step: 'look' }, { type: 'progress', step: 'search', products: ['Samosas'] }]);
      }
      if (bodies.length === 2) {
        return new Response(JSON.stringify({ code: 'analysis_pending', error: 'Still running.', requestId: expectedId }), { status: 409 });
      }
      return new Response(JSON.stringify({ ...previewFoodTrialResult, replayed: true }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetcher);

    const steps: unknown[] = [];
    const recover: FoodTrialRecovery = {
      getAccessToken: async () => 'fresh-token',
      isBackgroundSuspended: () => false,
      waitForForeground: async () => {},
      wasBackgrounded: () => true,
      pollIntervalMs: 1,
    };

    const result = await analyzeFoodTrial({
      images: [],
      hint: 'six samosas',
      accessToken: 'initial-token',
      onProgress: (step) => steps.push(step),
      recover,
    });

    expect(result.items[0].name).toBe(previewFoodTrialResult.items[0].name);
    expect(steps).toEqual([{ step: 'look' }, { step: 'search', products: ['Samosas'] }]);
    // First call started the meal; follow-ups were strictly read-only status checks.
    expect(bodies).toEqual([
      { images: [], hint: 'six samosas', progress: true },
      { action: 'status', requestId: expectedId },
      { action: 'status', requestId: expectedId },
    ]);
  });

  it('pauses cleanly when iOS suspends the background task and collects the saved estimate on return with a refreshed token', async () => {
    let suspended = true;
    let resumeForeground!: () => void;
    const waited = new Promise<void>((resolve) => {
      resumeForeground = resolve;
    });
    const tokens: string[] = [];
    const fetcher = vi.fn(async (_url: string, init: { headers: Record<string, string>; body: string }) => {
      tokens.push(init.headers.Authorization);
      if (tokens.length === 1) throw new TypeError('The network connection was lost.');
      return new Response(JSON.stringify({ ...previewFoodTrialResult, replayed: true }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetcher);

    const getAccessToken = vi.fn(async () => 'refreshed-token');
    const pending = analyzeFoodTrial({
      images: [],
      hint: 'two eggs on toast',
      accessToken: 'stale-token',
      onProgress: () => {},
      recover: {
        getAccessToken,
        isBackgroundSuspended: () => suspended,
        waitForForeground: () => waited,
        wasBackgrounded: () => true,
        pollIntervalMs: 1,
      },
    });

    // Initial fetch runs and fails while suspended; no status requests fire until foreground.
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(getAccessToken).not.toHaveBeenCalled();

    // User switches back from YouTube.
    suspended = false;
    resumeForeground();

    const result = await pending;
    expect(result.items).toHaveLength(1);
    expect(getAccessToken).toHaveBeenCalledOnce();
    expect(tokens).toEqual(['Bearer stale-token', 'Bearer refreshed-token']);
  });

  it('attaches smoothly when an initial request answers 409 analysis_pending', async () => {
    const serverId = 'a'.repeat(64);
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: { body: string }) => {
        calls += 1;
        const parsed = JSON.parse(init.body) as Record<string, unknown>;
        if (calls === 1) {
          return new Response(JSON.stringify({ code: 'analysis_pending', error: 'Running', requestId: serverId }), { status: 409 });
        }
        expect(parsed).toEqual({ action: 'status', requestId: serverId });
        return new Response(JSON.stringify({ ...previewFoodTrialResult, replayed: true }), { status: 200 });
      }),
    );

    const result = await analyzeFoodTrial({
      images: [],
      hint: 'chicken bowl',
      accessToken: 'tok',
      recover: {
        getAccessToken: async () => 'tok',
        isBackgroundSuspended: () => false,
        waitForForeground: async () => {},
        pollIntervalMs: 1,
      },
    });
    expect(result.items).toHaveLength(1);
    expect(calls).toBe(2);
  });

  it('surfaces a saved 502 server failure immediately during recovery', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls += 1;
        if (calls === 1) return sse([{ type: 'progress', step: 'look' }]);
        return new Response(JSON.stringify({ code: 'analysis_failed', error: 'Analysis did not finish successfully.' }), { status: 502 });
      }),
    );

    await expect(
      analyzeFoodTrial({
        images: [],
        hint: 'six samosas',
        accessToken: 'tok',
        onProgress: () => {},
        recover: {
          getAccessToken: async () => 'tok',
          isBackgroundSuspended: () => false,
          waitForForeground: async () => {},
          pollIntervalMs: 1,
        },
      }),
    ).rejects.toThrow('Analysis did not finish successfully.');
    expect(calls).toBe(2);
  });

  it('stops recovery immediately when cancelled by caller AbortSignal', async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => sse([{ type: 'progress', step: 'look' }])),
    );

    const promise = analyzeFoodTrial({
      images: [],
      hint: 'six samosas',
      accessToken: 'tok',
      onProgress: () => {},
      signal: controller.signal,
      recover: {
        getAccessToken: async () => 'tok',
        isBackgroundSuspended: () => true,
        waitForForeground: (signal) =>
          new Promise((_, reject) => {
            signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
          }),
      },
    });

    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    controller.abort();
    await expect(promise).rejects.toThrow();
  });

  it('checkFoodTrialResult distinguishes done, pending and not_found', async () => {
    const id = 'b'.repeat(64);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 'analysis_pending', error: 'Pending', requestId: id }), { status: 409 })));
    expect(await checkFoodTrialResult(id, 'tok')).toEqual({ status: 'pending', requestId: id });

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 'analysis_not_found', error: 'Missing' }), { status: 404 })));
    expect(await checkFoodTrialResult(id, 'tok')).toEqual({ status: 'not_found' });

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(previewFoodTrialResult), { status: 200 })));
    const done = await checkFoodTrialResult(id, 'tok');
    expect(done.status).toBe('done');
  });
});

describe('food analysis Live Activity sync & payload formatting', () => {
  const flush = async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  };

  it('orders updates, collapses rapid step changes, and never syncs after end()', async () => {
    const calls: Array<{ method: 'sync' | 'end'; payload?: FoodAnalysisActivityPayload }> = [];
    const pending: Array<() => void> = [];
    const activity = createFoodAnalysisActivitySync({
      sync: (payload) =>
        new Promise<void>((resolve) => {
          calls.push({ method: 'sync', payload });
          pending.push(resolve);
        }),
      end: () =>
        new Promise<void>((resolve) => {
          calls.push({ method: 'end' });
          pending.push(resolve);
        }),
    });

    activity.sync({ phase: 'running', title: 'Looking at your photo', detail: 'Meal photo', startedAtEpochMs: 1000 });
    await flush();
    activity.sync({ phase: 'running', title: 'Searching the web', detail: 'Samosas', startedAtEpochMs: 1000 });
    activity.sync({ phase: 'ready', title: 'Estimate ready', detail: 'Samosas · 12 g protein', startedAtEpochMs: 1000, calories: 360, itemCount: 1, alertTitle: 'Estimate ready', alertBody: '360 kcal · Samosas · 12 g protein' });
    pending[0]();
    await flush();

    expect(calls).toHaveLength(2);
    expect(calls[1].payload?.phase).toBe('ready');

    activity.sync({ phase: 'running', title: 'Stale step', detail: '', startedAtEpochMs: 1000 });
    activity.end();
    pending[1]();
    await flush();
    pending[2]?.();
    await flush();

    expect(calls.map((c) => c.method)).toEqual(['sync', 'sync', 'end']);
  });

  it('formats meal labels, real server steps and settled outcomes in Blanc style', () => {
    expect(foodAnalysisMealLabel('  Six samosas\nwith chutney ', 1)).toBe('Six samosas');
    expect(foodAnalysisMealLabel('', 1)).toBe('Meal photo');
    expect(foodAnalysisMealLabel('', 2)).toBe('2 meal photos');

    const trail = advanceTrail(startTrail({ photos: 1, hint: 'Samosas' }), { step: 'search', products: ['Trader Joe’s Samosas'] }, { photos: 1, hint: 'Samosas' });
    expect(foodAnalysisRunningPayload(trail, 5000, 'Samosas')).toEqual({
      phase: 'running',
      title: 'Searching the web',
      detail: 'Trader Joe’s Samosas',
      startedAtEpochMs: 5000,
    });

    // Single food with protein (6 pieces on 3-piece basis -> 360 kcal, 12 g protein).
    expect(foodAnalysisReadyPayload(previewFoodTrialResult, 5000, true)).toEqual({
      phase: 'ready',
      title: 'Estimate ready',
      detail: 'Example samosas (test fixture) · 12 g protein',
      startedAtEpochMs: 5000,
      calories: 360,
      itemCount: 1,
      alertTitle: 'Estimate ready',
      alertBody: '360 kcal · Example samosas (test fixture) · 12 g protein',
    });

    // Zero protein is omitted, matching Blanc's rule.
    const zeroProtein = {
      items: [
        { ...previewFoodTrialResult.items[0], name: 'Apple', quantity: 1, basisQuantity: 1, calories: 95, protein: 0.4 },
        { ...previewFoodTrialResult.items[0], name: 'Honey', quantity: 1, basisQuantity: 1, calories: 64, protein: 0 },
      ],
    };
    expect(foodAnalysisReadyPayload(zeroProtein, 5000, false)).toEqual({
      phase: 'ready',
      title: 'Estimate ready',
      detail: '2 foods',
      startedAtEpochMs: 5000,
      calories: 159,
      itemCount: 2,
    });

    expect(foodAnalysisClarifyPayload('What sauce was on the bowl?', 5000, true)).toMatchObject({
      phase: 'clarify',
      title: 'One quick detail',
      detail: 'What sauce was on the bowl?',
      alertTitle: 'One quick detail',
    });

    expect(foodAnalysisFailedPayload('Analysis didn’t finish', 'Tap to return to hyPer.', 5000, true)).toMatchObject({
      phase: 'failed',
      title: 'Analysis didn’t finish',
      alertTitle: 'Analysis didn’t finish',
    });
  });
});
