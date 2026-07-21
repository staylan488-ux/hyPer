// Authenticated USDA FoodData Central proxy. The USDA key remains in Edge
// Function secrets and is never shipped in the browser bundle.
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { corsHeaders, jsonResponse } from '../_shared/oauth.ts';

type FoodLookupRequest =
  | { action: 'search'; query?: string }
  | { action: 'barcode'; barcode?: string }
  | { action: 'open-food-facts-barcode'; barcode?: string }
  | { action: 'fatsecret-barcode'; barcode?: string }
  | { action: 'detail'; fdcId?: string };

// FatSecret OAuth2 client-credentials token, cached per function instance. The
// client id/secret stay in Edge Function secrets and are never shipped to the
// app. NOTE: if the FatSecret OAuth2 app enforces IP allowlisting, Edge
// Function egress IPs are dynamic and calls will be rejected — either disable
// IP restriction on the FatSecret app or proxy through a static-egress host.
let fatSecretToken: { value: string; expiresAt: number } | null = null;

async function fatSecretAccessToken(): Promise<string | null> {
  const clientId = Deno.env.get('FATSECRET_CLIENT_ID') ?? '';
  const clientSecret = Deno.env.get('FATSECRET_CLIENT_SECRET') ?? '';
  if (!clientId || !clientSecret) return null;

  const now = Date.now();
  if (fatSecretToken && fatSecretToken.expiresAt > now + 60_000) return fatSecretToken.value;

  const scope = Deno.env.get('FATSECRET_SCOPE')?.trim() || 'basic barcode';
  const response = await fetch('https://oauth.fatsecret.com/connect/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
    },
    body: new URLSearchParams({ grant_type: 'client_credentials', scope }),
  });
  if (!response.ok) {
    console.error('FatSecret token request failed:', response.status);
    return null;
  }
  const json = await response.json().catch(() => null) as { access_token?: string; expires_in?: number } | null;
  if (!json?.access_token) return null;
  fatSecretToken = { value: json.access_token, expiresAt: now + (Number(json.expires_in) || 86_400) * 1_000 };
  return fatSecretToken.value;
}

// FatSecret's barcode lookup expects a 13-digit GTIN; left-pad shorter codes.
function toGtin13(value: string): string | null {
  const digits = digitsOnly(value);
  if (digits.length < 8 || digits.length > 13) return null;
  return digits.padStart(13, '0');
}

async function fatSecretCall(token: string, params: Record<string, string>): Promise<unknown> {
  const url = new URL('https://platform.fatsecret.com/rest/server.api');
  url.searchParams.set('format', 'json');
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`FatSecret ${params.method} failed: ${response.status}`);
  return response.json();
}

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

  if (body.action === 'fatsecret-barcode') {
    const gtin = toGtin13(body.barcode ?? '');
    if (!gtin) return jsonResponse({ error: 'Invalid barcode' }, 400);
    const token = await fatSecretAccessToken();
    // Not configured (no credentials/scope): tell the client to skip this
    // provider rather than surface an error.
    if (!token) return jsonResponse({ configured: false });
    try {
      const idResult = await fatSecretCall(token, { method: 'food.find_id_for_barcode', barcode: gtin }) as
        { food_id?: { value?: string | number } };
      const foodId = String(idResult?.food_id?.value ?? '').trim();
      if (!foodId || foodId === '0') return jsonResponse({ food: null });
      // food.get.v2 returns the full food object (name, brand, servings) that
      // the client maps via mapFatSecretBarcodeFood.
      const foodResult = await fatSecretCall(token, { method: 'food.get.v2', food_id: foodId });
      return jsonResponse(foodResult);
    } catch (error) {
      console.error('FatSecret barcode lookup failed:', error instanceof Error ? error.message : error);
      return jsonResponse({ error: 'FatSecret lookup failed' }, 502);
    }
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
