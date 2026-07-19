// Authenticated USDA FoodData Central proxy. The USDA key remains in Edge
// Function secrets and is never shipped in the browser bundle.
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { corsHeaders, jsonResponse } from '../_shared/oauth.ts';

type FoodLookupRequest =
  | { action: 'search'; query?: string }
  | { action: 'barcode'; barcode?: string }
  | { action: 'open-food-facts-barcode'; barcode?: string }
  | { action: 'detail'; fdcId?: string };

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

function validGtin(value: string): boolean {
  const digits = digitsOnly(value);
  if (![8, 12, 13, 14].includes(digits.length)) return false;
  const check = Number(digits.at(-1));
  let sum = 0;
  for (let index = digits.length - 2, position = 0; index >= 0; index -= 1, position += 1) {
    sum += Number(digits[index]) * (position % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10 === check;
}

function expandUpceToUpca(value: string): string | null {
  const digits = digitsOnly(value);
  if (digits.length !== 8 || !['0', '1'].includes(digits[0])) return null;

  const payload = digits.slice(1, 7);
  const compressionDigit = payload[5];
  let expandedBody: string;
  if (['0', '1', '2'].includes(compressionDigit)) {
    expandedBody = `${digits[0]}${payload.slice(0, 2)}${compressionDigit}0000${payload.slice(2, 5)}`;
  } else if (compressionDigit === '3') {
    expandedBody = `${digits[0]}${payload.slice(0, 3)}00000${payload.slice(3, 5)}`;
  } else if (compressionDigit === '4') {
    expandedBody = `${digits[0]}${payload.slice(0, 4)}00000${payload[4]}`;
  } else {
    expandedBody = `${digits[0]}${payload.slice(0, 5)}0000${compressionDigit}`;
  }

  const expanded = `${expandedBody}${digits[7]}`;
  return validGtin(expanded) ? expanded : null;
}

function normalizeFoodBarcode(value: string): string | null {
  const digits = digitsOnly(value);
  if (validGtin(digits)) return digits;
  return expandUpceToUpca(digits);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  const body = await req.json().catch(() => ({})) as FoodLookupRequest;

  if (body.action === 'open-food-facts-barcode') {
    const barcode = normalizeFoodBarcode(body.barcode ?? '');
    if (!barcode) return jsonResponse({ error: 'Invalid barcode' }, 400);

    const url = new URL(`https://world.openfoodfacts.org/api/v2/product/${barcode}.json`);
    url.searchParams.set('fields', 'code,status,product_name,generic_name,brands,serving_size,serving_quantity,serving_quantity_unit,nutrition_data_per,nutriments');
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'hyPer/0.1 (https://github.com/staylan488-ux/hyPer)',
      },
    });
    const payload = await response.json().catch(() => ({ error: 'Invalid Open Food Facts response' }));
    if (!response.ok) {
      console.error('Open Food Facts lookup failed:', response.status);
      return jsonResponse({ error: 'Open Food Facts lookup failed', status: response.status }, 502);
    }
    return jsonResponse(payload);
  }

  const apiKey = Deno.env.get('USDA_API_KEY') ?? '';
  if (!apiKey) return jsonResponse({ error: 'food-lookup is not configured' }, 500);

  let url: URL;
  if (body.action === 'search') {
    const query = body.query?.trim() ?? '';
    if (query.length < 2 || query.length > 120) return jsonResponse({ error: 'Invalid search query' }, 400);
    url = new URL('https://api.nal.usda.gov/fdc/v1/foods/search');
    url.searchParams.set('query', query);
    url.searchParams.set('pageSize', '10');
    url.searchParams.set('dataType', 'Foundation,SR Legacy,Survey (FNDDS)');
  } else if (body.action === 'barcode') {
    const barcode = normalizeFoodBarcode(body.barcode ?? '');
    if (!barcode) return jsonResponse({ error: 'Invalid barcode' }, 400);
    url = new URL('https://api.nal.usda.gov/fdc/v1/foods/search');
    url.searchParams.set('query', barcode);
    url.searchParams.set('pageSize', '50');
    url.searchParams.set('dataType', 'Branded');
  } else if (body.action === 'detail') {
    const fdcId = digitsOnly(body.fdcId ?? '');
    if (!fdcId) return jsonResponse({ error: 'Invalid FDC ID' }, 400);
    url = new URL(`https://api.nal.usda.gov/fdc/v1/food/${fdcId}`);
  } else {
    return jsonResponse({ error: 'Unknown action' }, 400);
  }

  url.searchParams.set('api_key', apiKey);
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  const payload = await response.json().catch(() => ({ error: 'Invalid USDA response' }));
  if (!response.ok) {
    console.error('USDA lookup failed:', response.status);
    return jsonResponse({ error: 'USDA lookup failed', status: response.status }, 502);
  }
  return jsonResponse(payload);
});
