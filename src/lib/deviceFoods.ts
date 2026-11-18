// Foods whose details may only be kept on the phone.
//
// FatSecret's terms, and their written answer to hyPer (2026-11-16,
// docs/fatsecret.md): hyPer's servers may keep a FatSecret food's IDs and
// aggregated totals for good, but its name and nutrition values for 24 hours
// at most. The user's own device may keep everything.
//
// So a FatSecret food's row in `foods` is a stub: its IDs, a placeholder name
// and zeros. What the food is (name, serving, calories and macros) lives here,
// in the phone's storage, under those IDs. A read fills the stub in from the
// phone; a phone that has never seen the food asks FatSecret for it again by
// ID (src/lib/deviceFoodRefill.ts) and keeps the answer.
import type { Food } from '@/types';

/** The name a stub row carries on the server, and what shows when the details cannot be had. */
export const DEVICE_ONLY_FOOD_NAME = 'Brand food';

export type DeviceFoodDetails = Pick<Food, 'name' | 'calories' | 'protein' | 'carbs' | 'fat' | 'serving_size' | 'serving_unit'>
  & { serving_label?: string };

type Identified = { source?: string | null; external_source?: string | null; external_id?: string | null };

const KEY_PREFIX = 'hyper:device-food:';
/** FatSecret's food and serving IDs, as mapFatSecretFood writes them. */
const FATSECRET_ID = /^\d{1,20}:\d{1,20}$/;

// What this session has read or written. Tests run without a phone's storage;
// the same rules then hold for as long as the process lives.
const memory = new Map<string, string>();

function storage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage ?? null;
  } catch {
    return null;
  }
}

// Lists read the same food many times over; only this module writes these
// keys, so what it has already read or written is current.
function read(key: string): string | null {
  const known = memory.get(key);
  if (known) return known;
  try {
    const kept = storage()?.getItem(key) ?? null;
    if (kept) memory.set(key, kept);
    return kept;
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  memory.set(key, value);
  try {
    storage()?.setItem(key, value);
  } catch { /* this session still has it */ }
}

/**
 * The key a food's details are kept under on the phone, or null for a food
 * that lives on the server like any other (USDA, your own, Open Food Facts).
 */
export function deviceFoodKey(food: Identified): string | null {
  const provider = food.external_source ?? food.source;
  if (provider !== 'fatsecret' || !food.external_id || !FATSECRET_ID.test(food.external_id)) return null;
  return `fatsecret:${food.external_id}`;
}

/** FatSecret's food ID and serving ID from a key. */
export function deviceFoodIds(key: string): { foodId: string; servingId: string } | null {
  const match = /^fatsecret:(\d+):(\d+)$/.exec(key);
  return match ? { foodId: match[1], servingId: match[2] } : null;
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** A database row can carry its numbers as text ("72.5"). */
const asNumber = (value: unknown): unknown => (typeof value === 'string' && value.trim() !== '' ? Number(value) : value);

function parseDetails(raw: string | null): DeviceFoodDetails | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<DeviceFoodDetails> | null;
    if (!value || typeof value.name !== 'string' || !value.name.trim() || value.name === DEVICE_ONLY_FOOD_NAME) return null;
    if (!finite(value.calories) || !finite(value.protein) || !finite(value.carbs) || !finite(value.fat)) return null;
    if (!finite(value.serving_size) || value.serving_size <= 0 || typeof value.serving_unit !== 'string' || !value.serving_unit) return null;
    return {
      name: value.name,
      calories: value.calories,
      protein: value.protein,
      carbs: value.carbs,
      fat: value.fat,
      serving_size: value.serving_size,
      serving_unit: value.serving_unit,
      ...(typeof value.serving_label === 'string' && value.serving_label ? { serving_label: value.serving_label } : {}),
    };
  } catch {
    return null;
  }
}

/** What this phone knows about a device-only food, or null. */
export function readDeviceFood(key: string): DeviceFoodDetails | null {
  return parseDetails(read(KEY_PREFIX + key));
}

/**
 * True for a row that carries no details of its own: a stub as the server
 * keeps it, or one a read could not fill in. Its numbers are not the food's.
 */
export function isDeviceFoodStub(food: Identified & { name?: string | null }): boolean {
  return deviceFoodKey(food) !== null && food.name === DEVICE_ONLY_FOOD_NAME;
}

/**
 * Keeps a device-only food's details on this phone. A stub is never kept: it
 * would overwrite the real details with a placeholder. Returns true when the
 * food is one the phone keeps.
 */
export function keepDeviceFood(food: Identified & Partial<DeviceFoodDetails>): boolean {
  const key = deviceFoodKey(food);
  if (!key || isDeviceFoodStub(food)) return false;
  const details = parseDetails(JSON.stringify({
    name: food.name,
    calories: asNumber(food.calories),
    protein: asNumber(food.protein),
    carbs: asNumber(food.carbs),
    fat: asNumber(food.fat),
    serving_size: asNumber(food.serving_size),
    serving_unit: food.serving_unit,
    serving_label: food.serving_label,
  }));
  if (!details) return false;
  write(KEY_PREFIX + key, JSON.stringify(details));
  return true;
}

/** What the server keeps of a device-only food: its IDs and nothing of what it is. */
export function deviceFoodStub(externalId: string) {
  return {
    name: DEVICE_ONLY_FOOD_NAME,
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    serving_size: 1,
    serving_unit: 'serving',
    source: 'fatsecret' as const,
    fdc_id: null,
    external_source: 'fatsecret',
    external_id: externalId,
  };
}

/**
 * A food as a screen should see it: a device-only food with this phone's
 * details in place of whatever the row says. A row that still holds details
 * from before this rule (an older build saved them on the server) keeps them
 * and hands them to the phone, so the server's copy can be cleared later.
 * Other foods come back untouched.
 */
export function withDeviceFood<F extends Identified & { name?: string | null }>(food: F): F {
  const key = deviceFoodKey(food);
  if (!key) return food;
  const details = readDeviceFood(key);
  if (details) return { ...food, ...details };
  if (!isDeviceFoodStub(food)) keepDeviceFood(food as F & Partial<DeviceFoodDetails>);
  return food;
}

/** Test seam: forget what this session kept outside the phone's storage. */
export function forgetDeviceFoodsForTest(): void {
  memory.clear();
}
