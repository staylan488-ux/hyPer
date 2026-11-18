// BRIDGE VERSION, NOT FOR MAIN. This is food-lookup as it runs in production
// before the sign-up cutover (commit fa4ba3f's file plus the USDA search sent
// as a POST, live as version 12), with only the FatSecret lookups from
// docs/fatsecret.md added. Main's food-lookup needs the approval, lookup-limit
// and cache tables the cutover creates and answers 503 without them, so it
// cannot go live alone. Once the cutover is done, deploy main's and delete
// this branch.
//
// Authenticated USDA FoodData Central proxy. The USDA key remains in Edge
// Function secrets and is never shipped in the browser bundle.
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { corsHeaders, jsonResponse } from '../_shared/oauth.ts';
import {
  fatSecretBarcodeId,
  fatSecretError,
  fatSecretFoodAnswer,
  fatSecretFoodParams,
  fatSecretFoods,
  fatSecretSearchFoods,
  fatSecretSearchParams,
  parseFoodIds,
} from './fatsecret.ts';
import { usdaSearchRequest } from './usda.ts';

// `keeps: 'device'` is how a build says it keeps a FatSecret food's name and
// numbers on the phone and only its IDs on the server (src/lib/deviceFoods.ts).
type KeepsOnDevice = { keeps?: string };
type FoodLookupRequest =
  | { action: 'search'; query?: string }
  | { action: 'barcode'; barcode?: string }
  | { action: 'open-food-facts-barcode'; barcode?: string }
  | ({ action: 'fatsecret-barcode'; barcode?: string } & KeepsOnDevice)
  | ({ action: 'fatsecret-search'; query?: string } & KeepsOnDevice)
  | ({ action: 'fatsecret-foods'; ids?: string } & KeepsOnDevice)
  | { action: 'detail'; fdcId?: string };

// A slow provider must degrade to the next one rather than stalling the scan.
const PROVIDER_TIMEOUT_MS = 5_000;

// FatSecret OAuth2 client-credentials token, cached per function instance. The
// client id/secret stay in Edge Function secrets and are never shipped to the
// app. NOTE: FatSecret only issues tokens to the addresses listed for the key
// in its developer console. Edge Function egress addresses change, so the key
// has to allow them, or the token request has to go through a fixed address.
let fatSecretToken: { value: string; expiresAt: number } | null = null;

