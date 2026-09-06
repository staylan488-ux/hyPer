import { describe, expect, it, vi } from 'vitest';
import { FOOD_TRIAL_MODEL } from '../supabase/functions/analyze-food-trial/model';
import { getServingOptions, interpretServing, normalizeServingInput, resolveServingInterpretation, type ServingFood, type ServingInput } from '../supabase/functions/analyze-food-trial/serving';

const pieces: ServingFood = { name: 'Dumplings', serving_size: 5, serving_unit: 'pieces' };
const metric: ServingFood = { name: 'Dumplings', serving_size: 100, serving_unit: 'g', serving_label: '5 pieces (100 g)' };
const input: ServingInput = { action: 'interpret-serving', text: 'I ate 6 pieces', food: pieces };
const resolved = { status: 'resolved', quantity: 6, optionId: 'defined', message: '' };
const envelope = (result: unknown, finishReason = 'STOP') => ({ candidates: [{ finishReason, content: { parts: [{ thought: true, text: 'private reasoning' }, { text: JSON.stringify(result) }] } }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20 } });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

describe('deterministic serving interpretation', () => {
  it('normalizes only bounded serving fields, excluding supplied nutrients and instructions', () => {
    expect(normalizeServingInput({ ...input, food: { ...pieces, name: ' Dumplings ', calories: 999 }, secret: 'ignored' })).toEqual(input);
    for (const bad of [0, -1, NaN, Infinity, '5', 100001]) {
      expect(() => normalizeServingInput({ ...input, food: { ...pieces, serving_size: bad } })).toThrow('valid food serving');
    }
    for (const body of [{ ...input, action: 'analyze' }, { ...input, text: '' }, { ...input, text: 'a'.repeat(1001) }, { ...input, food: { ...pieces, serving_unit: '' } }, { ...input, food: { ...pieces, serving_label: 5 } }]) {
      expect(() => normalizeServingInput(body)).toThrow();
    }
  });
  it('computes six of five pieces as 1.2 existing nutrition servings, ignoring model arithmetic', () => {
    expect(resolveServingInterpretation(pieces, { ...resolved, servings: 900, calories: 5 })).toEqual({ status: 'resolved', quantity: 6, optionId: 'defined', servings: 1.2, unit: 'piece', basisQuantity: 5 });
    expect(resolveServingInterpretation(pieces, { ...resolved, quantity: 2.5 })).toMatchObject({ servings: 0.5 });
    expect(resolveServingInterpretation(pieces, { ...resolved, quantity: 0.5, optionId: 'serving' })).toMatchObject({ servings: 0.5, basisQuantity: 1, unit: 'serving' });
  });
  it('retains an explicit household count alongside the metric serving basis', () => {
    expect(getServingOptions(metric)).toEqual(expect.arrayContaining([
      { id: 'serving', quantity: 1, unit: 'serving' }, { id: 'defined', quantity: 100, unit: 'g' }, { id: 'label', quantity: 5, unit: 'piece' },
    ]));
    expect(resolveServingInterpretation(metric, { ...resolved, optionId: 'label' })).toMatchObject({ servings: 1.2, basisQuantity: 5 });
    expect(resolveServingInterpretation(metric, { ...resolved, quantity: 150 })).toMatchObject({ servings: 1.5 });
    const kilograms = resolveServingInterpretation(metric, { ...resolved, quantity: 0.15, optionId: 'metric-kg' });
    expect(kilograms.status === 'resolved' && kilograms.servings).toBeCloseTo(1.5);
    expect(getServingOptions({ ...pieces, serving_label: '5 pieces (100 g)' })).toContainEqual({ id: 'label-metric', quantity: 100, unit: 'g' });
  });
  it('parses fractional labels without inventing density or an average item size', () => {
    for (const label of ['1/2 cup', '½ cup']) expect(getServingOptions({ ...metric, serving_label: label })).toContainEqual({ id: 'label', quantity: 0.5, unit: 'cup' });
    expect(getServingOptions({ ...metric, serving_label: '1 1/2 cups (100 grams)' })).toContainEqual({ id: 'label', quantity: 1.5, unit: 'cup' });
    expect(getServingOptions({ name: 'Milk', serving_size: 250, serving_unit: 'ml' })).toEqual([
      { id: 'serving', quantity: 1, unit: 'serving' }, { id: 'defined', quantity: 250, unit: 'ml' }, { id: 'metric-l', quantity: 0.25, unit: 'l' },
    ]);
    for (const label of ['about 5 pieces', '5-6 pieces', '5 pieces per package', '5 servings per container', '5 pieces (120 g)', '5 pieces (100 ml)', '0 pieces', '1/0 cup']) {
      expect(getServingOptions({ ...metric, serving_label: label }).some(option => option.id === 'label')).toBe(false);
    }
    expect(getServingOptions({ ...metric, serving_label: undefined }).some(option => option.unit === 'piece' || option.unit === 'ml')).toBe(false);
  });
  it('does not create a competing definition of a nutrition serving', () => {
    expect(getServingOptions({ name: 'Food', serving_size: 2, serving_unit: 'servings' })).toEqual([{ id: 'serving', quantity: 1, unit: 'serving' }]);
  });
  it('asks for clarification for unsupported units, invalid numbers and ambiguous model output', () => {
    for (const raw of [null, [], {}, { ...resolved, optionId: 'guessed-handful' }, ...[0, -1, NaN, Infinity, '6', 100001].map(quantity => ({ ...resolved, quantity })), { ...resolved, quantity: 5001 }]) {
      expect(resolveServingInterpretation(pieces, raw).status).toBe('clarification');
    }
    expect(resolveServingInterpretation(pieces, { status: 'clarification', message: 'How many pieces did you eat?' })).toEqual({ status: 'clarification', message: 'How many pieces did you eat?' });
    expect(resolveServingInterpretation(pieces, { status: 'clarification', message: 'a'.repeat(181) })).not.toHaveProperty('message', 'a'.repeat(181));
  });
});

