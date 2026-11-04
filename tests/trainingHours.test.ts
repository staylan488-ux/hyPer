import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ from: vi.fn(), userId: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: mocks.from } }));
vi.mock('@/lib/sessionUser', () => ({ getSessionUserId: mocks.userId }));

import { fetchTrainingHours } from '@/lib/trainingHours';

// Answers the training-hours query with this result.
function answer(result: { data: unknown; error: unknown } | Error) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    gte: () => chain,
    order: () => (result instanceof Error ? Promise.reject(result) : Promise.resolve(result)),
  };
  mocks.from.mockReturnValue(chain);
}

beforeEach(() => {
  mocks.from.mockReset();
  mocks.userId.mockReset().mockResolvedValue('user-1');
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('fetchTrainingHours', () => {
  it('tells a failed read from eight weeks of no training', async () => {
    answer({ data: null, error: { message: 'offline' } });
    await expect(fetchTrainingHours()).resolves.toBeNull();

    answer(new Error('network down'));
    await expect(fetchTrainingHours()).resolves.toBeNull();
  });

  it('gives eight empty weeks for an account with no finished workouts', async () => {
    answer({ data: [], error: null });
    const weeks = await fetchTrainingHours();
    expect(weeks).toHaveLength(8);
    expect(weeks!.every((week) => week.totalMinutes === 0)).toBe(true);
  });

  it('gives empty weeks, without a request, when nobody is signed in', async () => {
    mocks.userId.mockResolvedValue(null);
    expect(await fetchTrainingHours()).toHaveLength(8);
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
