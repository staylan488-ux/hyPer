// Getting a device-only food's details back onto a phone that does not hold
// them: a new phone, a reinstall, or the test app beside the released one.
//
// The server keeps only FatSecret's food and serving IDs (src/lib/deviceFoods.ts),
// so the phone asks FatSecret for the food again through food-lookup and keeps
// the answer. Readers wait a few seconds for that; a slower answer still lands
// on the phone and is there for the next read.
import { deviceFoodKey, isDeviceFoodStub, keepDeviceFood, readDeviceFood, withDeviceFood } from '@/lib/deviceFoods';
import { deviceFoodKeysInDescription } from '@/lib/mealComposition';
import { FATSECRET_FOODS_PER_REQUEST, fetchFatSecretFoodsSecure } from '@/lib/usdaClient';

/** How long a read waits for missing details before going on without them. */
export const REFILL_WAIT_MS = 6_000;
/** A lookup that failed is not repeated for this long. */
const RETRY_AFTER_MS = 60_000;
/** With FatSecret switched off, nothing is asked for this long. */
const OFF_FOR_MS = 10 * 60_000;

/** FatSecret no longer has these foods or servings: asked once per session. */
const gone = new Set<string>();
const retryAt = new Map<string, number>();
/** One request per key at a time; resolves true when the key was settled (kept or gone). */
const inFlight = new Map<string, Promise<boolean>>();
let offUntil = 0;

async function request(keys: string[]): Promise<Map<string, boolean>> {
  const settled = new Map<string, boolean>();
  try {
    const answer = await fetchFatSecretFoodsSecure(keys);
    if (!answer.configured) {
      offUntil = Date.now() + OFF_FOR_MS;
      // Switched off is an answer: the details cannot be had for now.
      for (const key of keys) settled.set(key, true);
      return settled;
    }
    for (const [key, food] of answer.foods) settled.set(key, keepDeviceFood(food));
    for (const key of answer.gone) {
      gone.add(key);
      settled.set(key, true);
    }
  } catch {
    // counted below as not settled
  }
  for (const key of keys) {
    if (settled.get(key)) continue;
    settled.set(key, false);
    retryAt.set(key, Date.now() + RETRY_AFTER_MS);
  }
  return settled;
}

function start(keys: string[]): void {
  for (let index = 0; index < keys.length; index += FATSECRET_FOODS_PER_REQUEST) {
    const part = keys.slice(index, index + FATSECRET_FOODS_PER_REQUEST);
    const answer = request(part);
    for (const key of part) {
      const mine = answer.then((settled) => settled.get(key) ?? false).finally(() => {
        if (inFlight.get(key) === mine) inFlight.delete(key);
      });
      inFlight.set(key, mine);
    }
  }
}

/**
 * Asks FatSecret again for the device-only foods this phone lacks. Resolves
 * once every key is settled or `waitMs` has passed, whichever is first:
 * `incomplete` is true when a food that may well exist could not be read this
 * time (no connection, a busy provider, a slow answer), so numbers built on
 * these foods would be short.
 */
export async function refillDeviceFoods(keys: Iterable<string>, waitMs = REFILL_WAIT_MS): Promise<{ incomplete: boolean }> {
  const wanted = [...new Set(keys)].filter((key) => !gone.has(key) && !readDeviceFood(key));
  if (wanted.length === 0 || Date.now() < offUntil) return { incomplete: false };

  const now = Date.now();
  const waiting = wanted.filter((key) => !inFlight.has(key) && (retryAt.get(key) ?? 0) > now);
  start(wanted.filter((key) => !inFlight.has(key) && (retryAt.get(key) ?? 0) <= now));
  const running = wanted.flatMap((key) => inFlight.get(key) ?? []);
  if (running.length === 0) return { incomplete: waiting.length > 0 };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), waitMs); });
  const outcome = await Promise.race([Promise.all(running), late]);
  clearTimeout(timer);
  return { incomplete: waiting.length > 0 || outcome === null || outcome.includes(false) };
}

type Readable = {
  name?: string | null;
  description?: string | null;
  source?: string | null;
  external_source?: string | null;
  external_id?: string | null;
};

/** The device-only foods these rows need that this phone does not hold: the rows themselves and built meals' ingredients. */
function missingKeys(foods: readonly Readable[]): string[] {
  const keys: string[] = [];
  for (const food of foods) {
    const key = deviceFoodKey(food);
    if (key && isDeviceFoodStub(food)) keys.push(key);
    if (food.description) keys.push(...deviceFoodKeysInDescription(food.description).filter((part) => !readDeviceFood(part)));
  }
  return keys;
}

/**
 * Food rows as screens should see them: device-only foods filled in from this
 * phone, and from FatSecret again for those it does not hold. A food that
 * could not be filled in stays a stub (isDeviceFoodStub).
 */
export async function resolveDeviceFoods<F extends Readable>(foods: readonly F[], waitMs = REFILL_WAIT_MS): Promise<{ foods: F[]; incomplete: boolean }> {
  const shown = foods.map(withDeviceFood);
  const missing = missingKeys(shown);
  if (missing.length === 0) return { foods: shown, incomplete: false };
  const { incomplete } = await refillDeviceFoods(missing, waitMs);
  return { foods: shown.map(withDeviceFood), incomplete };
}

/** Starts a refill for these rows without waiting for it (lists that are not sums). */
export function refillDeviceFoodsFor(foods: readonly Readable[]): void {
  const missing = missingKeys(foods.map(withDeviceFood));
  if (missing.length > 0) void refillDeviceFoods(missing, 0);
}

/** Test seam: forget what this session learned. */
export function resetDeviceFoodRefillForTest(): void {
  gone.clear();
  retryAt.clear();
  inFlight.clear();
  offUntil = 0;
}
