import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The plan-start prompt reads plan_schedules when this device has no copy.
const planRow = vi.hoisted(() => ({ value: null as Record<string, unknown> | null, fail: false }));
vi.mock('@/lib/supabase', () => {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => (planRow.fail ? { data: null, error: { message: 'offline' } } : { data: planRow.value, error: null }),
  };
  return { supabase: { from: () => chain } };
});

// Program's Save and Cancel commit a focused field first; there is none here.
vi.mock('@/lib/commitFocusedField', () => ({ commitFocusedField: () => {} }));

import { discardSplitEdit } from '@/lib/discardSplitEdit';
import { dismissPlanStartPrompt, shouldPromptPlanStart } from '@/lib/planSchedule';
import {
  exerciseTotal,
  renameTemplateWithConfirm,
  setRepLabel,
  shownActiveProgram,
  templateItemLabel,
  visibleTemplateItems,
} from '@/lib/programSummary';
import { DEFAULT_PROGRAM_ANSWERS, guidedTemplate, seedGuidedDraft, templateExerciseCount } from '@/lib/programQuestions';
import { blockStartIndexes, dayLabel, daySummary, exerciseBlocks, newDraftDay, newDraftExercise, pickerTargetFor, type DraftSplit } from '@/lib/splitDraft';
import { blankSplitDraft } from '@/lib/splitDraftSeed';
import { useSplitEditStore } from '@/stores/splitEditStore';
import type { Exercise, Split } from '@/types';
import { memoryStorage } from './memoryStorage';

const exercise = (id: string, name: string, muscle: Exercise['muscle_group'] = 'chest'): Exercise => ({
  id, name, muscle_group: muscle, muscle_group_secondary: null, equipment: null, is_compound: false,
});

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
  planRow.value = null;
  planRow.fail = false;
});
afterEach(() => {
  vi.unstubAllGlobals();
  useSplitEditStore.getState().cancelEdit();
});

describe('program summary', () => {
  const split = (id: string, active: boolean, counts: number[]) => ({
    id,
    is_active: active,
    days: counts.map((count) => ({ exercises: Array.from({ length: count }) })),
  }) as unknown as Split;

  it('counts exercises across days and shows no active program in flexible mode', () => {
    const splits = [split('a', false, [2, 3]), split('b', true, [1])];
    expect(exerciseTotal(splits[0])).toBe(5);
    expect(shownActiveProgram(splits, 'split')?.id).toBe('b');
    expect(shownActiveProgram(splits, 'flexible')).toBeNull();
    expect(shownActiveProgram([split('a', false, [])], 'split')).toBeNull();
  });

  it('labels sets and reps with the stored set range', () => {
    expect(setRepLabel({ notes: null, target_sets: 3, target_reps_min: 8, target_reps_max: 12 })).toBe('3×8–12');
    expect(setRepLabel({ notes: 'Pause\n[set-range]{"min":2,"max":4}', target_sets: 3, target_reps_min: 6, target_reps_max: 8 })).toBe('2–4×6–8');
  });

  it('shows a quick start without hidden movements, with a dash for missing numbers', () => {
    const items = [
      { exercise_id: 'x', order: 0, target_sets: 3, target_reps_min: 8, target_reps_max: 10 },
      { exercise_id: 'y', order: 1, hidden: true },
      { exercise_id: 'z', order: 2, target_sets: null },
    ];
    expect(visibleTemplateItems({ items }).map((item) => item.exercise_id)).toEqual(['x', 'z']);
    expect(templateItemLabel(items[0])).toBe('3×8–10');
    expect(templateItemLabel(items[2])).toBe('—×—');
  });
});

describe('renaming a quick start', () => {
  it('asks before overwriting a clashing name and stops when declined', async () => {
    const rename = vi.fn(async (_id: string, _label: string, overwrite?: boolean) =>
      overwrite ? { ok: true } : { ok: false, conflictLabel: 'Push' });
    const confirmOverwrite = vi.fn(() => false);
    await expect(renameTemplateWithConfirm({ rename, confirmOverwrite, templateId: 't1', label: ' push ' })).resolves.toBeNull();
    expect(confirmOverwrite).toHaveBeenCalledWith('Push');
    expect(rename).toHaveBeenCalledTimes(1);
    expect(rename).toHaveBeenCalledWith('t1', 'push', false);
  });

  it('overwrites after a yes and reports a failed overwrite', async () => {
    const rename = vi.fn(async (_id: string, _label: string, overwrite?: boolean) =>
      overwrite ? { ok: false, reason: 'Could not overwrite existing template.' } : { ok: false, conflictLabel: 'Push' });
    await expect(renameTemplateWithConfirm({ rename, confirmOverwrite: async () => true, templateId: 't1', label: 'Push' }))
      .resolves.toBe('Could not overwrite existing template.');
    expect(rename).toHaveBeenLastCalledWith('t1', 'Push', true);
  });

  it('needs a name and passes other failures through', async () => {
    const rename = vi.fn(async () => ({ ok: false }));
    await expect(renameTemplateWithConfirm({ rename, confirmOverwrite: () => true, templateId: 't1', label: '  ' }))
      .resolves.toBe('Template label is required.');
    expect(rename).not.toHaveBeenCalled();
    await expect(renameTemplateWithConfirm({ rename, confirmOverwrite: () => true, templateId: 't1', label: 'Legs' }))
      .resolves.toBe('Could not rename template.');
  });
});

