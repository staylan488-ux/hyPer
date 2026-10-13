/**
 * Starting points for a new program. Each only fills the editor's draft; the
 * program is created when the editor saves.
 */
import { normalizeExerciseName } from '@/lib/customExercises';
import { createTempId, newDraftDay, newDraftExercise, type DraftSplit } from '@/lib/splitDraft';
import type { Exercise, SplitTemplate } from '@/types';

export function blankSplitDraft(dayCount: number): DraftSplit {
  const count = Math.max(1, Math.min(7, Math.round(dayCount)));
  return {
    id: createTempId(),
    name: '',
    description: null,
    days_per_week: count,
    days: Array.from({ length: count }, (_, index) => newDraftDay(`Day ${index + 1}`, index)),
    _isNew: true,
  };
}

/**
 * A template's days with each exercise matched to the library by name. Names
 * the library lacks are left out (as program creation always did) and listed
 * in `missing` so the editor can say so.
 */
export function templateSplitDraft(template: SplitTemplate, library: readonly Exercise[]): { draft: DraftSplit; missing: string[] } {
  const exact = new Map<string, Exercise>();
  const loose = new Map<string, Exercise>();
  for (const exercise of library) {
    exact.set(exercise.name, exercise);
    const key = normalizeExerciseName(exercise.name);
    if (!loose.has(key)) loose.set(key, exercise);
  }

  const missing: string[] = [];
  const days = template.days.map((day, dayIndex) => {
    const exercises = day.exercises.flatMap((planned) => {
      const exercise = exact.get(planned.name) ?? loose.get(normalizeExerciseName(planned.name));
      if (!exercise) {
        missing.push(planned.name);
        return [];
      }
      return [{ planned, exercise }];
    });
    return newDraftDay(day.day_name, dayIndex, exercises.map(({ planned, exercise }, order) => newDraftExercise(exercise, order, {
      target_sets: planned.sets,
      target_sets_min: planned.sets,
      target_sets_max: planned.sets,
      target_reps_min: planned.reps_min,
      target_reps_max: planned.reps_max,
    })));
  });

  return {
    draft: {
      id: createTempId(),
      name: template.name,
      description: template.description,
      days_per_week: days.length,
      days,
      _isNew: true,
    },
    missing: Array.from(new Set(missing)),
  };
}
