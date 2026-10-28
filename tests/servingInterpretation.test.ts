import { describe, expect, it, vi } from 'vitest';
import { FOOD_TRIAL_MODEL } from '../supabase/functions/analyze-food-trial/model';
import { getServingOptions, interpretServing, normalizeServingInput, resolveServingInterpretation, resolveServingLocally, type ServingFood, type ServingInput } from '../supabase/functions/analyze-food-trial/serving';

const pieces: ServingFood = { name: 'Dumplings', serving_size: 5, serving_unit: 'pieces' };
const metric: ServingFood = { name: 'Dumplings', serving_size: 100, serving_unit: 'g', serving_label: '5 pieces (100 g)' };
const input: ServingInput = { action: 'interpret-serving', text: 'six of them, I think', food: pieces };
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
    expect(getServingOptions({ name: 'Milk', serving_size: 250, serving_unit: 'ml' }).map(option => option.unit)).toEqual(['serving', 'ml', 'l', 'tsp', 'tbsp', 'fl oz', 'cup']);
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

describe('plain amounts convert without Gemini', () => {
  const juice: ServingFood = { name: 'Pulp Free Orange Juice', serving_size: 1, serving_unit: 'serving', serving_label: '1 cup' };
  const servings = (food: ServingFood, text: string) => {
    const result = resolveServingLocally(food, text);
    return result?.status === 'resolved' ? result.servings : null;
  };
  it('converts kitchen and metric volumes against a 1 cup serving', () => {
    expect(servings(juice, '272 ML')).toBeCloseTo(1.1497, 3);
    expect(servings(juice, 'I drank 272ml.')).toBeCloseTo(1.1497, 3);
    expect(servings(juice, 'half a cup')).toBe(0.5);
    expect(servings(juice, '1 1/2 cups')).toBe(1.5);
    expect(servings(juice, '8 fl. oz.')).toBeCloseTo(1);
    expect(servings(juice, '2 tbsp')).toBeCloseTo(0.125);
    expect(servings(juice, '0.5 l')).toBeCloseTo(2.1134, 3);
  });
  it('reads ounces of a drink as fluid ounces and grams at about 1 g per ml, and says so', () => {
    expect(resolveServingLocally(juice, '8 oz')).toMatchObject({ servings: 1, unit: 'fl oz', assumption: 'Read “oz” as fluid ounces.' });
    expect(resolveServingLocally(juice, '300 g')).toMatchObject({ unit: 'ml', quantity: 300, assumption: 'Assumes 1 ml weighs about 1 g, like water.' });
  });
  it('treats a label beside a plain serving as that serving, with ounces beside a cup as fluid ounces', () => {
    expect(getServingOptions({ ...juice, serving_label: '1 cup (8 oz)' })).toEqual(expect.arrayContaining([
      { id: 'label', quantity: 1, unit: 'cup' }, { id: 'label-metric', quantity: 8, unit: 'fl oz' },
    ]));
    expect(servings({ ...juice, serving_label: '1 cup (240 mL)' }, '480 ml')).toBe(2);
    expect(getServingOptions({ ...juice, serving_label: '1 cup (400 ml)' }).some(option => option.id === 'label')).toBe(false);
  });
  it('converts weights, and never guesses a density for a solid', () => {
    const rice: ServingFood = { name: 'Rice', serving_size: 158, serving_unit: 'g', serving_label: '1 cup' };
    expect(servings(rice, '316 g')).toBe(2);
    expect(servings(rice, '1 lb')).toBeCloseTo(2.8708, 3);
    expect(servings({ name: 'Flour', serving_size: 30, serving_unit: 'g' }, '100 ml')).toBeNull();
  });
  it('leaves vague, mixed or unknown amounts to Gemini', () => {
    for (const text of ['some', 'a glass', '2 cups and a bit', 'a handful', 'six of them, I think', '5-6 pieces']) expect(resolveServingLocally(juice, text)).toBeNull();
    expect(resolveServingLocally(pieces, 'I ate 6 pieces')).toMatchObject({ servings: 1.2, unit: 'piece' });
  });
  it('takes a model density only from a resolved unit answer', () => {
    const milk: ServingFood = { name: 'Greek yogurt', serving_size: 170, serving_unit: 'g' };
    const result = resolveServingInterpretation(milk, { status: 'resolved', quantity: 1, unit: 'cup', densityGPerMl: 1.1, assumption: 'Assumes yogurt weighs about 1.1 g per ml.' });
    expect(result).toMatchObject({ unit: 'g', assumption: 'Assumes yogurt weighs about 1.1 g per ml.' });
    expect(result.status === 'resolved' && result.quantity).toBeCloseTo(260.25, 1);
    expect(resolveServingInterpretation(milk, { status: 'resolved', quantity: 1, unit: 'cup', densityGPerMl: 9 }).status).toBe('clarification');
    expect(resolveServingInterpretation(milk, { status: 'resolved', quantity: 1, unit: 'cup', densityGPerMl: null }).status).toBe('clarification');
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
    expect(Object.keys(request.generationConfig.responseFormat.text.schema.properties)).toEqual(['status', 'quantity', 'unit', 'densityGPerMl', 'assumption', 'message']);
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
  it('answers a plain amount without calling Gemini', async () => {
    const fetcher = vi.fn();
    expect(await interpretServing({ ...input, text: 'I ate 6 pieces' }, 'fixture-key', fetcher)).toMatchObject({ interpretation: { servings: 1.2 } });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('validates input and configuration before dispatch', async () => {
    const fetcher = vi.fn();
    await expect(interpretServing(input, '', fetcher)).rejects.toThrow('not configured');
    await expect(interpretServing({ ...input, text: '' }, 'fixture-key', fetcher)).rejects.toThrow('valid food');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
