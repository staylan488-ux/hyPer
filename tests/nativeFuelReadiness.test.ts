import { beforeEach, describe, expect, it, vi } from 'vitest';

const reads = vi.hoisted(() => ({
  user: 'user-1',
  food: vi.fn(),
  groups: { data: [], error: null } as { data: unknown[]; error: { message: string } | null },
}));
vi.mock('@/lib/sessionUser', () => ({ getSessionUserId: async () => reads.user }));
vi.mock('@/lib/nutritionLogQueries', () => ({ fetchNutritionLogsWithFoods: reads.food }));
vi.mock('@/lib/nutritionDay', async (original) => ({
  ...(await original<typeof import('@/lib/nutritionDay')>()),
  ensureDefaultGroups: async () => ({ ok: true, groups: [] }),
}));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        gte: () => chain,
        lte: () => chain,
        order: async () => reads.groups,
      };
      return chain;
    },
  },
}));

import { invalidateAccountScope } from '@/lib/accountScope';
import { resetFuel, todayTotalsShown, useFuelStore } from '../native/src/lib/fuel';

const DAY = '2026-11-03';
const logged = { date: DAY, servings: 1, food: { calories: 500, protein: 30, carbs: 40, fat: 25 } };

beforeEach(() => {
  invalidateAccountScope();
  resetFuel();
  reads.user = 'user-1';
  reads.groups = { data: [], error: null };
  reads.food.mockReset().mockResolvedValue({ data: [logged], error: null });
  useFuelStore.setState({ selected: DAY });
});

describe('nutrition readiness for widgets', () => {
  it('does not treat a failed initial food read as a successfully empty day', async () => {
    reads.food.mockResolvedValue({ data: null, error: { message: 'offline' } });
    await useFuelStore.getState().loadToday(DAY);
    expect(useFuelStore.getState().todayLoadedForUserId).toBeNull();
    expect(useFuelStore.getState().todayLoadedKey).toBeNull();

    reads.food.mockResolvedValue({ data: [], error: null });
    await useFuelStore.getState().loadToday(DAY);
    expect(useFuelStore.getState()).toMatchObject({
      todayLoadedForUserId: 'user-1', todayLoadedKey: DAY, todayTotals: { calories: 0, protein: 0 },
    });
  });

  it('keeps good totals through a failed refresh, without assigning them to a new day', async () => {
    await useFuelStore.getState().loadToday(DAY);
    expect(useFuelStore.getState().todayTotals.calories).toBe(500);
    reads.food.mockResolvedValue({ data: null, error: { message: 'offline' } });

    await useFuelStore.getState().loadToday(DAY);
    expect(useFuelStore.getState()).toMatchObject({ todayLoadedKey: DAY, todayTotals: { calories: 500 } });
    await useFuelStore.getState().loadToday('2026-11-04');
    expect(useFuelStore.getState()).toMatchObject({
      todayKey: '2026-11-04', todayLoadedKey: DAY, todayTotals: { calories: 500 },
    });
  });

  it('shows nothing eaten on a new day whose food read failed, not yesterday’s totals', async () => {
    await useFuelStore.getState().loadToday(DAY);
    expect(todayTotalsShown(useFuelStore.getState()).calories).toBe(500);

    reads.food.mockResolvedValue({ data: null, error: { message: 'offline' } });
    await useFuelStore.getState().loadToday('2026-11-04');
    expect(todayTotalsShown(useFuelStore.getState())).toEqual({ calories: 0, protein: 0, carbs: 0, fat: 0 });

    reads.food.mockResolvedValue({ data: [{ ...logged, date: '2026-11-04' }], error: null });
    await useFuelStore.getState().loadToday('2026-11-04');
    expect(todayTotalsShown(useFuelStore.getState()).calories).toBe(500);
  });

  it('does not publish readiness while a group read failed', async () => {
    reads.groups.error = { message: 'offline' };
    await useFuelStore.getState().loadToday(DAY);
    expect(useFuelStore.getState().todayLoadedKey).toBeNull();
  });

  it('drops a day-only response that returns after sign-out, even when the same user signs back in', async () => {
    useFuelStore.setState({ selected: '2026-10-01' });
    let finish!: (result: { data: typeof logged[]; error: null }) => void;
    reads.food.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const pending = useFuelStore.getState().loadToday(DAY);
    await Promise.resolve();

    invalidateAccountScope();
    resetFuel();
    finish({ data: [logged], error: null });
    await pending;
    expect(useFuelStore.getState()).toMatchObject({
      todayLoadedForUserId: null, todayLoadedKey: null, todayTotals: { calories: 0 },
    });
  });

  it('records the owner of a successful day-only read and clears it on account reset', async () => {
    useFuelStore.setState({ selected: '2026-10-01' });
    await useFuelStore.getState().loadToday(DAY);
    expect(useFuelStore.getState()).toMatchObject({
      todayLoadedForUserId: 'user-1', todayLoadedKey: DAY, todayTotals: { calories: 500 },
    });
    resetFuel();
    reads.user = 'user-2';
    reads.food.mockResolvedValue({ data: null, error: { message: 'offline' } });
    await useFuelStore.getState().loadToday(DAY);
    expect(useFuelStore.getState().todayLoadedForUserId).toBeNull();
  });
});