async function fatSecretAccessToken(): Promise<string | null> {
  const clientId = Deno.env.get('FATSECRET_CLIENT_ID') ?? '';
  const clientSecret = Deno.env.get('FATSECRET_CLIENT_SECRET') ?? '';
  if (!clientId || !clientSecret) return null;

  const now = Date.now();
  if (fatSecretToken && fatSecretToken.expiresAt > now + 60_000) return fatSecretToken.value;

  // With no scope named, FatSecret grants every scope the key has (brand
  // search needs "premier", the scanner "barcode").
  const scope = Deno.env.get('FATSECRET_SCOPE')?.trim();
  const response = await fetch('https://oauth.fatsecret.com/connect/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
    },
    body: new URLSearchParams({ grant_type: 'client_credentials', ...(scope ? { scope } : {}) }),
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
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
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
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

  // Require a real signed-in user, not merely the public anon key (which is a
  // valid project JWT). Without this, anyone who extracts the shipped anon key
  // could drain the server-side USDA/FatSecret quotas. Matches the sibling
  // functions' auth gate.
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return jsonResponse({ error: 'Unauthorized' }, 401);
  const authed = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: authData, error: authError } = await authed.auth.getUser();
  if (authError || !authData.user) return jsonResponse({ error: 'Unauthorized' }, 401);

  const body = await req.json().catch(() => ({})) as FoodLookupRequest;

  if (body.action === 'open-food-facts-barcode') {
    const barcode = normalizeFoodBarcode(body.barcode ?? '');
    if (!barcode) return jsonResponse({ error: 'Invalid barcode' }, 400);

    const url = new URL(`https://world.openfoodfacts.org/api/v2/product/${barcode}.json`);
    url.searchParams.set('fields', 'code,status,product_name,generic_name,brands,serving_size,serving_quantity,serving_quantity_unit,nutrition_data_per,nutriments');
    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'hyPer/0.1 (https://github.com/staylan488-ux/hyPer)',
        },
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      });
      const payload = await response.json().catch(() => ({ error: 'Invalid Open Food Facts response' }));
      if (!response.ok) {
        // OFF v2 returns 404 with {status:0} for an unknown product — a clean
        // "not found", not an error. Pass it through so the client maps it to
        // null and reaches the create-a-product miss path.
        if (response.status === 404) return jsonResponse({ status: 0 });
        console.error('Open Food Facts lookup failed:', response.status);
        return jsonResponse({ error: 'Open Food Facts lookup failed', status: response.status }, 502);
      }
      return jsonResponse(payload);
    } catch (error) {
      console.error('Open Food Facts lookup failed:', error instanceof Error ? error.message : error);
      return jsonResponse({ error: 'Open Food Facts lookup failed' }, 502);
    }
  }

  if (body.action === 'fatsecret-barcode' || body.action === 'fatsecret-search' || body.action === 'fatsecret-foods') {
    // FATSECRET_ENABLED gates the provider so it can be switched off without
    // a redeploy if the key or quota lapses. A build that does not say it
    // keeps FatSecret's details on the phone would save them on the server,
    // which FatSecret's terms forbid, so it is told the provider is off too.
    if (Deno.env.get('FATSECRET_ENABLED') !== '1' || body.keeps !== 'device') return jsonResponse({ configured: false });

    const gtin = body.action === 'fatsecret-barcode' ? toGtin13(body.barcode ?? '') : null;
    if (body.action === 'fatsecret-barcode' && !gtin) return jsonResponse({ error: 'Invalid barcode' }, 400);
    const query = body.action === 'fatsecret-search' ? body.query?.trim() ?? '' : '';
    if (body.action === 'fatsecret-search' && (query.length < 2 || query.length > 120)) return jsonResponse({ error: 'Invalid search query' }, 400);
    const ids = body.action === 'fatsecret-foods' ? parseFoodIds(body.ids) : null;
    if (body.action === 'fatsecret-foods' && !ids) return jsonResponse({ error: 'Invalid food IDs' }, 400);

    // Not configured (no credentials, or a scope the key lacks): tell the
    // client to skip this provider rather than surface an error.
    const token = await fatSecretAccessToken().catch(() => null);
    if (!token) return jsonResponse({ configured: false });
    const getFood = (foodId: string) => fatSecretCall(token, fatSecretFoodParams(foodId));

    // Nothing FatSecret says is cached or stored here: its terms allow a
    // food's details for 24 hours at most, and the phone keeps what it needs.
    // (Main's version also caches a barcode's food ID and counts lookups
    // against each account's limit; both need the cutover's tables.)
    if (body.action === 'fatsecret-search') {
      try {
        const payload = await fatSecretCall(token, fatSecretSearchParams(query));
        const error = fatSecretError(payload);
        if (error) {
          console.error('FatSecret foods.search error:', error.code, error.message);
          return jsonResponse({ error: 'FatSecret search failed' }, 502);
        }
        return jsonResponse({ configured: true, foods: fatSecretSearchFoods(payload) });
      } catch (error) {
        console.error('FatSecret search failed:', error instanceof Error ? error.message : error);
        return jsonResponse({ error: 'FatSecret search failed' }, 502);
      }
    }

    if (body.action === 'fatsecret-foods') {
      return jsonResponse({ configured: true, ...await fatSecretFoods(ids ?? [], getFood) });
    }

    let foodId: string;
    try {
      const found = fatSecretBarcodeId(await fatSecretCall(token, { method: 'food.find_id_for_barcode', barcode: gtin ?? '' }));
      // Surface FatSecret API-level errors (returned with HTTP 200) instead
      // of masking them as "not found".
      if (found.kind === 'error') {
        console.error('FatSecret find_id_for_barcode error:', found.code);
        return jsonResponse({ error: 'FatSecret error' }, 502);
      }
      if (found.kind !== 'found') return jsonResponse({ configured: true, food: null });
      foodId = found.foodId;
    } catch (error) {
      console.error('FatSecret barcode lookup failed:', error instanceof Error ? error.message : error);
      return jsonResponse({ error: 'FatSecret lookup failed' }, 502);
    }
    // The app maps this food with mapFatSecretBarcodeFood.
    const food = await getFood(foodId).then(fatSecretFoodAnswer, () => null);
    // `configured: true` tells the app this function can also read the food
    // again by ID, which a food kept as IDs depends on.
    if (food?.kind === 'found') return jsonResponse({ configured: true, food: food.food });
    if (food?.kind === 'missing') return jsonResponse({ configured: true, food: null });
    console.error('FatSecret food.get failed for a barcode:', food?.code ?? 'no answer');
    return jsonResponse({ error: 'FatSecret lookup failed' }, 502);
  }

  const apiKey = Deno.env.get('USDA_API_KEY') ?? '';
  if (!apiKey) return jsonResponse({ error: 'food-lookup is not configured' }, 500);

  let url: URL;
  let init: RequestInit = { headers: { Accept: 'application/json' } };
  if (body.action === 'search') {
    const query = body.query?.trim() ?? '';
    if (query.length < 2 || query.length > 120) return jsonResponse({ error: 'Invalid search query' }, 400);
    // A POST, not the GET the other lookups use: see usdaSearchRequest.
    ({ url, init } = usdaSearchRequest(query));
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
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) });
  const payload = await response.json().catch(() => ({ error: 'Invalid USDA response' }));
  if (!response.ok) {
    console.error('USDA lookup failed:', response.status);
    return jsonResponse({ error: 'USDA lookup failed', status: response.status }, 502);
  }
  return jsonResponse(payload);
});
