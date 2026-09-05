import { afterEach, describe, expect, it, vi } from 'vitest';
import { TavilyResearch, productSearchQuery, publicSourceUrl } from '../supabase/functions/analyze-food-trial/tavily';
const product = { brand: "Trader Joe's", product: 'chicken tikka samosas', variant: '' };
const source = { title: 'Label', url: 'https://example.com/label', description: 'Product' };
const response = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
afterEach(() => vi.unstubAllGlobals());
describe('bounded Tavily research adapter', () => {
  it('accepts only public product descriptors', () => {
    expect(productSearchQuery(product)).toBe("Trader Joe's chicken tikka samosas nutrition facts serving size");
    for (const text of ['email me@example.com', 'my lean bulking meal', 'patient diabetes', 'call 555-123-4567', 'https://secret.test', 'user id 20333333']) expect(() => productSearchQuery({ brand: '', product: text, variant: '' })).toThrow();
  });
  it('rejects local, credentialed and non-HTTPS source URLs', () => {
    for (const url of ['http://example.com', 'https://localhost/x', 'https://127.0.0.1/x', 'https://10.0.0.1', 'https://[::1]', 'https://user:pass@example.com', 'https://example.com:9000', 'javascript:alert(1)']) expect(publicSourceUrl(url)).toBeNull();
    expect(publicSourceUrl(source.url)).toBe(source.url);
  });
  it('never performs a third search and records reported zero vs estimated credits', async () => {
    const fetcher = vi.fn().mockImplementation(async () => response({ results: [], usage: { credits: 0 } })); vi.stubGlobal('fetch', fetcher);
    const adapter = new TavilyResearch('key', Date.now() + 50000);
    await adapter.search(product); await adapter.search(product);
    await expect(adapter.search(product)).rejects.toThrow('Search limit');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(adapter.usage).toMatchObject({ searchRequests: 2, reportedCredits: 0, estimatedCredits: 2, complete: true });
  });
  it('extracts only requested pages, bounds2 URLs and never retains unexpected or duplicate results', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ results: [{ url: source.url, raw_content: 'Nutrition facts' }, { url: 'https://evil.example/label', raw_content: 'Unsolicited' }, { url: source.url, raw_content: 'Duplicate' }], usage: { credits: 0 } })); vi.stubGlobal('fetch', fetcher);
    const adapter = new TavilyResearch('key', Date.now() + 50000);
    const result = await adapter.extract([source, { ...source, url: 'https://example.com/other' }]);
    expect(result).toHaveLength(1);
    expect(adapter.usage).toMatchObject({ extractedUrls: 1, reportedCredits: 0, estimatedCredits: 0.4, complete: false });
    await expect(adapter.extract([source])).rejects.toThrow('limit');
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('retains known credits and unknown completion on timeout without retrying', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response({ results: [source], usage: { credits: 1 } })).mockRejectedValueOnce(new TypeError('timeout')); vi.stubGlobal('fetch', fetcher);
    const adapter = new TavilyResearch('key', Date.now() + 50000);
    await adapter.search(product); await expect(adapter.extract([source])).rejects.toThrow('not be retried');
    expect(adapter.usage).toMatchObject({ reportedCredits: null, knownReportedCredits: 1, complete: false, extractRequests: 1 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('missing usage is unknown rather than free, and HTTP failures are not retried', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response({ results: [] })).mockResolvedValueOnce(response({}, 429)); vi.stubGlobal('fetch', fetcher);
    const adapter = new TavilyResearch('key', Date.now() + 50000);
    await adapter.search(product); expect(adapter.usage.reportedCredits).toBeNull();
    await expect(adapter.search(product)).rejects.toThrow('429'); expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
