import { describe, it, expect, vi, afterEach } from 'vitest';
import { analyzeMeal, buildMealRequest, mealUsage, parseMealResponse, trialFoodTotals, validateTrialItems, MealAnalysisError } from '../supabase/functions/analyze-food-trial/model';
const input = { images: [], hint: 'six Fixture samosas' };
const labelText = 'Fixture samosas\nServing 3 pieces\nCalories 180\nProtein 6 g\nCarbs 24 g\nFat 7 g';
const source = { title: 'Manufacturer', url: 'https://example.com/samosas', description: 'Fixture samosas', content: labelText };
const labelSupport = { origin: 'web', sourceIndex: 0, productQuote: 'Fixture samosas', servingQuote: 'Serving 3 pieces', caloriesQuote: 'Calories 180', proteinQuote: 'Protein 6 g', carbsQuote: 'Carbs 24 g', fatQuote: 'Fat 7 g' };
const item = { productIndex: 0, name: 'Fixture samosas', quantity: 6, unit: 'piece', basisQuantity: 3, calories: 180, protein: 6, carbs: 24, fat: 7, evidence: 'label', notes: 'Six pieces reported; preparation not specified.', amountQuote: 'six Fixture samosas', labelSupport };
const meal = (items: unknown[] = [item], summary = 'Six pieces ready to review.') => ({ summary, clarification: null, items });
const usageMetadata = { promptTokenCount: 5000, candidatesTokenCount: 1000, thoughtsTokenCount: 1000, cachedContentTokenCount: 0, totalTokenCount: 7000, toolUsePromptTokenCount: 0 };
const envelope = (body: unknown, extra = {}) => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ thought: true, text: 'hidden thoughts' }, { text: JSON.stringify(body) }] } }], usageMetadata, ...extra });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const plan = { products: [{ brand: 'Fixture', product: 'samosas', variant: '' }], clarification: null };
function researchFetch(final = meal()) {
  return vi.fn()
    .mockResolvedValueOnce(json(envelope(plan)))
    .mockResolvedValueOnce(json({ results: [{ title: source.title, url: source.url, content: source.description }], usage: { credits: 1 } }))
    .mockResolvedValueOnce(json(envelope({ sourceIndexes: [0], clarification: null })))
    .mockResolvedValueOnce(json({ results: [{ url: source.url, raw_content: `${labelText}\nPRIVATE FULL PAGE MARKER` }], usage: { credits: 0 } }))
    .mockResolvedValueOnce(json(envelope(final)));
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });
describe('Gemini + independent web food pipeline', () => {
  it('uses exact REST format with medium reasoning, no Google grounding or unsupported sampling', () => {
    const body = buildMealRequest(input);
    expect(body.contents[0].parts[0]).toEqual({ text: input.hint });
    expect(body).not.toHaveProperty('tools');
    expect(body.store).toBe(false);
    expect(body.generationConfig).toMatchObject({ thinkingConfig: { thinkingLevel: 'MEDIUM' }, maxOutputTokens: 8192, responseFormat: { text: { mimeType: 'APPLICATION_JSON' } } });
    expect(body.generationConfig).not.toHaveProperty('temperature');
    expect(body.generationConfig.responseFormat.text.schema.properties.clarification).toMatchObject({ type: 'null' });
  });
  it('uses a simpler final wire grammar while enforcing bounds locally', () => {
    const schema = JSON.stringify(buildMealRequest(input).generationConfig.responseFormat.text.schema);
    expect(schema).not.toMatch(/minimum|maximum|maxItems/);
    expect(() => validateTrialItems(Array.from({ length: 13 }, () => item))).toThrow('food list');
    expect(() => validateTrialItems([{ ...item, calories: 10001 }])).toThrow('nutrition numbers');
    expect(() => validateTrialItems([{ ...item, quantity: 0 }])).toThrow('portion basis');
  });
  it('preserves bounded finalizer error diagnostics and usage without provider text or retries', async () => {
    const upstream = { error: { code: 400, status: 'INVALID_ARGUMENT', message: 'Response schema is too complex. PRIVATE PROMPT gemini-key https://private.example/full-page' } };
    const fetcher = vi.fn().mockResolvedValueOnce(json(envelope({ products: [], clarification: null }))).mockResolvedValueOnce(json(upstream, 400));
    vi.stubGlobal('fetch', fetcher);
    const error = await analyzeMeal(input, 'gemini-key', 'tavily-key').catch(e => e) as MealAnalysisError;
    expect(error.diagnostic).toEqual({ provider: 'gemini', phase: 'finalizer', httpStatus: 400, status: 'INVALID_ARGUMENT', category: 'schema_complexity' });
    expect(error.usage).toMatchObject({ modelCalls: 2, estimatedTokenUsd: null, knownEstimatedTokenUsd: 0.01125 });
    expect(JSON.stringify(error)).not.toMatch(/PRIVATE|gemini-key|private.example|too complex/);
    expect(error.message).not.toContain('schema');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('sends photos with description to Gemini', () => {
    const body = buildMealRequest({ hint: 'a plate', images: [{ angle: 'top', imageBase64: 'AAAA', mimeType: 'image/jpeg' }] });
    expect(body.contents[0].parts).toContainEqual({ inlineData: { data: 'AAAA', mimeType: 'image/jpeg' } });
  });
  it('preserves label serving values, deterministic arithmetic and explicit user amount', () => {
    const result = parseMealResponse(envelope(meal()), new Date(), 0, input, [source]);
    expect(result.items[0]).toMatchObject({ evidence: 'label', sourceIndexes: [0], amountConfirmed: true });
    expect(trialFoodTotals(result.items[0])).toEqual({ calories: 360, protein: 12, carbs: 48, fat: 14 });
    expect(trialFoodTotals({ ...result.items[0], quantity: 4.5 })).toEqual({ calories: 270, protein: 9, carbs: 36, fat: 10.5 });
    expect(result.originalText).not.toContain('hidden thoughts');
    expect(result.originalText).not.toContain('labelSupport');
  });
  it('rejects live-style bare nutrient quotes even when the values occur on the page', () => {
    const bareSupport = { ...labelSupport, caloriesQuote: '180', proteinQuote: '6 g', carbsQuote: '24 g', fatQuote: '7 g' };
    const result = parseMealResponse(envelope(meal([{ ...item, labelSupport: bareSupport }])), new Date(), 0, input, [source]);
    expect(result.items[0].evidence).toBe('estimate');
    expect(result.items[0].sourceIndexes).toEqual([]);
    const instruction = buildMealRequest(input).systemInstruction.parts[0].text;
    expect(instruction).toContain('must begin with its actual nutrient name');
    expect(instruction).toContain('SAME serving-basis field');
    expect(instruction).toContain('Copy the source exactly');
  });
  it('researches exact products and returns only compact factual provenance', async () => {
    const fetcher = researchFetch(); vi.stubGlobal('fetch', fetcher);
    const result = await analyzeMeal({ ...input, hint: 'I am Sinan, lean bulking. I ate six Fixture samosas.' }, 'gemini-key', 'tavily-key');
    expect(result.items[0].evidence).toBe('label');
    expect(result.researchProvider).toBe('tavily');
    expect(result.sources).toEqual([{ title: source.title, url: source.url }]);
    expect(result.searchSuggestionsHtml).toBeNull();
    expect(JSON.stringify(result)).not.toContain('PRIVATE FULL PAGE MARKER');
    expect(JSON.stringify(result)).not.toContain('labelSupport');
    const requests = fetcher.mock.calls.map(([url, init]) => ({ url, body: JSON.parse(init.body) }));
    const gemini = requests.filter(r => r.url.includes('googleapis'));
    expect(gemini).toHaveLength(3);
    expect(gemini.every(r => r.url.endsWith('/gemini-3.8-flash:generateContent') && r.body.store === false && !r.body.tools)).toBe(true);
    const search = requests.find(r => r.url.endsWith('/search'))!.body;
    expect(search).toMatchObject({ query: 'Fixture samosas nutrition facts serving size', auto_parameters: false, include_answer: false, include_usage: true, search_depth: 'basic' });
    expect(JSON.stringify(requests.filter(r => r.url.includes('tavily')))).not.toMatch(/Sinan|bulking|gemini-key|imageBase64/);
    expect(result.usage).toMatchObject({ modelCalls: 3, promptTokens: 15000, thinkingTokens: 3000, estimatedTokenUsd: 0.03375, knownEstimatedTokenUsd: 0.03375,
      searchQueries: 0, webResearch: { searchRequests: 1, extractedUrls: 1, reportedCredits: 1, knownReportedCredits: 1, estimatedCredits: 1.4, complete: true } });
  });
  it('handles generic photo meals with no searches, clearly estimated portions', async () => {
    const estimate = { ...item, productIndex: null, evidence: 'estimate', amountQuote: '', notes: 'Assumed portion; oil unknown.', labelSupport: { ...labelSupport, origin: 'none' } };
    const fetcher = vi.fn().mockResolvedValueOnce(json(envelope({ products: [], clarification: null }))).mockResolvedValueOnce(json(envelope(meal([estimate], 'Estimated portion; hidden oil is unknown.'))));
    vi.stubGlobal('fetch', fetcher);
    const result = await analyzeMeal({ hint: '', images: [{ angle: 'top', mimeType: 'image/jpeg', imageBase64: 'AAAA' }] }, 'g', 't');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.items[0]).toMatchObject({ evidence: 'estimate', amountConfirmed: false });
    expect(result.summary).toContain('oil');
    expect(result.usage.webResearch?.searchRequests).toBe(0);
  });
  it('accepts supplied label transcription without web provenance, but a plate alone is no proof', () => {
    const supplied = { ...item, labelSupport: { ...labelSupport, origin: 'description', sourceIndex: null } };
    expect(parseMealResponse(envelope(meal([supplied])), new Date(), 0, { images: [], hint: `${input.hint}\n${labelText}` }).items[0].evidence).toBe('label');
    expect(parseMealResponse(envelope(meal()), new Date(), 0, { hint: '', images: [{ angle: 'top', imageBase64: 'AAAA', mimeType: 'image/jpeg' }] }).items[0].evidence).toBe('estimate');
  });
  it.each([
    { sourceIndex: 999 }, { caloriesQuote: 'Calories 999' }, { proteinQuote: 'Fat 7 g' }, { servingQuote: 'Serving 3 grams' }, { productQuote: 'Unrelated product' },
  ])('rejects unsubstantiated label source/value/unit claims %j', overrides => {
    const result = parseMealResponse(envelope(meal([{ ...item, labelSupport: { ...labelSupport, ...overrides } }])), new Date(), 0, input, [source]);
    expect(result.items[0].evidence).toBe('estimate');
    expect(result.summary).toMatch(/estimat/i);
    expect(`${result.summary} ${result.items[0].notes}`).not.toMatch(/check.*package|add.*label/i);
  });
  it('binds quantities to their actual units and nutrients to their own numeric fields', () => {
    const mixed = { ...source, content: 'Fixture samosas\\nServing 3 pieces (100 g)\\nCalories 180 Protein 6 g Carbs 24 g Fat 7 g' };
    const support = { ...labelSupport, servingQuote: 'Serving 3 pieces (100 g)', proteinQuote: 'Protein 6 g Carbs 24 g' };
    const badServing = { ...item, basisQuantity: 100, labelSupport: support };
    expect(parseMealResponse(envelope(meal([badServing])), new Date(), 0, input, [mixed]).items[0].evidence).toBe('estimate');
    const wrongProtein = { ...item, protein: 24, labelSupport: support };
    expect(parseMealResponse(envelope(meal([wrongProtein])), new Date(), 0, input, [mixed]).items[0].evidence).toBe('estimate');
    const valid = { ...item, labelSupport: support };
    expect(parseMealResponse(envelope(meal([valid])), new Date(), 0, input, [mixed]).items[0].evidence).toBe('label');
    const mass = { ...item, unit: 'g', basisQuantity: 100, labelSupport: support };
    expect(parseMealResponse(envelope(meal([mass])), new Date(), 0, input, [mixed]).items[0].evidence).toBe('label');
  });
  it('accepts plural Fats and table separators without binding adjacent nutrient values', () => {
    const tableText = 'Fixture samosas\nServing 3 pieces\n| Calories | 180 |\nProtein : 6 g\nCarbs — 24 g\nFats | 10g | 13%';
    const tableSource = { ...source, content: tableText };
    const tableItem = { ...item, fat: 10, labelSupport: { ...labelSupport, caloriesQuote: '| Calories | 180 |', proteinQuote: 'Protein : 6 g', carbsQuote: 'Carbs — 24 g', fatQuote: 'Fats | 10g | 13%' } };
    expect(parseMealResponse(envelope(meal([tableItem])), new Date(), 0, input, [tableSource]).items[0].evidence).toBe('label');
    const badItem = { ...tableItem, fat: 13 };
    expect(parseMealResponse(envelope(meal([badItem])), new Date(), 0, input, [tableSource]).items[0].evidence).toBe('estimate');
    const wrongField = { ...tableItem, fat: 6, labelSupport: { ...tableItem.labelSupport, fatQuote: 'Protein : 6 g' } };
    expect(parseMealResponse(envelope(meal([wrongField])), new Date(), 0, input, [tableSource]).items[0].evidence).toBe('estimate');
  });
  it.each(['Regular', 'Default', 'Standard'])('ignores only generic whole-field variant placeholder %s', async variant => {
    const fetcher = vi.fn().mockResolvedValueOnce(json(envelope({ ...plan, products: [{ ...plan.products[0], variant }] })))
      .mockResolvedValueOnce(json({ results: [{ title: source.title, url: source.url, content: source.description }], usage: { credits: 1 } }))
      .mockResolvedValueOnce(json(envelope({ sourceIndexes: [0], clarification: null })))
      .mockResolvedValueOnce(json({ results: [{ url: source.url, raw_content: labelText }], usage: { credits: 0 } }))
      .mockResolvedValueOnce(json(envelope(meal())));
    vi.stubGlobal('fetch', fetcher);
    const result = await analyzeMeal(input, 'g', 't');
    expect(result.clarification).toBeNull();
    expect(result.items[0].evidence).toBe('label');
    expect(JSON.parse(fetcher.mock.calls[0][1].body).systemInstruction.parts[0].text).toContain('never invent Regular');
  });
  it.each(['Original', 'reduced fat', 'Regular chicken'])('keeps meaningful variant matching for %s', async variant => {
    const fetcher = vi.fn().mockResolvedValueOnce(json(envelope({ ...plan, products: [{ ...plan.products[0], variant }] })))
      .mockResolvedValueOnce(json({ results: [{ title: source.title, url: source.url, content: source.description }], usage: { credits: 1 } }))
      .mockResolvedValueOnce(json(envelope({ sourceIndexes: [0], clarification: null })))
      .mockResolvedValueOnce(json({ results: [{ url: source.url, raw_content: labelText }], usage: { credits: 0 } }))
      .mockResolvedValueOnce(json(envelope(meal())));
    vi.stubGlobal('fetch', fetcher);
    const result = await analyzeMeal(input, 'g', 't');
    expect(result.clarification).toBeNull();
    expect(result.items[0]).toMatchObject({ evidence: 'estimate', sourceIndexes: [] });
    expect(result.items[0].name).toContain(variant);
  });
  it('does not treat a copied label serving or model-invented amount as user confirmation', () => {
    const raw = envelope(meal([{ ...item, amountQuote: 'six', quantity: 6 }]));
    expect(parseMealResponse(raw, new Date(), 0, { hint: 'a package of samosas', images: [] }, [source]).items[0].amountConfirmed).toBe(false);
  });
  it('returns an editable estimate when an exact branded label cannot be verified', async () => {
    const fetcher = researchFetch(meal([{ ...item, evidence: 'estimate' }])); vi.stubGlobal('fetch', fetcher);
    const result = await analyzeMeal(input, 'g', 't');
    expect(result.clarification).toBeNull();
    expect(result.items[0].evidence).toBe('estimate');
    expect(trialFoodTotals(result.items[0]).calories).toBe(360);
    expect(fetcher).toHaveBeenCalledTimes(5);
  });
  it.each([false, true])('demotes a mismatched vegetable label and retains requested chicken identity even with malformed nutrient support=%s', async malformed => {
    const chickenPlan = { products: [{ brand: 'Fixture', product: 'chicken tikka samosas', variant: '' }], clarification: null };
    const vegetableText = labelText.replace('Fixture samosas', 'Fixture vegetable samosas');
    const vegetableItem = { ...item, name: 'Fixture vegetable samosas', labelSupport: { ...labelSupport, productQuote: 'Fixture vegetable samosas', ...(malformed ? { caloriesQuote: '180' } : {}) } };
    const fetcher = vi.fn().mockResolvedValueOnce(json(envelope(chickenPlan)))
      .mockResolvedValueOnce(json({ results: [{ ...source, content: 'Official vegetable product' }], usage: { credits: 1 } }))
      .mockResolvedValueOnce(json(envelope({ sourceIndexes: [0], clarification: null })))
      .mockResolvedValueOnce(json({ results: [{ url: source.url, raw_content: vegetableText }], usage: { credits: 0 } }))
      .mockResolvedValueOnce(json(envelope(meal([vegetableItem]))));
    vi.stubGlobal('fetch', fetcher);
    const result = await analyzeMeal({ hint: 'six Fixture chicken tikka samosas', images: [] }, 'g', 't');
    expect(result.clarification).toBeNull();
    expect(result.items[0]).toMatchObject({ name: 'Fixture chicken tikka samosas', evidence: 'estimate', sourceIndexes: [], amountConfirmed: false });
    expect(result.items[0].notes).toMatch(/estimat/i);
  });
  it.each([null, 99, -1])('does not retain exact-label status when the planned product reference is %s', async productIndex => {
    const fetcher = researchFetch(meal([{ ...item, productIndex }, item]));
    vi.stubGlobal('fetch', fetcher);
    const result = await analyzeMeal(input, 'g', 't');
    expect(result.clarification).toBeNull();
    expect(result.items[0]).toMatchObject({ evidence: 'estimate', sourceIndexes: [] });
    expect(result.items[0].notes).toMatch(/estimat/i);
  });
  it('rejects a result that silently omits the researched entrée instead of returning only sauce', async () => {
    const sauce = { ...item, productIndex: null, name: 'Sauce', evidence: 'estimate', notes: 'Assumed one packet.', labelSupport: { ...labelSupport, origin: 'none' } };
    const fetcher = researchFetch(meal([sauce], 'Sauce ready.'));
    vi.stubGlobal('fetch', fetcher);
    await expect(analyzeMeal({ ...input, hint: 'six Fixture samosas with sauce' }, 'g', 't')).rejects.toBeInstanceOf(MealAnalysisError);
    expect(fetcher).toHaveBeenCalledTimes(5);
  });
  it('does not forward compound sauce-portion and package-label requests from planning or selection', async () => {
    const saucePlan = { products: [{ brand: 'Chick-fil-A', product: 'sauce', variant: '' }], needsFoodIdentity: false,
      clarification: 'How many packets or grams of Chick-fil-A sauce did you have, and could you share a photo of its nutrition label?' };
    const estimate = { ...item, name: 'Chick-fil-A sauce', quantity: 1, unit: 'serving', basisQuantity: 1,
      calories: 140, protein: 0, carbs: 6, fat: 13, evidence: 'estimate', amountQuote: '',
      notes: 'Assumed one sauce packet.', labelSupport: { ...labelSupport, origin: 'none' } };
    const fetcher = vi.fn().mockResolvedValueOnce(json(envelope(saucePlan)))
      .mockResolvedValueOnce(json({ results: [{ title: 'Sauce', url: source.url, content: 'Sauce nutrition' }], usage: { credits: 1 } }))
      .mockResolvedValueOnce(json(envelope({ sourceIndexes: [], clarification: 'Could you add the exact package nutrition label to confirm these values?' })))
      .mockResolvedValueOnce(json(envelope(meal([estimate], 'Estimated with one sauce packet.'))));
    vi.stubGlobal('fetch', fetcher);
    const result = await analyzeMeal({ hint: 'I had Chick-fil-A sauce', images: [] }, 'g', 't');
    expect(result.clarification).toBeNull();
    expect(result.items[0]).toMatchObject({ name: 'Chick-fil-A sauce', evidence: 'estimate', amountConfirmed: false });
    expect(result.items[0].notes).toContain('one sauce packet');
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(result.usage.modelCalls).toBe(3);
  });
  it('asks only the canonical food identity question when the main food is unrecognizable', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json(envelope({ products: [], needsFoodIdentity: true,
      clarification: 'What is it, how many grams, and can you add a package label?' })));
    vi.stubGlobal('fetch', fetcher);
    const result = await analyzeMeal({ images: [{ angle: 'top', mimeType: 'image/jpeg', imageBase64: 'AAAA' }], hint: '' }, 'g', 't');
    expect(result.clarification).toBe('What was the main food in this meal?');
    expect(result.items).toEqual([]);
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it.each(['budget', 'legacy-answer'])('does not ask again after an answer signaled by %s even if the planner still requests clarification', async signal => {
    const estimate = { ...item, evidence: 'estimate', labelSupport: { ...labelSupport, origin: 'none' }, notes: 'Estimated from the meal description.' };
    const fetcher = vi.fn().mockResolvedValueOnce(json(envelope({ products: [], needsFoodIdentity: true,
      clarification: 'Could you add the exact package nutrition label to confirm these values?' })))
      .mockResolvedValueOnce(json(envelope(meal([estimate], 'Estimated from the available details.'))));
    vi.stubGlobal('fetch', fetcher);
    const result = await analyzeMeal({ ...input, clarificationUsed: signal === 'budget',
      hint: signal === 'budget' ? 'six samosas. No nutrition labels handy.' : 'six samosas.\nAnswer: Assume I do not have any nutrition labels handy.' }, 'g', 't');
    expect(result.clarification).toBeNull();
    expect(result.items).toHaveLength(1);
    expect(result.items[0].evidence).toBe('estimate');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each(['search', 'extract'])('continues to an estimate after empty %s results without retrying research', async stage => {
    const estimate = { ...item, evidence: 'estimate', notes: 'Estimated from the described product.', labelSupport: { ...labelSupport, origin: 'none' } };
    const fetcher = vi.fn().mockResolvedValueOnce(json(envelope(plan)))
      .mockResolvedValueOnce(json({ results: stage === 'search' ? [] : [{ title: source.title, url: source.url, content: source.description }], usage: { credits: 1 } }));
    if (stage === 'extract') {
      fetcher.mockResolvedValueOnce(json(envelope({ sourceIndexes: [0], clarification: null })))
        .mockResolvedValueOnce(json({ results: [], failed_results: [{ url: source.url, error: 'No content' }], usage: { credits: 0 } }));
    }
    fetcher.mockResolvedValueOnce(json(envelope(meal([estimate]))));
    vi.stubGlobal('fetch', fetcher);
    const result = await analyzeMeal(input, 'g', 't');
    expect(result.clarification).toBeNull();
    expect(result.items[0].evidence).toBe('estimate');
    expect(fetcher).toHaveBeenCalledTimes(stage === 'search' ? 3 : 5);
    expect(result.usage.modelCalls).toBe(stage === 'search' ? 2 : 3);
    expect(result.usage.webResearch?.searchRequests).toBe(1);
  });
  it('rejects an invalid finalizer question without showing another question or making a paid retry', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json(envelope({ products: [], needsFoodIdentity: false })))
      .mockResolvedValueOnce(json(envelope({ summary: '', clarification: 'Could you add the exact package nutrition label?', items: [] })));
    vi.stubGlobal('fetch', fetcher);
    await expect(analyzeMeal({ ...input, clarificationUsed: true }, 'g', 't')).rejects.toBeInstanceOf(MealAnalysisError);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each(['search', 'extract'])('returns an estimate when %s fails while retaining unknown paid usage', async stage => {
    const estimate = { ...item, evidence: 'estimate', notes: 'Estimated from the described product.', labelSupport: { ...labelSupport, origin: 'none' } };
    const fetcher = vi.fn().mockResolvedValueOnce(json(envelope(plan)));
    if (stage === 'search') fetcher.mockRejectedValueOnce(new TypeError('Research connection lost'));
    else fetcher.mockResolvedValueOnce(json({ results: [{ title: source.title, url: source.url, content: source.description }], usage: { credits: 1 } }))
      .mockResolvedValueOnce(json(envelope({ sourceIndexes: [0], clarification: null })))
      .mockRejectedValueOnce(new TypeError('Research connection lost'));
    fetcher.mockResolvedValueOnce(json(envelope(meal([estimate]))));
    vi.stubGlobal('fetch', fetcher);
    const result = await analyzeMeal(input, 'g', 't');
    expect(result.clarification).toBeNull();
    expect(result.items[0].evidence).toBe('estimate');
    expect(result.usage.webResearch).toMatchObject({ complete: false, reportedCredits: null });
    expect(fetcher).toHaveBeenCalledTimes(stage === 'search' ? 3 : 5);
  });
  it('rejects fabricated source indexes without extraction or final model call', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json(envelope(plan))).mockResolvedValueOnce(json({ results: [{ url: source.url }], usage: { credits: 1 } })).mockResolvedValueOnce(json(envelope({ sourceIndexes: [99], clarification: null })));
    vi.stubGlobal('fetch', fetcher);
    await expect(analyzeMeal(input, 'g', 't')).rejects.toThrow('source selection');
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('rejects personal narrative in search arguments before sending it to Tavily', async () => {
    const fetcher = vi.fn().mockResolvedValue(json(envelope({ products: [{ brand: '', product: 'my diabetes patient meal', variant: '' }], clarification: null })));
    vi.stubGlobal('fetch', fetcher);
    await expect(analyzeMeal(input, 'g', 't')).rejects.toThrow('public product');
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('retains observed cost on a later unknown failure and never retries', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json(envelope({ products: [], clarification: null }))).mockRejectedValueOnce(new TypeError('offline'));
    vi.stubGlobal('fetch', fetcher);
    const error = await analyzeMeal(input, 'g', 't').catch(e => e) as MealAnalysisError;
    expect(error.message).toContain('not be retried');
    expect(error.usage).toMatchObject({ modelCalls: 2, promptTokens: null, estimatedTokenUsd: null, knownEstimatedTokenUsd: 0.01125 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('has one absolute deadline across research and models', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-05'));
    const fetcher = vi.fn().mockImplementation(async () => { vi.setSystemTime(Date.now() + 90001); return json(envelope({ products: [], clarification: null })); });
    vi.stubGlobal('fetch', fetcher);
    await expect(analyzeMeal(input, 'g', 't')).rejects.toThrow('limit');
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('prices cached and thinking tokens, preserves missing usage as unknown, changes rates in2027', () => {
    expect(mealUsage(envelope({}), new Date('2026-09-05'), 0).estimatedTokenUsd).toBe(0.01125);
    expect(mealUsage(envelope({}, { usageMetadata: { ...usageMetadata, cachedContentTokenCount: 1000 } }), new Date('2026-09-05'), 0).estimatedTokenUsd).toBe(0.010575);
    expect(mealUsage(envelope({}), new Date('2027-01-01'), 0).estimatedTokenUsd).toBe(0.0225);
    expect(mealUsage({}, new Date(), 0)).toMatchObject({ promptTokens: null, thinkingTokens: null, estimatedTokenUsd: null });
  });
  it.each([0, -1, NaN, Infinity, '3'])('rejects bad serving basis %s', basisQuantity => expect(() => validateTrialItems([{ ...item, basisQuantity }])).toThrow());
  it('rejects incomplete responses, contradictory clarifications and missing macros', () => {
    expect(() => parseMealResponse(envelope({}, { candidates: [{ finishReason: 'MAX_TOKENS' }] }))).toThrow('incomplete');
    expect(() => parseMealResponse(envelope({ ...meal(), clarification: 'Which product?' }))).toThrow('unresolved');
    expect(() => validateTrialItems([{ ...item, calories: undefined }])).toThrow('numbers');
  });
  it('accepts clarification with no fabricated foods', () => {
    const result = parseMealResponse(envelope({ summary: '', clarification: 'How many pieces?', items: [] }));
    expect(result.clarification).toBe('How many pieces?'); expect(result.items).toEqual([]);
  });
  it('does not substitute another model on unavailable-model failure', async () => {
    const fetcher = vi.fn().mockResolvedValue(json({}, 404)); vi.stubGlobal('fetch', fetcher);
    await expect(analyzeMeal(input, 'g', 't')).rejects.toThrow('No other model'); expect(fetcher).toHaveBeenCalledOnce();
  });
});
