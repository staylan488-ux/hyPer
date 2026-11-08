import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { NutritionProfile } from '@/lib/nutritionProfile';

// A target or profile read that began before a save lands after it: it holds
// what the save replaced, so it must not put the old numbers back.

type Read = { data: unknown; error: { message: string } | null };

const backend = vi.hoisted(() => ({
  reads: [] as Array<{ resolve: (value: Read) => void }>,
  saved: null as unknown,
  profiles: [] as Array<{ resolve: (value: unknown) => void }>,
  savedProfile: null as unknown,
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => new Promise((resolve) => { backend.reads.push({ resolve }); }),
        }),
      }),
      upsert: () => ({ select: () => ({ single: async () => ({ data: backend.saved, error: null }) }) }),
    }),
    auth: { getSession: async () => ({ data: { session: { user: { id: 'user-1' } } } }) },
  },
}));
vi.mock('@/lib/whoopClient', () => ({ fetchWhoopBatchRemote: vi.fn(), startWhoopConnect: vi.fn(), disconnectWhoopRemote: vi.fn() }));
vi.mock('@/lib/nutritionProfile', async (original) => ({
  ...(await original<typeof import('@/lib/nutritionProfile')>()),
  getNutritionProfile: () => new Promise((resolve) => { backend.profiles.push({ resolve }); }),
  saveNutritionProfile: async () => backend.savedProfile,
}));

import { useAppStore } from '@/stores/appStore';

const target = { id: 'macro-1', user_id: 'user-1', calories: 2400, protein: 180, carbs: 250, fat: 70, source: 'manual' };
const flush = async () => { for (let tick = 0; tick < 10; tick += 1) await Promise.resolve(); };

beforeEach(() => {
  backend.reads = [];
  backend.profiles = [];
  useAppStore.setState({ macroTarget: null, macroTargetLoadedForUserId: null, nutritionProfile: null, nutritionProfileLoadedForUserId: null });
});

describe('targets saved while a read runs', () => {
  it('keeps the saved targets when the older read lands after the save', async () => {
    const reading = useAppStore.getState().fetchMacroTarget();
    await flush();
    expect(backend.reads).toHaveLength(1);

    backend.saved = { ...target, calories: 2200 };
    await useAppStore.getState().updateMacroTarget({ calories: 2200, protein: 180, carbs: 250, fat: 70 });
    backend.reads[0].resolve({ data: target, error: null });
    await reading;

    expect(useAppStore.getState().macroTarget).toMatchObject({ calories: 2200 });
  });

  it('still shows a read that began after the save', async () => {
    backend.saved = { ...target, calories: 2200 };
    await useAppStore.getState().updateMacroTarget({ calories: 2200, protein: 180, carbs: 250, fat: 70 });
    const reading = useAppStore.getState().fetchMacroTarget();
    await flush();
    backend.reads[0].resolve({ data: { ...target, calories: 2100 }, error: null });
    await reading;

    expect(useAppStore.getState()).toMatchObject({ macroTarget: { calories: 2100 }, macroTargetLoadedForUserId: 'user-1' });
  });

  it('keeps a saved profile when the older profile read lands after it', async () => {
    const before = { user_id: 'user-1', goal: 'maintain' } as NutritionProfile;
    const after = { user_id: 'user-1', goal: 'cut' } as NutritionProfile;
    const reading = useAppStore.getState().fetchNutritionProfile();
    await flush();
    expect(backend.profiles).toHaveLength(1);

    backend.savedProfile = after;
    useAppStore.setState({ nutritionProfile: before });
    await useAppStore.getState().updateNutritionProfile({ goal: 'cut' } as never);
    backend.profiles[0].resolve(before);
    await reading;

    expect(useAppStore.getState().nutritionProfile).toBe(after);
  });
});
