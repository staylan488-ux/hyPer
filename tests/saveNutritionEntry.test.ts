import { beforeEach, describe, expect, it, vi } from 'vitest';
import { persistNutritionEntry } from '@/lib/saveNutritionEntry';

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  from: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  upsert: vi.fn(),
  eq: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getUser: mocks.getUser }, from: mocks.from },
}));

const payload = {
  food_id: 'food-1',
  servings: 1.5,
  meal_type: 'dinner' as const,
  group_id: 'group-1',
  source: 'barcode_saved',
  date: '2026-09-04',
  logged_at: '2026-09-05T03:45:00.000Z',
};

function mockWrite(error: unknown = null) {
  mocks.insert.mockResolvedValue({ error });
  mocks.upsert.mockResolvedValue({ error });
  mocks.eq.mockImplementation((column: string) => (
    column === 'user_id' ? Promise.resolve({ error }) : mocks
  ));
}

beforeEach(() => {
  mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
  mocks.from.mockReturnValue(mocks);
  mocks.update.mockReturnValue(mocks);
  mockWrite();
});

describe('nutrition entry persistence', () => {
  it('inserts the selected date, time, group and source together', async () => {
    await persistNutritionEntry(payload);

    expect(mocks.from).toHaveBeenCalledExactlyOnceWith('nutrition_logs');
    expect(mocks.insert).toHaveBeenCalledExactlyOnceWith({ user_id: 'user-1', ...payload });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('updates the complete entry and allows clearing its group, scoped to its owner', async () => {
    const unassigned = { ...payload, group_id: null, meal_type: null };
    await persistNutritionEntry(unassigned, 'entry-1');

    expect(mocks.update).toHaveBeenCalledExactlyOnceWith(unassigned);
    expect(mocks.eq.mock.calls).toEqual([['id', 'entry-1'], ['user_id', 'user-1']]);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('reuses the same trial entry id after an uncertain save, keeping the complete payload', async () => {
    mocks.upsert.mockRejectedValueOnce(new Error('Connection lost'));

    await expect(persistNutritionEntry(payload, undefined, 'retry-1')).rejects.toThrow('Connection lost');
    await persistNutritionEntry(payload, undefined, 'retry-1');

    expect(mocks.upsert.mock.calls).toEqual([
      [{ id: 'retry-1', user_id: 'user-1', ...payload }, { onConflict: 'id' }],
      [{ id: 'retry-1', user_id: 'user-1', ...payload }, { onConflict: 'id' }],
    ]);
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('updates an existing entry instead of creating a trial entry when both ids are supplied', async () => {
    await persistNutritionEntry(payload, 'entry-1', 'retry-1');

    expect(mocks.update).toHaveBeenCalledExactlyOnceWith(payload);
    expect(mocks.eq.mock.calls).toEqual([['id', 'entry-1'], ['user_id', 'user-1']]);
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it.each(['logged_at', 'meal_type', 'created_at', 'group_id', 'source'])(
    'rejects a missing %s column without retrying an incomplete insert, update or upsert',
    async (column) => {
      const error = { message: `column nutrition_logs.${column} does not exist in schema cache` };
      mockWrite(error);

      await expect(persistNutritionEntry(payload)).rejects.toBe(error);
      await expect(persistNutritionEntry(payload, 'entry-1')).rejects.toBe(error);
      await expect(persistNutritionEntry(payload, undefined, 'retry-1')).rejects.toBe(error);

      expect(mocks.insert).toHaveBeenCalledExactlyOnceWith({ user_id: 'user-1', ...payload });
      expect(mocks.update).toHaveBeenCalledExactlyOnceWith(payload);
      expect(mocks.upsert).toHaveBeenCalledExactlyOnceWith(
        { id: 'retry-1', user_id: 'user-1', ...payload }, { onConflict: 'id' },
      );
      expect(mocks.from).toHaveBeenCalledTimes(3);
    },
  );

  it('does not write without a signed-in user', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });

    await expect(persistNutritionEntry(payload)).rejects.toThrow('No user found');
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
