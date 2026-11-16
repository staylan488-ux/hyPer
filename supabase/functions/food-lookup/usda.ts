// How food-lookup asks USDA FoodData Central for a typed food search. Kept
// free of Deno and network imports so tests can run it (index.ts sends it).

const SEARCH_URL = 'https://api.nal.usda.gov/fdc/v1/foods/search';

/** What a typed search reads: generic foods, never branded products. */
export const SEARCH_DATA_TYPES = ['Foundation', 'SR Legacy', 'Survey (FNDDS)'] as const;
export const SEARCH_PAGE_SIZE = 10;

/**
 * A typed food search as a POST, with the words and the data types in a JSON
 * body and nothing of the search in the address.
 *
 * USDA documents the same search as a GET with everything in the address,
 * and that form is what the app showed as "The search failed" on a first try.
 * Two of the data types have a space in their names, and USDA's servers
 * answer about half of the GETs whose address carries a space with nginx's
 * "400 Bad Request" before any search runs, then accept the identical address
 * a moment later. Measured on 2026-11-13 by repeating one search: the GET
 * failed about every second time, the POST and a GET with no space never did.
 * So keep the search out of the address.
 */
export function usdaSearchRequest(query: string): { url: URL; init: RequestInit } {
  return {
    url: new URL(SEARCH_URL),
    init: {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, pageSize: SEARCH_PAGE_SIZE, dataType: SEARCH_DATA_TYPES }),
    },
  };
}
