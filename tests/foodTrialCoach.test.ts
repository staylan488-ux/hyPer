import { describe, expect, it, vi } from 'vitest';

const hosted = vi.hoisted(() => ({
  mode: 'gemini' as 'gemini' | 'worker',
  ask: vi.fn(async () => ({ calories: 3000, protein_g: 150, carbs_g: 320, fat_g: 70, rationale: 'Eat more.', cautions: '', confidence: 0.6 })),
}));
vi.mock('@/lib/foodTrial', () => ({
  getFoodAnalysisMode: () => hosted.mode,
  requestHostedTargetSuggestion: hosted.ask,
}));
vi.mock('@/lib/patientFetch', () => ({ patientPost: vi.fn(async () => { throw new Error('worker reached'); }) }));

import { normalizeCoachInput, suggestTargets } from '../supabase/functions/analyze-food-trial/coach';
import { createTrialHandler, type TrialLedger } from '../supabase/functions/analyze-food-trial/gateway';
import { coachSource, requestTargetSuggestion } from '@/lib/nutritionCoach';

const USER = '11111111-1111-4111-8111-111111111111';
const context = {
  sex: 'male', age: 30, height_cm: 175, weight_kg: 59, activity: 'moderately_active',
  current_goal: 'bulk at 0.2% bodyweight/week', measured_expenditure_kcal: 2060, expenditure_confidence: 'learning',
  weight_trend_kg_per_week: 0.05, current_targets: { calories: 2160, protein: 140, carbs: 260, fat: 60 },
};
const body = { action: 'suggest-targets', goals: 'Gain muscle steadily while staying lean.', context };

function harness(maxAttempts = 2) {
  const objects = new Map<string, unknown>();
  const ledger: TrialLedger = {
    assertPrivate: vi.fn(async () => {}),
    insert: vi.fn(async (path, value) => {
      if (objects.has(path)) return false;
      objects.set(path, structuredClone(value));
      return true;
    }),
    read: vi.fn(async (path) => objects.get(path) ?? null),
  };
  const analyze = vi.fn(async () => ({ items: [] }));
  const suggest = vi.fn(async () => ({
    provider: 'gemini', model: 'gemini-3.8-flash',
    recommendation: { calories: 2500, protein_g: 150, carbs_g: 320, fat_g: 70, rationale: 'More food.', cautions: '', confidence: 0.6 },
  }));
  const handler = createTrialHandler({
    config: { maxAttempts, allowedOrigins: ['capacitor://localhost'] },
    ledger, analyze, suggestTargets: suggest,
    authenticate: async (token) => (token === 'valid' ? USER : null),
    now: () => Date.parse('2026-10-27T12:00:00Z'),
  });
  const request = (payload: unknown, token = 'valid') => handler(new Request('http://trial', {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(payload),
  }));
  return { analyze, suggest, request };
}

describe('target suggestions through the hosted Gemini gateway', () => {
  it('signs in, asks once, replays the same request and counts toward the daily limit', async () => {
    const h = harness(2);
    expect((await h.request(body, 'bad')).status).toBe(401);
    const first = await (await h.request(body)).json();
    expect(first).toMatchObject({ analysisVersion: 'gemini-coach-v1', recommendation: { calories: 2500 } });
    expect((await (await h.request(body)).json()).replayed).toBe(true);
    expect(h.suggest).toHaveBeenCalledOnce();
    expect(h.analyze).not.toHaveBeenCalled();
    expect((await h.request({ ...body, goals: 'Gain faster, I am fine with some fat.' })).status).toBe(200);
    expect((await h.request({ hint: 'rice and chicken' })).status).toBe(429);
  });

  it('rejects a short goal or a broken profile before any paid call', async () => {
    const h = harness();
    expect((await h.request({ ...body, goals: 'bulk' })).status).toBe(400);
    expect((await h.request({ ...body, context: { ...context, age: 'thirty' } })).status).toBe(400);
    expect(h.suggest).not.toHaveBeenCalled();
  });
});

describe('coach input and Gemini call', () => {
  it('keeps only checked context fields', () => {
    const input = normalizeCoachInput({ ...body, context: { ...context, extra: 'ignored', weight_kg: null } });
    expect(input.context).not.toHaveProperty('extra');
    expect(input.context.weight_kg).toBeNull();
    expect(() => normalizeCoachInput({ ...body, context: { ...context, measured_expenditure_kcal: 99999 } })).toThrow();
  });

  it('returns the numbers and words from Gemini’s JSON', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ calories: 2450, protein_g: 150, carbs_g: 310, fat_g: 70, rationale: 'A modest surplus.', cautions: '', confidence: 0.7 }) }] } }],
      usageMetadata: { promptTokenCount: 300, candidatesTokenCount: 80 },
    })));
    const result = await suggestTargets(normalizeCoachInput(body), 'key', fetcher as unknown as typeof fetch);
    expect(result.recommendation).toMatchObject({ calories: 2450, protein_g: 150, rationale: 'A modest surplus.' });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('turns a refused or cut-off answer into a counted failure', async () => {
    const cutOff = vi.fn(async () => new Response(JSON.stringify({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [] } }] })));
    await expect(suggestTargets(normalizeCoachInput(body), 'key', cutOff as unknown as typeof fetch)).rejects.toThrow('incomplete');
    const limited = vi.fn(async () => new Response('{}', { status: 429 }));
    await expect(suggestTargets(normalizeCoachInput(body), 'key', limited as unknown as typeof fetch)).rejects.toThrow('usage limit');
  });
});

describe('which coach answers', () => {
  const coachContext = { ...context, current_targets: null };
  it('asks Gemini when Food analysis is Gemini, and keeps the numbers honest', async () => {
    hosted.mode = 'gemini';
    expect(coachSource()).toBe('gemini');
    const result = await requestTargetSuggestion({ goals: 'Gain muscle steadily.', context: coachContext, accessToken: 't' });
    // 3,000 kcal disagrees with its own macros (2,510), so the macros win.
    expect(result).toMatchObject({ calories: 2510, provider: 'gemini', reconciled: true });
    expect(hosted.ask).toHaveBeenCalledWith('Gain muscle steadily.', coachContext, 't');
  });

  it('asks the Mac worker when Food analysis is Your Mac', async () => {
    hosted.mode = 'worker';
    hosted.ask.mockClear();
    await expect(requestTargetSuggestion({ goals: 'Gain muscle steadily.', context: coachContext, accessToken: 't' })).rejects.toThrow();
    expect(hosted.ask).not.toHaveBeenCalled();
  });
});
