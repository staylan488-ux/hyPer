import { describe, it, expect, vi, afterEach } from 'vitest';
vi.mock('@/preview/flag', () => ({ isPreviewActive: () => false, isAppSandboxActive: () => false }));
import { analyzeFoodTrial, getFoodTrialStatus, getFoodAnalysisMode, saveFoodAnalysisMode, previewFoodTrialResult } from '@/lib/foodTrial';
afterEach(() => vi.unstubAllGlobals());
describe('hosted food trial transport', () => {
  it('uses the hosted endpoint for text-only without worker settings and leaves review unconfirmed', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(previewFoodTrialResult)));
    vi.stubGlobal('fetch', fetcher);
    const result = await analyzeFoodTrial({ images: [], hint: 'six samosas', accessToken: 'user-token' });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][0]).toContain('/functions/v1/analyze-food-trial');
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ images: [], hint: 'six samosas' });
    expect(result.items[0].amountConfirmed).toBe(false);
  });
  it('does not retry a network failure that may already have been billed', async () => {
    const fetcher = vi.fn(async () => { throw new TypeError('Network failed'); });
    vi.stubGlobal('fetch', fetcher);
    await expect(analyzeFoodTrial({ images: [], hint: 'six samosas', accessToken: 'user-token' })).rejects.toThrow('same input');
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('does not fallback when the model is unavailable or substituted', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ...previewFoodTrialResult, model: 'different-model' }))));
    await expect(analyzeFoodTrial({ images: [], hint: 'six samosas', accessToken: 'user-token' })).rejects.toThrow('unexpected model');
  });
  it('rejects the old Google research service even with the correct model', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ...previewFoodTrialResult, researchProvider: undefined }))));
    await expect(analyzeFoodTrial({ images: [], hint: 'six samosas', accessToken: 'user-token' })).rejects.toThrow('needs an update');
  });
  it('maps provenance after filtering unsafe URLs and preserves supplied amounts', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ...previewFoodTrialResult,
      sources: [{ title: 'unsafe', url: 'javascript:alert(1)' }, { title: 'label', url: 'https://example.com/label' }],
      items: [{ ...previewFoodTrialResult.items[0], sourceIndexes: [0, 1], amountConfirmed: true }],
      searchSuggestionsHtml: '<script>ignored</script>',
    }))));
    const result = await analyzeFoodTrial({ images: [], hint: 'six samosas', accessToken: 'user-token' });
    expect(result.sources).toEqual([{ title: 'label', url: 'https://example.com/label' }]);
    expect(result.items[0].sourceIndexes).toEqual([0]);
    expect(result.items[0].amountConfirmed).toBe(true);
    expect(result.searchSuggestionsHtml).toBeNull();
  });
  it('accepts one clarification with no foods and rejects a contradictory saveable result', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ ...previewFoodTrialResult, items: [], clarification: 'Which package size?' })));
    vi.stubGlobal('fetch', fetcher);
    const result = await analyzeFoodTrial({ images: [], hint: 'six samosas', accessToken: 'user-token' });
    expect(result.clarification).toBe('Which package size?');
    expect(result.items).toEqual([]);
    fetcher.mockImplementation(async () => new Response(JSON.stringify({ ...previewFoodTrialResult, clarification: 'Which package size?' })));
    await expect(analyzeFoodTrial({ images: [], hint: 'six samosas', accessToken: 'user-token' })).rejects.toThrow('clarification details');
  });
  it('marks an answered or skipped clarification as consumed for the hosted model', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(previewFoodTrialResult)));
    vi.stubGlobal('fetch', fetcher);
    const hint = 'Lunch\nQuestion: What is the main food?\nAnswer: Chicken';
    const result = await analyzeFoodTrial({ images: [], hint, accessToken: 'user-token', clarificationUsed: true });
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ images: [], hint, clarificationUsed: true });
    expect(result.items).toHaveLength(1);
  });
  it('never forwards a second question from a stale or noncompliant backend', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ ...previewFoodTrialResult, items: [], clarification: 'Could you add the exact package nutrition label?' })));
    vi.stubGlobal('fetch', fetcher);
    await expect(analyzeFoodTrial({ images: [], hint: 'Chicken with sauce; use an estimate', accessToken: 'user-token', clarificationUsed: true })).rejects.toThrow('couldn’t make an estimate');
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('does not turn an empty final estimate into another clarification screen', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ...previewFoodTrialResult, items: [], clarification: null }))));
    await expect(analyzeFoodTrial({ images: [], hint: 'Unknown lunch', accessToken: 'user-token', clarificationUsed: true })).rejects.toThrow('No food could be identified');
  });
  it('rejects empty inputs before network and sends photos plus hint', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(previewFoodTrialResult)));
    vi.stubGlobal('fetch', fetcher);
    await expect(analyzeFoodTrial({ images: [], hint: '', accessToken: 'user-token' })).rejects.toThrow('description');
    expect(fetcher).not.toHaveBeenCalled();
    const images = [{ angle: 'top' as const, imageBase64: 'AAAA', mimeType: 'image/jpeg' }];
    await analyzeFoodTrial({ images, hint: 'rice', accessToken: 'user-token' });
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ images, hint: 'rice' });
  });
  it('status is read only and food mode does not overwrite the worker/coach provider', async () => {
    const stored = new Map([['hyper.photo-worker.provider', 'anthropic']]);
    vi.stubGlobal('localStorage', { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => stored.set(k, v) });
    saveFoodAnalysisMode('gemini');
    expect(getFoodAnalysisMode()).toBe('gemini');
    expect(stored.get('hyper.photo-worker.provider')).toBe('anthropic');
    const fetcher = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetcher);
    await getFoodTrialStatus('token');
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ action: 'status' });
  });
});