describe('single-call Gemini serving adapter', () => {
  it('uses the existing exact model and REST schema without research, retries or model-supplied nutrition', async () => {
    const fetcher = vi.fn().mockResolvedValue(json(envelope(resolved)));
    const result = await interpretServing(input, 'fixture-key', fetcher);
    expect(result).toMatchObject({ provider: 'gemini', model: FOOD_TRIAL_MODEL, interpretation: { servings: 1.2 }, usage: { promptTokens: 100, outputTokens: 20, modelCalls: 1 } });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${FOOD_TRIAL_MODEL}:generateContent`);
    expect(init.headers).toMatchObject({ 'x-goog-api-key': 'fixture-key' });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const request = JSON.parse(init.body);
    expect(request.store).toBe(false);
    expect(request).not.toHaveProperty('tools');
    expect(request.generationConfig).toMatchObject({ thinkingConfig: { thinkingLevel: 'MEDIUM' }, responseFormat: { text: { mimeType: 'APPLICATION_JSON' } } });
    expect(Object.keys(request.generationConfig.responseFormat.text.schema.properties)).toEqual(['status', 'quantity', 'optionId', 'message']);
    expect(JSON.parse(request.contents[0].parts[0].text)).toEqual({ text: input.text, food: pieces, servingOptions: getServingOptions(pieces) });
  });
  it('returns an editable clarification without guessing or a second model call', async () => {
    const fetcher = vi.fn().mockResolvedValue(json(envelope({ status: 'clarification', quantity: null, optionId: null, message: 'How many pieces did you eat?' })));
    expect(await interpretServing({ ...input, text: 'a few' }, 'fixture-key', fetcher)).toMatchObject({ interpretation: { status: 'clarification', message: 'How many pieces did you eat?' } });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('rejects blocked, oversized and malformed output without retrying', async () => {
    for (const response of [json(envelope(resolved, 'MAX_TOKENS')), new Response('x'.repeat(64001)), new Response('not JSON'), json(envelope('not an interpretation'))]) {
      const fetcher = vi.fn().mockResolvedValue(response);
      const result = await interpretServing(input, 'fixture-key', fetcher).catch(error => error);
      expect(result instanceof Error || result.interpretation.status === 'clarification').toBe(true);
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
  it('sanitizes upstream and timeout errors, accounts for the call and never retries', async () => {
    for (const fetcher of [vi.fn().mockResolvedValue(json({ error: { message: 'PRIVATE PROVIDER DATA' } }, 429)), vi.fn().mockRejectedValue(new DOMException('PRIVATE URL', 'TimeoutError'))]) {
      const result = await interpretServing(input, 'fixture-key', fetcher).catch(error => error);
      expect(result).toBeInstanceOf(Error);
      expect(result.message).not.toContain('PRIVATE');
      expect(result.usage.modelCalls).toBe(1);
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
  it('validates input and configuration before dispatch', async () => {
    const fetcher = vi.fn();
    await expect(interpretServing(input, '', fetcher)).rejects.toThrow('not configured');
    await expect(interpretServing({ ...input, text: '' }, 'fixture-key', fetcher)).rejects.toThrow('valid food');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
