import type { SplitTemplate } from '@/types';

export type ProgramFocus = 'no_focus' | 'upper_focus' | 'lower_focus';
export type EquipmentProfile = 'full_gym' | 'limited_gym' | 'minimal';
export type SessionLength = 'short' | 'moderate' | 'long';
export type ExperienceLevel = 'beginner' | 'intermediate' | 'advanced';

export interface ProgramDesignAnswers {
  daysPerWeek: number;
  focus: ProgramFocus;
  equipment: EquipmentProfile;
  sessionLength: SessionLength;
  experience: ExperienceLevel;
}

function isUpperSpecialization(template: SplitTemplate): boolean {
  return /upper\s*focus|specialization\s*upper|upper\s*priority/i.test(
    `${template.name} ${template.description}`
  );
}

function isLowerSpecialization(template: SplitTemplate): boolean {
  return /lower\s*focus|specialization\s*lower|lower\s*priority|quad\s*focus|quad\s*priority/i.test(
    `${template.name} ${template.description}`
  );
}

function isEvidenceTemplate(template: SplitTemplate): boolean {
  return Boolean(template.evidence);
}

function isUpperDay(dayName: string): boolean {
  return /upper|push|pull|chest|back|shoulder/i.test(dayName);
}

function isLowerDay(dayName: string): boolean {
  return /lower|leg|quad|ham|glute/i.test(dayName);
}

function isHighSkillExercise(exerciseName: string): boolean {
  return /barbell|squat|deadlift|overhead press|pull-up/i.test(exerciseName);
}

function clampSets(sets: number): number {
  return Math.max(1, Math.min(6, sets));
}

export function recommendProgramTemplate(
  templates: SplitTemplate[],
  answers: ProgramDesignAnswers
): SplitTemplate {
  const ranked = [...templates]
    .map((template, index) => {
      let score = 0;

      const dayDistance = Math.abs(template.days_per_week - answers.daysPerWeek);
      score += Math.max(0, 40 - dayDistance * 10);

      if (template.days_per_week === answers.daysPerWeek) {
        score += 20;
      }

      if (isEvidenceTemplate(template)) {
        score += 15;
      }

      if (answers.focus === 'upper_focus') {
        if (isUpperSpecialization(template)) score += 35;
        if (isLowerSpecialization(template)) score -= 20;
        if (/upper|push|chest|back/i.test(template.name)) score += 8;
      } else if (answers.focus === 'lower_focus') {
        if (isLowerSpecialization(template)) score += 35;
        if (isUpperSpecialization(template)) score -= 20;
        if (/lower|legs|full body/i.test(template.name)) score += 8;
      } else {
        if (isUpperSpecialization(template) || isLowerSpecialization(template)) score -= 25;
      }

      if (answers.experience === 'beginner' && template.days_per_week > 5) {
        score -= 8;
      }

      if (answers.sessionLength === 'short' && template.days_per_week > 4) {
        score -= 6;
      }

      return { template, score, index };
    })
    .sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      return a.index - b.index;
    });

  return ranked[0]?.template || templates[0];
}

export function buildGuidedTemplate(
  baseTemplate: SplitTemplate,
  answers: ProgramDesignAnswers
): SplitTemplate {
  const adjustedDays = baseTemplate.days.map((day) => ({
    ...day,
    exercises: day.exercises.map((exercise, exerciseIndex) => {
      let sets = exercise.sets;

      if (answers.experience === 'beginner' && sets > 2) {
        sets -= 1;
      }

      if (answers.sessionLength === 'short' && exercise.reps_min >= 10 && sets > 1) {
        sets -= 1;
      }

      if (
        answers.sessionLength === 'long' &&
        answers.experience === 'advanced' &&
        exerciseIndex === 0 &&
        exercise.reps_min <= 10
      ) {
        sets += 1;
      }

      if (answers.focus === 'upper_focus') {
        if (isUpperDay(day.day_name) && exerciseIndex < 2) {
          sets += 1;
        }
        if (isLowerDay(day.day_name) && exerciseIndex >= 2 && sets > 1) {
          sets -= 1;
        }
      }

      if (answers.focus === 'lower_focus') {
        if (isLowerDay(day.day_name) && exerciseIndex < 2) {
          sets += 1;
        }
        if (isUpperDay(day.day_name) && exerciseIndex >= 2 && sets > 1) {
          sets -= 1;
        }
      }

      if (answers.equipment === 'minimal' && isHighSkillExercise(exercise.name) && sets > 2) {
        sets -= 1;
      }

      return {
        ...exercise,
        sets: clampSets(sets),
      };
    }),
  }));

  const focusLabel =
    answers.focus === 'upper_focus'
      ? 'Upper Focus'
      : answers.focus === 'lower_focus'
        ? 'Lower Focus'
        : 'No Specific Focus';

  const sessionLabel =
    answers.sessionLength === 'short'
      ? 'short sessions'
      : answers.sessionLength === 'long'
        ? 'long sessions'
        : 'moderate sessions';

  const experienceLabel =
    answers.experience === 'beginner'
      ? 'beginner-friendly volume'
      : answers.experience === 'advanced'
        ? 'advanced progression headroom'
        : 'intermediate progression';

  return {
    ...baseTemplate,
    name: `${baseTemplate.name} · Guided`,
    description: `${focusLabel} setup for ${answers.daysPerWeek} days/week with ${sessionLabel} and ${experienceLabel}.`,
    days: adjustedDays,
  };
}
