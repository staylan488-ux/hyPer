import * as dates from 'date-fns';
import { vi } from 'vitest';
import { create } from 'zustand';

import { captureAccountScope } from '@/lib/accountScope';
import * as groups from '@/lib/nutritionGroups';
import * as macros from '@/lib/nutritionMacros';
import * as repeated from '@/lib/repeatEntries';
import * as meals from '../../native/src/lib/meals';
import type { FoodLog } from '../../native/src/lib/fuel';
import { loadNativeModule } from './loadNativeModule';

/** Real Fuel store; only database reads/writes are stand-ins. */
export function nativeFuelStore(userId = 'user-1') {
  const read = vi.fn(async (): Promise<{ data: FoodLog[] | null; error: unknown }> => ({ data: [], error: null }));
  const copy = vi.fn(async () => ({ ok: true }));
  const move = vi.fn(async () => ({}));
  const query = {
    select: () => query, eq: () => query, gte: () => query, lte: () => query,
    order: async () => ({ data: [], error: null }),
  };
  const fuel = loadNativeModule<typeof import('../../native/src/lib/fuel')>('lib/fuel.ts', {
    'date-fns': dates,
    zustand: { create },
    '@/lib/accountScope': { captureAccountScope },
    '@/lib/nutritionLogQueries': { fetchNutritionLogsWithFoods: read },
    '@/lib/nutritionDay': { ensureDefaultGroups: async () => null, moveEntryToPreviousDay: move },
    '@/lib/nutritionGroups': groups,
    '@/lib/nutritionMacros': macros,
    '@/lib/repeatEntries': { ...repeated, saveRepeatedEntries: copy },
    '@/lib/sessionUser': { getSessionUserId: async () => userId },
    '@/lib/supabase': { supabase: { from: () => query } },
    './meals': meals,
  });
  return { ...fuel, read, copy, move };
}
