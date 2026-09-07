import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveMealDestination } from '@/lib/mealDestination';

const mocks = vi.hoisted(() => ({ from: vi.fn(), select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: mocks.from } }));

beforeEach(() => {
  mocks.from.mockReturnValue(mocks);
  mocks.select.mockReturnValue(mocks);
  mocks.eq.mockReturnValue(mocks);
  mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
});

describe('meal destination resolution', () => {
  it('looks up a restored draft destination by ID, owner and its original date', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: { id: 'group-a', kind: 'meal', label: 'lunch' }, error: null });
    await expect(resolveMealDestination('group-a', 'user-a', '2026-09-06')).resolves.toEqual({ groupId: 'group-a', mealType: 'lunch' });
    expect(mocks.from).toHaveBeenCalledExactlyOnceWith('nutrition_groups');
    expect(mocks.select).toHaveBeenCalledExactlyOnceWith('*');
    expect(mocks.eq.mock.calls).toEqual([['id', 'group-a'], ['user_id', 'user-a'], ['date', '2026-09-06']]);
    expect(mocks.maybeSingle).toHaveBeenCalledTimes(1);
  });

  it.each([
    { kind: 'meal', label: null, expected: null },
    { kind: 'snack', label: null, expected: 'snack' },
    { kind: 'meal', label: 'dinner', expected: 'dinner' },
  ])('maps $kind / $label to the legacy meal type', async ({ kind, label, expected }) => {
    mocks.maybeSingle.mockResolvedValue({ data: { id: 'group-a', kind, label }, error: null });
    await expect(resolveMealDestination('group-a', 'user-a', '2026-09-06')).resolves.toEqual({ groupId: 'group-a', mealType: expected });
  });

  it('returns Unassigned when a destination was deleted or no longer belongs to the owner/day', async () => {
    await expect(resolveMealDestination('deleted-group', 'user-a', '2026-09-06')).resolves.toEqual({ groupId: null, mealType: null });
  });

  it('keeps lookup failures distinct from a deleted destination', async () => {
    const error = { message: 'Network unavailable' };
    mocks.maybeSingle.mockResolvedValue({ data: null, error });
    await expect(resolveMealDestination('group-a', 'user-a', '2026-09-06')).rejects.toBe(error);
  });

  it('propagates rejected requests without silently reassigning a draft', async () => {
    mocks.maybeSingle.mockRejectedValue(new Error('Connection lost'));
    await expect(resolveMealDestination('group-a', 'user-a', '2026-09-06')).rejects.toThrow('Connection lost');
  });

  it('makes no database request when the meal is already Unassigned', async () => {
    await expect(resolveMealDestination(null, 'user-a', '2026-09-06')).resolves.toEqual({ groupId: null, mealType: null });
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
