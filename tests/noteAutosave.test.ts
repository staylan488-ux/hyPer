import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createNoteAutosaver, flexiblePlanNoteToWrite, mergeQueuedMovementNotePayload } from '@/lib/noteAutosave';
import { parseWorkoutNotes, serializeWorkoutNotes } from '@/lib/workoutNotes';
import type { WorkoutDayPlan } from '@/types';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createNoteAutosaver', () => {
  it('saves once after the debounce, collapsing edits inside the window', async () => {
    const save = vi.fn().mockResolvedValue(true);
    const saver = createNoteAutosaver({ debounceMs: 1000, save });
    let text = 'P';

    saver.schedule('workout-a', 'bench', () => text);
    await vi.advanceTimersByTimeAsync(600);
    text = 'Pause';
    saver.schedule('workout-a', 'bench', () => text);
    await vi.advanceTimersByTimeAsync(999);
    expect(save).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('workout-a', 'Pause', 'bench');
  });

  it('flushAll sends the latest pending payload once, to the workout captured at schedule time', async () => {
    const save = vi.fn().mockResolvedValue(true);
    const saver = createNoteAutosaver({ debounceMs: 1200, save });
    const notesByWorkout: Record<string, string> = { 'workout-a': 'first' };

    saver.schedule('workout-a', 'squat', () => notesByWorkout['workout-a']);
    notesByWorkout['workout-a'] = 'latest';
    await saver.flushAll();

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('workout-a', 'latest', 'squat');

    // nothing is left to fire later
    await vi.advanceTimersByTimeAsync(5000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('flushes a pending note for workout A to A when the page moves to workout B', async () => {
    const save = vi.fn().mockResolvedValue(true);
    const saver = createNoteAutosaver({ debounceMs: 1200, save });
    const page = { workoutId: 'workout-a', note: 'Elbows in' };
    const build = (workoutId: string) => () => (page.workoutId === workoutId ? page.note : null);

    saver.schedule(page.workoutId, 'row', build(page.workoutId));
    // the page flushes before its refs switch to the next workout
    await saver.flushAll();
    page.workoutId = 'workout-b';
    page.note = '';

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('workout-a', 'Elbows in', 'row');
  });

  it('skips a save whose payload builder reports nothing to save', async () => {
    const save = vi.fn().mockResolvedValue(true);
    const saver = createNoteAutosaver({ debounceMs: 1000, save });

    await expect(saver.saveNow('workout-a', 'bench', () => null)).resolves.toBe('skipped');
    expect(save).not.toHaveBeenCalled();
  });

  it('does not re-send a payload the server already holds', async () => {
    const save = vi.fn().mockResolvedValue(true);
    const saver = createNoteAutosaver({ debounceMs: 1000, save });
    saver.markPersisted('workout-a', '{"movementNotes":{}}');

    await expect(saver.saveNow('workout-a', 'bench', () => '{"movementNotes":{}}')).resolves.toBe('unchanged');
    expect(save).not.toHaveBeenCalled();

    await expect(saver.saveNow('workout-a', 'bench', () => 'changed')).resolves.toBe('saved');
    await expect(saver.saveNow('workout-a', 'bench', () => 'changed')).resolves.toBe('unchanged');
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('reports a failed save and retries the same payload next time', async () => {
    const save = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const saver = createNoteAutosaver({ debounceMs: 1000, save });

    await expect(saver.saveNow('workout-a', 'bench', () => 'note')).resolves.toBe('failed');
    await expect(saver.saveNow('workout-a', 'bench', () => 'note')).resolves.toBe('saved');
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('treats a thrown save as a failure', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const save = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(true);
    const saver = createNoteAutosaver({ debounceMs: 1000, save });

    await expect(saver.saveNow('workout-a', 'bench', () => 'note')).resolves.toBe('failed');
    await expect(saver.saveNow('workout-a', 'bench', () => 'note')).resolves.toBe('saved');
    errorSpy.mockRestore();
  });

  it('cancel drops a pending save', async () => {
    const save = vi.fn().mockResolvedValue(true);
    const saver = createNoteAutosaver({ debounceMs: 1000, save });

    saver.schedule('workout-a', 'bench', () => 'note');
    saver.cancel('workout-a', 'bench');
    await saver.flushAll();
    await vi.advanceTimersByTimeAsync(2000);

    expect(save).not.toHaveBeenCalled();
  });

  it('runs onFlush on every flush, even when the payload is unchanged', async () => {
    const save = vi.fn().mockResolvedValue(true);
    const onFlush = vi.fn();
    const saver = createNoteAutosaver({ debounceMs: 1000, save, prepareFlush: onFlush });
    saver.markPersisted('workout-a', 'same');

    await saver.saveNow('workout-a', 'bench', () => 'same');

    expect(save).not.toHaveBeenCalled();
    expect(onFlush).toHaveBeenCalledWith('workout-a', 'bench');
  });

  it('flushAll waits for in-flight saves and onFlush work to settle', async () => {
    let resolveSave: (value: boolean) => void = () => {};
    let resolveExtra: () => void = () => {};
    const save = vi.fn(() => new Promise<boolean>((resolve) => { resolveSave = resolve; }));
    const onFlush = vi.fn(() => () => new Promise<void>((resolve) => { resolveExtra = resolve; }));
    const saver = createNoteAutosaver({ debounceMs: 1000, save, prepareFlush: onFlush });

    saver.schedule('workout-a', 'bench', () => 'note');
    let settled = false;
    const flushed = saver.flushAll().then(() => { settled = true; });

    await vi.advanceTimersByTimeAsync(0);
    expect(save).not.toHaveBeenCalled();
    expect(settled).toBe(false);

    resolveExtra();
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);

    resolveSave(true);
    await flushed;
    expect(settled).toBe(true);
  });

  it('a plan edit made right after the debounce fires sees the landed note write', async () => {
    // Stands in for the store's plan: the note write replaces it when it lands.
    let plan = { notes: 'from template', hidden: false };
    let landNoteWrite: () => void = () => {};
    const onFlush = vi.fn(() => () => new Promise<void>((resolve) => {
      landNoteWrite = () => { plan = { ...plan, notes: '' }; resolve(); };
    }));
    const saver = createNoteAutosaver({ debounceMs: 1200, save: vi.fn().mockResolvedValue(true), prepareFlush: onFlush });

    saver.schedule('workout-a', 'bench', () => 'cleared');
    await vi.advanceTimersByTimeAsync(1200);
    expect(onFlush).toHaveBeenCalledTimes(1);

    // Nothing is pending any more, but the plan-note write is still in flight.
    const removeExercise = (async () => {
      await saver.flushAll();
      return { ...plan, hidden: true };
    })();
    await vi.advanceTimersByTimeAsync(0);
    landNoteWrite();

    await expect(removeExercise).resolves.toEqual({ notes: '', hidden: true });
    expect(onFlush).toHaveBeenCalledTimes(1);
  });
});

describe('typing a flexible-session note', () => {
  it('sends one plan-note flush for forty keystrokes, not one per keystroke', async () => {
    const save = vi.fn().mockResolvedValue(true);
    const onFlush = vi.fn();
    const saver = createNoteAutosaver({ debounceMs: 1200, save, prepareFlush: onFlush });
    let text = '';

    for (let index = 0; index < 40; index += 1) {
      text += 'x';
      saver.schedule('workout-a', 'bench', () => text);
      await vi.advanceTimersByTimeAsync(100);
    }
    await saver.saveNow('workout-a', 'bench', () => text);
    await vi.advanceTimersByTimeAsync(5000);

    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('workout-a', 'x'.repeat(40), 'bench');
  });
});

describe('overlapping notes and plan edits', () => {
  it('serializes older and newer whole-note writes for a workout', async () => {
    let serverNotes = '';
    const writes: Array<() => void> = [];
    const saver = createNoteAutosaver({ debounceMs: 1000, save: async (_id, payload) => new Promise<boolean>((resolve) => {
      writes.push(() => { serverNotes = payload; resolve(true); });
    }) });
    const first = saver.saveNow('serial', 'row', () => 'first');
    await vi.advanceTimersByTimeAsync(0);
    const second = saver.saveNow('serial', 'row', () => 'second');
    await vi.advanceTimersByTimeAsync(0);
    expect(writes).toHaveLength(1);
    writes[0]();
    await vi.advanceTimersByTimeAsync(0);
    expect(writes).toHaveLength(2);
    writes[1]();
    await Promise.all([first, second]);
    expect(serverNotes).toBe('second');
  });

  it('keeps a pending note across page remount while another movement is edited', async () => {
    let serverNotes = '';
    const writes: Array<{ payload: string; finish: () => void }> = [];
    const options = {
      debounceMs: 1000,
      mergePayload: mergeQueuedMovementNotePayload,
      save: async (_id: string, payload: string) => new Promise<boolean>((resolve) => {
        writes.push({ payload, finish: () => { serverNotes = payload; resolve(true); } });
      }),
    };
    const oldPage = createNoteAutosaver(options);
    const first = oldPage.saveNow('remount', 'row', () => serializeWorkoutNotes({ row: 'First note' }));
    await vi.advanceTimersByTimeAsync(0);
    const newPage = createNoteAutosaver(options);
    // The new page has not yet received the first save's result.
    const second = newPage.saveNow('remount', 'curl', () => serializeWorkoutNotes({ curl: 'Second note' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(writes).toHaveLength(1);
    writes[0].finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(parseWorkoutNotes(writes[1].payload).movementNotes).toEqual({ row: 'First note', curl: 'Second note' });
    writes[1].finish();
    await Promise.all([first, second]);
    expect(parseWorkoutNotes(serverNotes).movementNotes).toEqual({ row: 'First note', curl: 'Second note' });
  });

  it('captures cleared notes before unmount and applies patches against the preceding saved plan', async () => {
    let plan = { curl: 'Old template note', row: '' };
    let drafts: Record<string, string> = { curl: '', row: 'New row note' };
    const writes: Array<() => void> = [];
    const saver = createNoteAutosaver({
      debounceMs: 1000,
      save: async () => true,
      prepareFlush: (_id, exerciseId) => {
        const note = drafts[exerciseId];
        return async () => {
          const next = { ...plan, [exerciseId]: note };
          await new Promise<void>((resolve) => writes.push(() => { plan = next; resolve(); }));
        };
      },
    });
    for (const exerciseId of ['curl', 'row']) saver.schedule('clear-template', exerciseId, () => serializeWorkoutNotes(drafts));
    const flushed = saver.flushAll();
    drafts = {}; // page refs were replaced after the synchronous flush
    expect(writes).toHaveLength(1);
    writes[0]();
    await vi.advanceTimersByTimeAsync(0);
    expect(writes).toHaveLength(2);
    writes[1]();
    expect(await flushed).toBe(true);
    expect(plan).toEqual({ curl: '', row: 'New row note' });
  });

  it('a note typed during a slow reorder keeps the new order', async () => {
    let plan = { order: ['row', 'curl'], note: '' };
    let finishReorder = () => {};
    const saver = createNoteAutosaver({
      debounceMs: 1000,
      save: async () => true,
      prepareFlush: () => async () => { plan = { ...plan, note: 'Elbows in' }; },
    });
    const reorder = saver.runAfterFlush('reorder', async () => {
      const next = { ...plan, order: ['curl', 'row'] };
      await new Promise<void>((resolve) => { finishReorder = () => { plan = next; resolve(); }; });
    });
    await vi.advanceTimersByTimeAsync(0);
    const note = saver.saveNow('reorder', 'row', () => 'Elbows in');
    await vi.advanceTimersByTimeAsync(0);
    expect(plan.note).toBe('');
    finishReorder();
    await Promise.all([reorder, note]);
    expect(plan).toEqual({ order: ['curl', 'row'], note: 'Elbows in' });
  });

  it('retries a failed note on flush before allowing a plan edit', async () => {
    const save = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const saver = createNoteAutosaver({ debounceMs: 1000, save });
    expect(await saver.saveNow('retry', 'row', () => 'Retained draft')).toBe('failed');
    const edit = vi.fn(async () => 'edited');
    expect(await saver.runAfterFlush('retry', edit)).toBe('edited');
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith('retry', 'Retained draft', 'row');
    expect(edit).toHaveBeenCalledOnce();
  });

  it('does not start a queued split-note save after its account scope changes', async () => {
    let currentAccount = true;
    let finishEarlierWrite = () => {};
    const save = vi.fn().mockResolvedValue(true);
    const saver = createNoteAutosaver({ debounceMs: 1000, save, isCurrent: () => currentAccount });
    const earlier = saver.runAfterFlush('account-change', () => new Promise<void>((resolve) => {
      finishEarlierWrite = resolve;
    }));
    await vi.advanceTimersByTimeAsync(0);
    const note = saver.saveNow('account-change', 'row', () => 'Old account note');
    currentAccount = false;
    finishEarlierWrite();
    await earlier;
    expect(await note).toBe('skipped');
    expect(save).not.toHaveBeenCalled();
  });
});

describe('flexiblePlanNoteToWrite', () => {
  const plan: Pick<WorkoutDayPlan, 'workout_id' | 'items'> = {
    workout_id: 'workout-a',
    items: [
      { exercise_id: 'bench', order: 0, notes: 'Pause at the bottom' },
      { exercise_id: 'row', order: 1, notes: null },
    ],
  };
  const workout = { id: 'workout-a', split_day_id: null };

  it('clears a template note the user emptied', () => {
    expect(flexiblePlanNoteToWrite({ workoutId: 'workout-a', exerciseId: 'bench', movementNotes: { bench: '' }, workout, plan })).toBe('');
  });

  it('writes a trimmed new note', () => {
    expect(flexiblePlanNoteToWrite({ workoutId: 'workout-a', exerciseId: 'row', movementNotes: { row: ' Squeeze ' }, workout, plan })).toBe('Squeeze');
  });

  it('leaves a note the user never touched alone', () => {
    expect(flexiblePlanNoteToWrite({ workoutId: 'workout-a', exerciseId: 'bench', movementNotes: {}, workout, plan })).toBeNull();
  });

  it('skips a note that already matches the plan', () => {
    expect(flexiblePlanNoteToWrite({ workoutId: 'workout-a', exerciseId: 'bench', movementNotes: { bench: 'Pause at the bottom ' }, workout, plan })).toBeNull();
  });

  it('never writes for a split workout, another workout, or notes from another workout', () => {
    expect(flexiblePlanNoteToWrite({ workoutId: 'workout-a', exerciseId: 'row', movementNotes: { row: 'x' }, workout: { id: 'workout-a', split_day_id: 'day-1' }, plan })).toBeNull();
    expect(flexiblePlanNoteToWrite({ workoutId: 'workout-b', exerciseId: 'row', movementNotes: { row: 'x' }, workout, plan })).toBeNull();
    expect(flexiblePlanNoteToWrite({ workoutId: 'workout-a', exerciseId: 'row', movementNotes: null, workout, plan })).toBeNull();
    expect(flexiblePlanNoteToWrite({ workoutId: 'workout-a', exerciseId: 'row', movementNotes: { row: 'x' }, workout: null, plan })).toBeNull();
  });
});
