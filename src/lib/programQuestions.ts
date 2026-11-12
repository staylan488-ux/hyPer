/**
 * The new-program chooser's choices: five guided questions with their
 * defaults, and the blank program's day count. The chooser only fills the
 * editor's draft.
 */
import { getExerciseLibrary, peekExerciseLibrary } from '@/lib/exerciseLibrary';
import {
  buildGuidedTemplate,
  designerMovementMuscles,
  recommendProgramTemplate,
  type EquipmentProfile,
  type ExperienceLevel,
  type ProgramDesignAnswers,
  type ProgramFocus,
  type SessionLength,
} from '@/lib/programDesigner';
import { SESSION_SET_CAPS, STAND_IN_PREFIX, fillByMuscle, fitToLibrary, keepCurrentMovements, thinLine, thinMuscles } from '@/lib/programFill';
import { templateSplitDraft } from '@/lib/splitDraftSeed';
import { splitTemplates } from '@/lib/splitTemplates';
import type { DraftSplit } from '@/lib/splitDraft';
import type { Exercise, SplitTemplate } from '@/types';

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

export interface GuidedDraft {
  draft: DraftSplit;
  /** Template movements the library lacks, left out. */
  notice: string | null;
}

/**
 * The guided plan as a draft: the template matched to the exercise library,
 * the current program's movements kept in its slots, then filled by muscle
 * inside the session length (src/lib/programFill.ts). Main muscles that still
 * sit low are named in the description. Names the library lacks are left out
 * and named in `notice`.
 */
export function guidedDraft(
  answers: ProgramDesignAnswers,
  library: readonly Exercise[],
  current?: DraftSplit | null,
  template: SplitTemplate = guidedTemplate(answers),
): GuidedDraft {
  const equipment = answers.equipment === 'full_gym' ? 'full_gym' : 'dumbbell_only';
  // A name the library lacks holds its slot as a stand-in, so the person's own
  // movement or a library one for the same muscle can take it.
  const { draft: seeded, missing } = templateSplitDraft(template, library, (name) => {
    const muscles = designerMovementMuscles(name);
    return muscles ? { id: `${STAND_IN_PREFIX}${name}`, name, equipment: null, ...muscles } : null;
  });
  const maxDaySets = SESSION_SET_CAPS[answers.sessionLength];
  const kept = current?.days.length ? keepCurrentMovements(seeded, current, { equipment, maxDaySets }) : seeded;
  const dropped: string[] = [];
  const fitted = fitToLibrary(kept, library, equipment, dropped);
  const left = [...new Set([...missing, ...dropped])];
  const filled = fillByMuscle(fitted, library, { ...answers, equipment });
  const thin = thinLine(thinMuscles(filled), filled.days.length, answers.sessionLength);
  return {
    draft: { ...filled, description: [filled.description, thin].filter(Boolean).join(' ') || null },
    notice: left.length > 0 ? `Not in your exercise library, so left out: ${left.join(', ')}.` : null,
  };
}

export function loadBuilderLibrary(): Promise<Exercise[]> {
  return getExerciseLibrary({ maxAgeMs: LIBRARY_MAX_AGE_MS });
}

/** The library already in memory, or null; the chooser shows the plan from it before anything loads. */
export function peekBuilderLibrary(): Exercise[] | null {
  return peekExerciseLibrary();
}

/** `guidedDraft` once the library has loaded. Throws when the library cannot load. */
export async function seedGuidedDraft(
  answers: ProgramDesignAnswers,
  { current = null, loadLibrary = loadBuilderLibrary }: { current?: DraftSplit | null; loadLibrary?: () => Promise<Exercise[]> } = {},
): Promise<GuidedDraft> {
  return guidedDraft(answers, await loadLibrary(), current);
}
