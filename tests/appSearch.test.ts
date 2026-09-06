import { describe, expect, it } from 'vitest';
import { APP_SEARCH_ENTRIES, searchApp } from '@/lib/appSearch';

const search = (query: string, nativeIOS = false) => searchApp(query, { nativeIOS });

describe('settings and feature search', () => {
  it.each([
    ['dark mode', 'appearance'],
    ['How do I change my protein goal?', 'protein'],
    ['pounds', 'weight-units'],
    ['kilograms', 'weight-units'],
    ['food photo setup', 'food-analysis'],
    ['change my routine', 'program'],
    ['log out', 'sign-out'],
    ['server address', 'worker-url'],
    ['automatic adjustments', 'target-adaptation'],
    ['past workouts', 'history'],
    ['training volume', 'progress'],
  ])('ranks the intended destination first for %s', (query, id) => {
    expect(search(query)[0]?.id).toBe(id);
  });

  it.each([['protien', 'protein'], ['apperance', 'appearance'], ['kilogarms', 'weight-units'], ['calor', 'calories']])('handles typo or prefix %s', (query, id) => {
    expect(search(query)[0]?.id).toBe(id);
  });

  it('filters Apple Health on the web, including natural weight-sync requests', () => {
    expect(search('sync my weight', true)[0]?.id).toBe('apple-health');
    expect(search('sync my weight')).toEqual([]);
    expect(search('apple health')).toEqual([]);
    expect(search('apple health', true)[0]?.href).toBe('/settings/connections/health');
  });

  it.each(['buy bitcoin', 'delete every workout', 'banana spaceship', 'weather forecast', 'how do I', 'zz'])('does not invent support for %s', (query) => {
    expect(search(query)).toEqual([]);
  });

  it('offers stable suggestions for empty input and normalizes punctuation and case', () => {
    expect(search('  ')).toEqual(search(''));
    expect(search('').length).toBeGreaterThan(0);
    expect(search('DARK-mode!')[0]?.id).toBe('appearance');
    expect(search('nutrition').length).toBeLessThanOrEqual(12);
  });

  it('has unique destinations and anchors identify their own control', () => {
    expect(new Set(APP_SEARCH_ENTRIES.map(({ id }) => id)).size).toBe(APP_SEARCH_ENTRIES.length);
    for (const entry of APP_SEARCH_ENTRIES) {
      expect(entry.href.startsWith('/')).toBe(true);
      if (entry.href.includes('#')) expect(entry.href.split('#')[1]).toBe(`search-${entry.id}`);
    }
    expect(search('protein goal')[0]?.href).toBe('/settings/targets/edit#search-protein');
    expect(search('log weight')[0]?.href).toBe('/settings/weight#search-log-weight');
  });
});

// Settings introduced alongside search remain discoverable.
describe('new settings destinations', () => {
  it('finds system appearance and adaptive scheduling', () => {
    expect(searchApp('follow system', { nativeIOS: false })[0]?.id).toBe('appearance');
    expect(searchApp('automatic workout scheduling', { nativeIOS: false })[0]?.href).toBe('/settings/training#search-adaptive-scheduling');
  });
});
