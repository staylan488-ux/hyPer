/**
 * The new-program chooser's choices: five guided questions with their
 * defaults, and the blank program's day count. Shared by the web chooser and
 * the native app; both only fill the editor's draft.
 */
import { getExerciseLibrary } from '@/lib/exerciseLibrary';
import {
  buildGuidedTemplate,
  recommendProgramTemplate,
  type EquipmentProfile,
  type ExperienceLevel,
  type ProgramDesignAnswers,
  type ProgramFocus,
  type SessionLength,
} from '@/lib/programDesigner';
import { templateSplitDraft } from '@/lib/splitDraftSeed';
import { splitTemplates } from '@/lib/splitTemplates';
import type { DraftSplit } from '@/lib/splitDraft';
import type { SplitTemplate } from '@/types';

export type ProgramQuestion<K extends keyof ProgramDesignAnswers, T extends string> = {
  key: K;
  label: string;
  options: Array<{ value: T; label: string }>;
};

export const DAYS_QUESTION: ProgramQuestion<'daysPerWeek', string> = {
  key: 'daysPerWeek', label: 'Days per week',
  options: ['3', '4', '5', '6'].map((value) => ({ value, label: value })),
};
export const FOCUS_QUESTION: ProgramQuestion<'focus', ProgramFocus> = {
  key: 'focus', label: 'Emphasis',
  options: [{ value: 'no_focus', label: 'Balanced' }, { value: 'upper_focus', label: 'Upper' }, { value: 'lower_focus', label: 'Lower' }],
};
export const EQUIPMENT_QUESTION: ProgramQuestion<'equipment', EquipmentProfile> = {
  key: 'equipment', label: 'Equipment',
  options: [{ value: 'full_gym', label: 'Full gym' }, { value: 'dumbbell_only', label: 'Dumbbells' }],
};
export const SESSION_QUESTION: ProgramQuestion<'sessionLength', SessionLength> = {
  key: 'sessionLength', label: 'Session length',
  options: [{ value: 'short', label: '45 min' }, { value: 'moderate', label: '60 min' }, { value: 'long', label: '75+ min' }],
};
export const EXPERIENCE_QUESTION: ProgramQuestion<'experience', ExperienceLevel> = {
  key: 'experience', label: 'Experience',
  options: [{ value: 'beginner', label: 'Beginner' }, { value: 'intermediate', label: 'Intermediate' }, { value: 'advanced', label: 'Advanced' }],
};

export const DEFAULT_PROGRAM_ANSWERS: ProgramDesignAnswers = {
  daysPerWeek: 4,
  focus: 'no_focus',
  equipment: 'full_gym',
  sessionLength: 'moderate',
  experience: 'intermediate',
};

/** A blank program has 1 to 7 days, 4 by default. */
export const BLANK_DAY_OPTIONS = ['1', '2', '3', '4', '5', '6', '7'].map((value) => ({ value, label: value }));
export const DEFAULT_BLANK_DAYS = 4;

/** The plan the guided answers recommend. */
export function guidedTemplate(answers: ProgramDesignAnswers): SplitTemplate {
  return buildGuidedTemplate(recommendProgramTemplate(splitTemplates, answers), answers);
}

export function templateExerciseCount(template: Pick<SplitTemplate, 'days'>): number {
  return template.days.reduce((sum, day) => sum + day.exercises.length, 0);
}

const LIBRARY_MAX_AGE_MS = 5 * 60_000;
export const LIBRARY_LOAD_FAILED = "Couldn't load the exercise library. Check your connection and try again.";

/**
 * The guided plan as a draft, matched to the exercise library. Names the
 * library lacks are left out and named in `notice`. Throws when the library
 * cannot load.
 */
export async function seedGuidedDraft(
  template: SplitTemplate,
  loadLibrary = () => getExerciseLibrary({ maxAgeMs: LIBRARY_MAX_AGE_MS }),
): Promise<{ draft: DraftSplit; notice: string | null }> {
  const library = await loadLibrary();
  const { draft, missing } = templateSplitDraft(template, library);
  return {
    draft,
    notice: missing.length > 0 ? `Not in your exercise library, so left out: ${missing.join(', ')}.` : null,
  };
}