describe('plan-start prompt', () => {
  it('prompts only without a schedule and until Later is chosen for that program', async () => {
    await expect(shouldPromptPlanStart('u1', 's1')).resolves.toBe(true);
    dismissPlanStartPrompt('u1', 's1');
    await expect(shouldPromptPlanStart('u1', 's1')).resolves.toBe(false);
    await expect(shouldPromptPlanStart('u1', 's2')).resolves.toBe(true);
    await expect(shouldPromptPlanStart('u2', 's1')).resolves.toBe(true);
  });

  it('does not prompt when the cloud has a schedule, and counts a failed read as none', async () => {
    planRow.value = { split_id: 's1', start_date: '2026-10-01', mode: 'fixed', weekdays: [1, 3, 5], anchor_day: 1, updated_at: '2026-10-01T00:00:00Z' };
    await expect(shouldPromptPlanStart('u1', 's1')).resolves.toBe(false);
    planRow.value = null;
    planRow.fail = true;
    await expect(shouldPromptPlanStart('u1', 's3')).resolves.toBe(true);
  });
});

describe('editor labels and the picker', () => {
  const draft = (): DraftSplit => {
    const bench = newDraftExercise(exercise('bench', 'Bench Press'), 0, { superset_group_id: 'g1' });
    const row = newDraftExercise(exercise('row', 'Cable Row', 'back'), 1, { superset_group_id: 'g1' });
    const custom = newDraftExercise(exercise('pending-exercise-band-pull', 'Band Pull', 'shoulders'), 2);
    return {
      id: 'split-1',
      name: 'Upper',
      description: null,
      days_per_week: 2,
      days: [newDraftDay('Upper', 0, [bench, row, custom]), newDraftDay('  ', 1)],
    };
  };

  it('names a blank day by its place and summarises its exercises', () => {
    const d = draft();
    expect(dayLabel(d.days[0], 0)).toBe('Upper');
    expect(dayLabel(d.days[1], 1)).toBe('Day 2');
    expect(daySummary(d.days[0])).toBe('Bench Press · Cable Row · Band Pull');
    expect(daySummary(d.days[1])).toBe('No exercises yet');
    expect(blockStartIndexes(exerciseBlocks(d.days[0].exercises))).toEqual([0, 2]);
  });

  it('opens add on every muscle, swap on the source muscle, and leaves out the day', () => {
    const d = draft();
    const [day] = d.days;
    const add = pickerTargetFor(d, day.id, 'add');
    expect(add.initialMuscleGroup).toBeUndefined();
    expect(add.excludeExerciseIds).toEqual(['bench', 'row', 'pending-exercise-band-pull']);
    expect(add.extraExercises.map((entry) => entry.name)).toEqual(['Band Pull']);
    const swap = pickerTargetFor(d, day.id, 'swap', day.exercises[1].id);
    expect(swap.initialMuscleGroup).toBe('back');
    expect(pickerTargetFor(d, d.days[1].id, 'add').excludeExerciseIds).toEqual([]);
  });
});

describe('new program chooser', () => {
  it('seeds the guided plan from the library and names what it left out', async () => {
    const template = guidedTemplate(DEFAULT_PROGRAM_ANSWERS);
    expect(template.days).toHaveLength(4);
    const names = template.days.flatMap((day) => day.exercises.map((entry) => entry.name));
    const library = names.slice(1).map((name, index) => exercise(`e${index}`, name));
    const { draft, notice } = await seedGuidedDraft(template, async () => library);
    expect(draft._isNew).toBe(true);
    expect(draft.days.flatMap((day) => day.exercises)).toHaveLength(templateExerciseCount(template) - names.filter((name) => name === names[0]).length);
    expect(notice).toBe(`Not in your exercise library, so left out: ${names[0]}.`);
    await expect(seedGuidedDraft(template, async () => names.map((name, index) => exercise(`e${index}`, name)))).resolves.toMatchObject({ notice: null });
  });

  it('passes a library failure to the caller', async () => {
    await expect(seedGuidedDraft(guidedTemplate(DEFAULT_PROGRAM_ANSWERS), async () => { throw new Error('offline'); })).rejects.toThrow('offline');
  });
});

describe('discarding an edit', () => {
  it('asks through the given confirm and keeps the edit on no', async () => {
    useSplitEditStore.getState().startNew(blankSplitDraft(2), { userId: 'u1' });
    const confirm = vi.fn(async () => false);
    await expect(discardSplitEdit(confirm)).resolves.toBe(false);
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Discard new program?', confirmLabel: 'Discard' }));
    expect(useSplitEditStore.getState().draft).not.toBeNull();
    await expect(discardSplitEdit(async () => true)).resolves.toBe(true);
    expect(useSplitEditStore.getState().draft).toBeNull();
  });

  it('closes an untouched edit without asking', async () => {
    useSplitEditStore.getState().startEdit({ id: 's1', user_id: 'u1', name: 'A', description: null, days_per_week: 1, is_active: true, days: [] });
    const confirm = vi.fn(async () => false);
    await expect(discardSplitEdit(confirm)).resolves.toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });
});
