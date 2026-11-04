import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchHistoryMonth } from '@/lib/historyMonth';
import type { Split, Workout } from '@/types';

const mocks = vi.hoisted(() => ({
  workouts: vi.fn(),
  activities: vi.fn(),
  from: vi.fn(),
  splits: [] as unknown[],
}));

vi.mock('@/stores/appStore', () => ({
  useAppStore: {
    getState: () => ({ fetchWorkoutsByMonth: mocks.workouts, fetchActivitySessionsByMonth: mocks.activities, splits: mocks.splits }),
  },
}));
vi.mock('@/lib/supabase', () => ({ supabase: { from: mocks.from } }));

const month = new Date(2026, 10, 1);
const workoutBase = { user_id: 'user-1', date: '2026-11-03', notes: null, completed: true, sets: [] };
const workouts: Workout[] = [
  { ...workoutBase, id: 'program-workout', split_day_id: 'day-1' },
  { ...workoutBase, id: 'flex-workout', split_day_id: null },
];
const program = (days: { id: string; day_name: string }[]) =>
  ({ id: 'split-1', days: days.map((day, index) => ({ ...day, split_id: 'split-1', day_order: index, exercises: [] })) }) as unknown as Split;

// What each table was asked for, by the ids in its request.
let asked: Record<string, string[]>;
function respond(table: string, errorTable?: string) {
  return {
    select: () => ({
      in: async (_column: string, ids: string[]) => {
        asked[table] = ids;
        const rows = table === 'split_days'
          ? [{ id: 'day-1', day_name: 'Upper' }, { id: 'day-2', day_name: 'Lower' }]
          : [{ workout_id: 'flex-workout', day_label: 'Quick session' }];
        return {
          data: rows.filter((row) => ids.includes('id' in row ? row.id : row.workout_id)),
          error: table === errorTable ? new Error('Name lookup failed') : null,
        };
      },
    }),
  };
}

beforeEach(() => {
  asked = {};
  mocks.splits = [];
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

  it('names program days the store holds without reading them, and still reads session labels', async () => {
    mocks.splits = [program([{ id: 'day-1', day_name: 'Upper' }])];
    const result = await fetchHistoryMonth(month);
    expect(asked).toEqual({ workout_day_plans: ['flex-workout'] });
    expect(result.workouts[0].split_day).toEqual({ day_name: 'Upper' });
    expect(result.workouts[1]).toMatchObject({ split_day: null, day_label: 'Quick session' });
  });

  it('reads only the program days the store does not hold', async () => {
    mocks.splits = [program([{ id: 'day-1', day_name: 'Upper' }])];
    mocks.workouts.mockResolvedValue([
      { ...workoutBase, id: 'a', split_day_id: 'day-1' },
      { ...workoutBase, id: 'b', split_day_id: 'day-2' },
      { ...workoutBase, id: 'c', split_day_id: 'day-gone' },
    ]);
    const result = await fetchHistoryMonth(month);
    expect(asked).toEqual({ split_days: ['day-2', 'day-gone'] });
    expect(result.workouts.map((workout) => workout.split_day?.day_name)).toEqual(['Upper', 'Lower', 'Unknown']);
  });

  it('makes no name request when every program day is known and nothing is flexible', async () => {
    mocks.splits = [program([{ id: 'day-1', day_name: 'Upper' }])];
    mocks.workouts.mockResolvedValue([workouts[0]]);
    const result = await fetchHistoryMonth(month);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(result.workouts[0].split_day).toEqual({ day_name: 'Upper' });
  });

  it('names a known day with no name Unknown, as when it is read', async () => {
    mocks.splits = [program([{ id: 'day-1', day_name: '' }])];
    mocks.workouts.mockResolvedValue([workouts[0]]);
    const result = await fetchHistoryMonth(month);
    expect(result.workouts[0].split_day).toEqual({ day_name: 'Unknown' });
  });
});
