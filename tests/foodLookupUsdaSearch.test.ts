import { describe, expect, it } from 'vitest';
import { usdaSearchRequest } from '../supabase/functions/food-lookup/usda';

// USDA's servers reject about half of the searches whose address carries a
// space ("SR Legacy", "Survey (FNDDS)", or two words typed), which the app
// showed as a failed first search. The search goes in the body instead.
describe('the USDA search request', () => {
  it('keeps the words and the data types out of the address', () => {
    const { url, init } = usdaSearchRequest('chicken breast');
    expect(url.href).toBe('https://api.nal.usda.gov/fdc/v1/foods/search');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
  });

  it('asks for ten generic foods by the words typed', () => {
    const { init } = usdaSearchRequest('chicken breast');
    expect(JSON.parse(init.body as string)).toEqual({
      query: 'chicken breast',
      pageSize: 10,
      dataType: ['Foundation', 'SR Legacy', 'Survey (FNDDS)'],
    });
  });

  it('leaves room for the key without a space reaching the address', () => {
    const { url } = usdaSearchRequest('kiwi fruit');
    url.searchParams.set('api_key', 'key');
    expect(url.search).toBe('?api_key=key');
  });
});
