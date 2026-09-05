// Server-only web research adapter. Queries contain public product descriptors only.
export interface WebResearchUsage {
  provider: 'tavily'; searchRequests: number; extractRequests: number; extractedUrls: number;
  reportedCredits: number | null; knownReportedCredits: number; estimatedCredits: number;
  estimatedUsd: number; complete: boolean;
}
export interface ProductQuery { brand: string; product: string; variant: string }
export interface ResearchSource { title: string; url: string; description: string }
export interface ExtractedSource extends ResearchSource { content: string }
const obj = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};

export function publicSourceUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2000) return null;
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return null;
    if (!u.hostname.includes('.') || /(^|\.)(localhost|local|internal|test|invalid)$/.test(u.hostname) || /^[\d.]+$/.test(u.hostname) || u.hostname.includes(':')) return null;
    return u.toString();
  } catch { return null; }
}

export function productSearchQuery(value: unknown): string {
  const input = obj(value);
  const fields = ['brand', 'product', 'variant'].map(key => {
    const v = input[key];
    if (typeof v !== 'string' || v.length > 80 || v.trim().split(/\s+/).length > 8 || !/^[\p{L}\p{N} '&().,%+-]*$/u.test(v)) throw new Error('Search requires public product names only.');
    return v.trim();
  });
  if (!fields[1] || fields.join(' ').length > 180) throw new Error('Missing product name for search.');
  const description = fields.filter(Boolean).join(' ');
  // Reject narrative/personal context and common identifiers, including obfuscated IDs.
  if (/\d(?:[\s().-]*\d){6,}|\b(my|me|myself|patient|diagnosed|diabetes|diabetic|allergy|allergic|pregnant|bulking|cutting|calorie goal|blood|password|token|email|address|phone|user id|account)\b/i.test(description)) throw new Error('Search requires public product names only.');
  return `${description} nutrition facts serving size`;
}

export class TavilyResearch {
  readonly usage: WebResearchUsage = { provider: 'tavily', searchRequests: 0, extractRequests: 0, extractedUrls: 0, reportedCredits: 0, knownReportedCredits: 0, estimatedCredits: 0, estimatedUsd: 0, complete: true };
  private requestedUrls = 0;
  private readonly key: string;
  private readonly deadline: number;
  constructor(key: string, deadline: number) { this.key = key; this.deadline = deadline; }
  private async request(path: 'search' | 'extract', body: object): Promise<Record<string, unknown>> {
    const remaining = this.deadline - Date.now();
    if (remaining <= 0) throw new Error('The analysis deadline was reached.');
    let payload: Record<string, unknown>;
    try {
      const response = await fetch(`https://api.tavily.com/${path}`, {
        method: 'POST', headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, include_usage: true }), signal: AbortSignal.timeout(Math.min(remaining, 20000)),
      });
      const text = await response.text();
      if (text.length > 1000000) throw new Error('Web research response exceeded its limit.');
      payload = obj(JSON.parse(text));
      const credits = obj(payload.usage).credits;
      if (typeof credits === 'number' && Number.isFinite(credits) && credits >= 0) {
        this.usage.knownReportedCredits += credits;
        if (this.usage.reportedCredits !== null) this.usage.reportedCredits += credits;
      } else { this.usage.reportedCredits = null; this.usage.complete = false; }
      if (!response.ok) throw new Error(`Web research failed (${response.status}).`);
    } catch (error) {
      this.usage.complete = false;
      this.usage.reportedCredits = null;
      throw new Error(error instanceof Error && error.message.startsWith('Web research') ? error.message : 'Web research did not complete. It will not be retried automatically.');
    }
    return payload;
  }
  async search(product: unknown): Promise<ResearchSource[]> {
    const query = productSearchQuery(product); // Validate before using quota or sending anything.
    if (this.usage.searchRequests >= 2) throw new Error('Search limit reached.');
    if (this.deadline <= Date.now()) throw new Error('The analysis deadline was reached.');
    this.usage.searchRequests += 1;
    this.usage.estimatedCredits += 1;
    this.usage.estimatedUsd = this.usage.estimatedCredits * 0.008;
    const payload = await this.request('search', { query, search_depth: 'basic', max_results: 5, topic: 'general', auto_parameters: false, include_answer: false, include_raw_content: false });
    if (!Array.isArray(payload.results)) { this.usage.complete = false; throw new Error('Web research returned no usable search results.'); }
    return payload.results.slice(0, 5).flatMap(value => {
      const result = obj(value); const url = publicSourceUrl(result.url);
      return url ? [{ url, title: typeof result.title === 'string' ? result.title.slice(0, 240) : new URL(url).hostname, description: typeof result.content === 'string' ? result.content.slice(0, 1000) : '' }] : [];
    });
  }
  async extract(sources: ResearchSource[]): Promise<ExtractedSource[]> {
    const unique = [...new Map(sources.map(s => [s.url, s])).values()];
    if (!unique.length) return [];
    if (unique.some(s => !publicSourceUrl(s.url)) || this.requestedUrls + unique.length > 2) throw new Error('Source retrieval limit reached.');
    if (this.deadline <= Date.now()) throw new Error('The analysis deadline was reached.');
    this.requestedUrls += unique.length;
    this.usage.extractRequests += 1;
    const payload = await this.request('extract', { urls: unique.map(s => s.url), extract_depth: 'advanced', format: 'text', timeout: 15, include_images: false });
    if (!Array.isArray(payload.results)) { this.usage.complete = false; throw new Error('Web research returned no usable pages.'); }
    const allowed = new Map(unique.map(s => [s.url, s]));
    const seen = new Set<string>();
    const results = payload.results.flatMap(value => {
      const result = obj(value); const url = publicSourceUrl(result.url);
      if (!url || seen.has(url) || !allowed.has(url) || typeof result.raw_content !== 'string' || !result.raw_content.trim()) return [];
      seen.add(url);
      return [{ ...allowed.get(url)!, content: result.raw_content.slice(0, 16000) }];
    });
    this.usage.extractedUrls += results.length;
    this.usage.estimatedCredits += results.length * 2 / 5;
    this.usage.estimatedUsd = this.usage.estimatedCredits * 0.008;
    if (results.length !== unique.length) this.usage.complete = false;
    return results;
  }
}
