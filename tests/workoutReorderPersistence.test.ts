import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workout, WorkoutDayPlan } from '@/types';

const db = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: db }));
import { useAppStore } from '@/stores/appStore';

const plan: WorkoutDayPlan = {
  id: 'plan', workout_id: 'workout', day_label: 'Pull',
  items: [
    { exercise_id: 'a', order: 0, target_sets: 2, notes: 'Keep this', superset_group_id: 'pair' },
    { exercise_id: 'b', order: 1, target_sets: 2, superset_group_id: 'pair' },
    { exercise_id: 'hidden', order: 2, hidden: true, target_sets: 1 },
  ],
};

beforeEach(() => {
  db.from.mockReset();
  useAppStore.setState({ currentWorkout: { id: 'workout', sets: [], split_day_id: null } as unknown as Workout,
    currentWorkoutDayPlan: structuredClone(plan) });
});

function pendingSave() {
  let finish!: (result: unknown) => void;
  const chain = { update: vi.fn(), eq: vi.fn(), select: vi.fn(), single: vi.fn() };
  chain.update.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.select.mockReturnValue(chain);
  chain.single.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  db.from.mockReturnValue(chain);
  return { chain, finish };
}

describe('movement reorder persistence', () => {
  it('keeps hidden items and metadata and surfaces failed saves without changing local order', async () => {
    const { chain, finish } = pendingSave();
    const before = useAppStore.getState().currentWorkoutDayPlan;
    const save = useAppStore.getState().reorderWorkoutExercises('workout', ['b', 'a']);
    expect(chain.update).toHaveBeenCalledWith({ items: [
      { ...plan.items[1], order: 0 }, { ...plan.items[0], order: 1 }, plan.items[2],
    ] });
    const error = { message: 'Offline' };
    finish({ data: null, error });
    await expect(save).rejects.toBe(error);
    expect(useAppStore.getState().currentWorkoutDayPlan).toBe(before);
  });

  it.each(['session', 'plan edit'])('does not overwrite a newer %s after a delayed save', async (change) => {
    const { chain, finish } = pendingSave();
    const save = useAppStore.getState().reorderWorkoutExercises('workout', ['b', 'a']);
    const newer = { ...plan, day_label: 'Newer', ...(change === 'session' ? { id: 'other-plan', workout_id: 'other' } : {}) };
    useAppStore.setState({ currentWorkoutDayPlan: newer,
      ...(change === 'session' ? { currentWorkout: { id: 'other', sets: [] } as unknown as Workout } : {}) });
    finish({ data: { ...plan, items: chain.update.mock.calls[0][0].items }, error: null });
    await save;
    expect(useAppStore.getState().currentWorkoutDayPlan).toBe(newer);
  });
});
