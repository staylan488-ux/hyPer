// Live steps of a meal analysis, streamed to the app while it runs.
// Steps carry only public product names, source hostnames, counts and short
// headings from Gemini's thought summaries. Nothing here is stored.

export type AnalysisProgress =
  /** Gemini reads the description and photos (and, for familiar foods, finishes the estimate). */
  | { step: 'look' }
  /** Web searches for up to two products, by their public names. */
  | { step: 'search'; products: string[] }
  /** Gemini picks the useful pages from the search results. */
  | { step: 'compare'; pages: number }
  /** The chosen pages are read, by hostname. */
  | { step: 'read'; sites: string[] }
  /** Gemini works out the foods, portions and nutrition from what was found. */
  | { step: 'estimate' }
  /** A heading from Gemini's thought summary for the step under way. */
  | { step: 'thought'; text: string };

export type ProgressListener = (event: AnalysisProgress) => void;

const MAX_THOUGHT = 80;
const MAX_NAME = 120;

const clean = (value: string, max: number) => value.replace(/[\p{Cc}*_`#]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim();

/**
 * The latest heading in a streamed thought summary. Gemini starts each summary
 * with a bold line ("**Estimating the portion**"); only that heading is shown.
 * Headings that look like a link, a number dump or a sentence fragment are
 * dropped.
 */
export function thoughtHeading(summary: string): string | null {
  const headings = [...summary.matchAll(/\*\*([^*\n]{3,120})\*\*/g)];
  const last = headings.at(-1)?.[1];
  if (!last) return null;
  const text = clean(last, MAX_THOUGHT).replace(/[:.;,]+$/, '');
  if (text.length < 3 || !/\p{L}{3}/u.test(text) || /https?:|www\.|@|\{|\}|<|>/i.test(text)) return null;
  return text;
}

/** A product's public name for display: brand, product and variant. */
export function productLabel(product: { brand: string; product: string; variant: string }): string {
  return clean([product.brand, product.product, product.variant].filter(part => part.trim()).join(' '), MAX_NAME);
}

/** A source page's site, as people say it: "traderjoes.com". */
export function siteLabel(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '').slice(0, MAX_NAME) || null;
  } catch {
    return null;
  }
}

/** Checks a step received from the server; anything unexpected is dropped. */
export function parseProgress(value: unknown): AnalysisProgress | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const event = value as Record<string, unknown>;
  const names = (list: unknown, max: number) =>
    Array.isArray(list) && list.length <= max && list.every(item => typeof item === 'string' && item.trim() && item.length <= MAX_NAME)
      ? (list as string[]).map(item => clean(item, MAX_NAME))
      : null;
  switch (event.step) {
    case 'look':
    case 'estimate':
      return { step: event.step };
    case 'search': {
      const products = names(event.products, 2);
      return products?.length ? { step: 'search', products } : null;
    }
    case 'compare':
      return Number.isInteger(event.pages) && (event.pages as number) >= 0 && (event.pages as number) <= 50 ? { step: 'compare', pages: event.pages as number } : null;
    case 'read': {
      const sites = names(event.sites, 2);
      return sites?.length ? { step: 'read', sites } : null;
    }
    case 'thought':
      return typeof event.text === 'string' && event.text.trim() && event.text.length <= MAX_THOUGHT ? { step: 'thought', text: clean(event.text, MAX_THOUGHT) } : null;
    default:
      return null;
  }
}

/** One server-sent event. */
export function sseEvent(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

/**
 * Reads server-sent events from text arriving in pieces. Each complete event's
 * data lines are joined and handed to `onData`; comments and other fields are
 * ignored.
 */
export function createSseReader(onData: (data: string) => void) {
  let buffer = '';
  const flush = (block: string) => {
    const data = block
      .split(/\r\n|\r|\n/)
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(line.startsWith('data: ') ? 6 : 5))
      .join('\n');
    if (data) onData(data);
  };
  // A blank line ends an event, in any of the three line endings. The buffer
  // keeps whatever has arrived, so an ending split across pieces still matches.
  const boundary = /\r\n\r\n|\n\n|\r\r/;
  return {
    push(text: string) {
      buffer += text;
      let match = boundary.exec(buffer);
      while (match) {
        flush(buffer.slice(0, match.index));
        buffer = buffer.slice(match.index + match[0].length);
        match = boundary.exec(buffer);
      }
    },
    /** The stream ended: a last event without its blank line still counts. */
    end() {
      if (buffer.trim()) flush(buffer);
      buffer = '';
    },
  };
}
