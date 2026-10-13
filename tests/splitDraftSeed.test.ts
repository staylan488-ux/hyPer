import { describe, expect, it } from 'vitest';
import { blankSplitDraft, templateSplitDraft } from '@/lib/splitDraftSeed';
import { splitTemplates } from '@/lib/splitTemplates';
import { buildGuidedTemplate, recommendProgramTemplate } from '@/lib/programDesigner';
import type { Exercise, SplitTemplate } from '@/types';

const exercise = (id: string, name: string): Exercise => ({
  id, name, muscle_group: 'chest', muscle_group_secondary: null, equipment: null, is_compound: false,
});

describe('seeding the editor', () => {
  it('starts blank with named, empty, unsaved days', () => {
    const draft = blankSplitDraft(4);
    expect(draft._isNew).toBe(true);
    expect(draft.name).toBe('');
    expect(draft.days.map((day) => [day.day_name, day.day_order, day.exercises.length, day._isNew])).toEqual([
      ['Day 1', 0, 0, true], ['Day 2', 1, 0, true], ['Day 3', 2, 0, true], ['Day 4', 3, 0, true],
    ]);
    expect(new Set(draft.days.map((day) => day.id)).size).toBe(4);
  });

  it('fills a template from the library, matching names loosely and listing what is missing', () => {
    const template: SplitTemplate = {
      name: 'Upper Lower', description: 'Two days', days_per_week: 2,
      days: [
        { day_name: 'Upper', muscle_groups: ['chest'], exercises: [
          { name: 'Bench Press', sets: 4, reps_min: 6, reps_max: 8 },
          { name: 'Cable Fly (High-to-Low)', sets: 2, reps_min: 12, reps_max: 15 },
          { name: 'Not In Library', sets: 3, reps_min: 8, reps_max: 12 },
        ] },
        { day_name: 'Lower', muscle_groups: ['quads'], exercises: [{ name: 'Not In Library', sets: 3, reps_min: 8, reps_max: 12 }] },
      ],
    };
    const { draft, missing } = templateSplitDraft(template, [
      exercise('bench', 'Bench Press'), exercise('fly', 'cable fly high to low'),
    ]);
    expect(draft).toMatchObject({ name: 'Upper Lower', description: 'Two days', days_per_week: 2, _isNew: true });
    expect(draft.days[0].exercises.map((ex) => [ex.exercise_id, ex.exercise_order, ex.target_sets_min, ex.target_sets, ex.target_sets_max, ex.target_reps_min, ex.target_reps_max, ex._isNew])).toEqual([
      ['bench', 0, 4, 4, 4, 6, 8, true],
      ['fly', 1, 2, 2, 2, 12, 15, true],
    ]);
    expect(draft.days[1].exercises).toEqual([]);
    expect(missing).toEqual(['Not In Library']);
  });

  it('seeds a guided recommendation the same way', () => {
    const answers = { daysPerWeek: 4, focus: 'no_focus', equipment: 'full_gym', sessionLength: 'moderate', experience: 'intermediate' } as const;
    const guided = buildGuidedTemplate(recommendProgramTemplate(splitTemplates, answers), answers);
    const names = guided.days.flatMap((day) => day.exercises.map((ex) => ex.name));
    const library = names.map((name, index) => exercise(`ex-${index}`, name));
    const { draft, missing } = templateSplitDraft(guided, library);
    expect(missing).toEqual([]);
    expect(draft.days).toHaveLength(guided.days.length);
    expect(draft.days.flatMap((day) => day.exercises)).toHaveLength(names.length);
  });
});
