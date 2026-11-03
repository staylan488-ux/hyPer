import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchHistoryMonth } from '@/lib/historyMonth';
import type { Workout } from '@/types';

const mocks = vi.hoisted(() => ({
  workouts: vi.fn(),
  activities: vi.fn(),
  from: vi.fn(),
}));

vi.mock('@/stores/appStore', () => ({
  useAppStore: {
    getState: () => ({ fetchWorkoutsByMonth: mocks.workouts, fetchActivitySessionsByMonth: mocks.activities }),
  },
}));
vi.mock('@/lib/supabase', () => ({ supabase: { from: mocks.from } }));

const month = new Date(2026, 10, 1);
const workoutBase = { user_id: 'user-1', date: '2026-11-03', notes: null, completed: true, sets: [] };
const workouts: Workout[] = [
  { ...workoutBase, id: 'program-workout', split_day_id: 'day-1' },
  { ...workoutBase, id: 'flex-workout', split_day_id: null },
];

function respond(table: string, errorTable?: string) {
  const result = {
    data: table === 'split_days'
      ? [{ id: 'day-1', day_name: 'Upper' }]
      : [{ workout_id: 'flex-workout', day_label: 'Quick session' }],
    error: table === errorTable ? new Error('Name lookup failed') : null,
  };
  return { select: () => ({ in: async () => result }) };
}

beforeEach(() => {
  mocks.workouts.mockResolvedValue(workouts);
  mocks.activities.mockResolvedValue([]);
  mocks.from.mockImplementation((table: string) => respond(table));
});

describe('History month name loading', () => {
  it.each(['split_days', 'workout_day_plans'])('reports a failed %s read instead of showing missing names', async (failedTable) => {
    mocks.from.mockImplementation((table: string) => respond(table, failedTable));
    await expect(fetchHistoryMonth(month)).rejects.toThrow('Name lookup failed');
  });

  it('returns the complete month once both name reads succeed', async () => {
    const result = await fetchHistoryMonth(month);
    expect(result.workouts[0].split_day?.day_name).toBe('Upper');
    expect(result.workouts[1].day_label).toBe('Quick session');
  });

  it('loads an empty month without requesting any names', async () => {
    mocks.workouts.mockResolvedValue([]);
    await expect(fetchHistoryMonth(month)).resolves.toEqual({ workouts: [], activities: [] });
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
