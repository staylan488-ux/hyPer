import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';
import type { Food } from '@/types';

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: vi.fn(), onAuthStateChange: vi.fn(), signOut: vi.fn() }, from: vi.fn() },
}));

import { useAuthStore } from '@/stores/authStore';
import { clearSavedFoodsCache, readSavedFoodsCache, writeSavedFoodsCache } from '@/lib/savedFoodsCache';

const oats: Food = {
  id: 'food-1', user_id: 'user-a', name: 'Overnight oats', calories: 320, protein: 18, carbs: 44, fat: 9,
  serving_size: 1, serving_unit: 'serving', source: 'custom', fdc_id: null,
};

const signIn = (id: string | null) => useAuthStore.setState({ user: id ? ({ id } as User) : null });

beforeEach(() => {
  clearSavedFoodsCache();
  signIn('user-a');
});

describe('saved foods cache', () => {
  it('seeds the same account from its last fetched list', () => {
    writeSavedFoodsCache('user-a', [oats]);
    expect(readSavedFoodsCache('user-a')).toEqual([oats]);
  });

  it("never shows one account's saved foods to another", () => {
    writeSavedFoodsCache('user-a', [oats]);

    expect(readSavedFoodsCache('user-b')).toBeNull();
    // the mismatch discards it, so it can't come back for anyone
    expect(readSavedFoodsCache('user-a')).toBeNull();
  });

  it('shows nothing without a signed-in user', () => {
    writeSavedFoodsCache('user-a', [oats]);
    expect(readSavedFoodsCache(undefined)).toBeNull();
  });

  it('is dropped on sign-out', () => {
    writeSavedFoodsCache('user-a', [oats]);
    signIn(null);
    signIn('user-a');

    expect(readSavedFoodsCache('user-a')).toBeNull();
  });

  it('is dropped when the store switches to another account', () => {
    writeSavedFoodsCache('user-a', [oats]);
    signIn('user-b');
    signIn('user-a');

    expect(readSavedFoodsCache('user-a')).toBeNull();
  });

  it('survives unrelated store updates for the same account', () => {
    writeSavedFoodsCache('user-a', [oats]);
    useAuthStore.setState({ loading: false });

    expect(readSavedFoodsCache('user-a')).toEqual([oats]);
  });
});
