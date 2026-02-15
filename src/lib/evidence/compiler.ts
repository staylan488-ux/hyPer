import type { MuscleGroup, SplitTemplate } from '@/types';

import type {
  CompiledEvidenceSet,
  EvidenceSnapshot,
  ExerciseProfile,
  TemplateBlueprint,
  TemplateDayDraft,
  TemplateExerciseDraft,
} from './types';

type ProfileMap = Map<string, ExerciseProfile>;

type DayExerciseWithIndex = {
  exercise: TemplateExerciseDraft;
  index: number;
};

const SKILL_SCORE: Record<ExerciseProfile['skill_demand'], number> = {
  high: 3,
  medium: 2,
  low: 1,
};

const FATIGUE_SCORE: Record<ExerciseProfile['fatigue_cost'], number> = {
  high: 3,
  medium: 2,
  low: 1,
};

const STABILITY_SCORE: Record<ExerciseProfile['stability'], number> = {
  low: 3,
  medium: 2,
  high: 1,
};

function getIntensityBucket(exercise: TemplateExerciseDraft): number {
  if (exercise.reps_min <= 6) return 3;
  if (exercise.reps_min <= 10) return 2;
  return 1;
}

function createProfileMap(snapshot: EvidenceSnapshot): ProfileMap {
  return new Map(snapshot.exercise_profiles.map((profile) => [normalizeExerciseName(profile.name), profile]));
}

function normalizeExerciseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getProfile(profileMap: ProfileMap, exerciseName: string): ExerciseProfile | undefined {
  const normalized = normalizeExerciseName(exerciseName);
  const direct = profileMap.get(normalized);
  if (direct) return direct;

  let bestMatch: { profile: ExerciseProfile; length: number } | null = null;
  for (const [profileName, profile] of profileMap.entries()) {
    if (normalized.includes(profileName) || profileName.includes(normalized)) {
      if (!bestMatch || profileName.length > bestMatch.length) {
        bestMatch = { profile, length: profileName.length };
      }
    }
  }

  return bestMatch?.profile;
}

function getMusclePriority(
  dayMuscles: MuscleGroup[],
  focusMuscles: MuscleGroup[] | undefined,
  profile: ExerciseProfile
): number {
  const focusSet = new Set(focusMuscles || []);
  const secondaryIndex = profile.secondary_muscle ? dayMuscles.indexOf(profile.secondary_muscle) : -1;
  const primaryIndex = dayMuscles.indexOf(profile.primary_muscle);

  let score = 0;

  if (primaryIndex !== -1) {
    score += Math.max(0, 4 - primaryIndex);
  }

  if (secondaryIndex !== -1) {
    score += Math.max(0, 2 - secondaryIndex);
  }

  if (focusSet.has(profile.primary_muscle)) {
    score += 2;
  }

  if (profile.secondary_muscle && focusSet.has(profile.secondary_muscle)) {
    score += 1;
  }

  return score;
}

function scoreExercise(
  exercise: TemplateExerciseDraft,
  dayMuscles: MuscleGroup[],
  focusMuscles: MuscleGroup[] | undefined,
  profile: ExerciseProfile
): number {
  const musclePriority = getMusclePriority(dayMuscles, focusMuscles, profile);
  const skillScore = SKILL_SCORE[profile.skill_demand];
  const fatigueScore = FATIGUE_SCORE[profile.fatigue_cost];
  const stabilityScore = STABILITY_SCORE[profile.stability];
  const intensityScore = getIntensityBucket(exercise);

  return musclePriority * 4 + skillScore * 3 + fatigueScore * 2 + stabilityScore * 1 + intensityScore * 0.5;
}

function optimizeDayExerciseOrder(
  day: TemplateDayDraft,
  blueprint: TemplateBlueprint,
  profileMap: ProfileMap
): TemplateExerciseDraft[] {
  const withIndex: DayExerciseWithIndex[] = day.exercises.map((exercise, index) => ({ exercise, index }));
  const knownProfiles = withIndex.filter(({ exercise }) => Boolean(getProfile(profileMap, exercise.name)));
  const knownCoverage = withIndex.length > 0 ? knownProfiles.length / withIndex.length : 0;

  if (knownCoverage < 0.6) {
    return day.exercises;
  }

  return [...withIndex]
    .sort((a, b) => {
      const profileA = getProfile(profileMap, a.exercise.name);
      const profileB = getProfile(profileMap, b.exercise.name);

      const scoreA = profileA
        ? scoreExercise(a.exercise, day.muscle_groups, blueprint.focus_muscles, profileA)
        : -1;
      const scoreB = profileB
        ? scoreExercise(b.exercise, day.muscle_groups, blueprint.focus_muscles, profileB)
        : -1;

      if (scoreA !== scoreB) return scoreB - scoreA;
      return a.index - b.index;
    })
    .map(({ exercise }) => exercise);
}

function toSplitTemplate(snapshot: EvidenceSnapshot): SplitTemplate[] {
  const profileMap = createProfileMap(snapshot);

  return snapshot.template_blueprints.map((blueprint) => ({
    name: blueprint.name,
    description: blueprint.description,
    days_per_week: blueprint.days_per_week,
    evidence: {
      label: 'Evidence-informed',
      confidence: blueprint.confidence,
      public_note: blueprint.public_note,
    },
    days: blueprint.days.map((day) => ({
      day_name: day.day_name,
      muscle_groups: day.muscle_groups,
      exercises: optimizeDayExerciseOrder(day, blueprint, profileMap).map((exercise) => ({
        name: exercise.name,
        sets: exercise.sets,
        reps_min: exercise.reps_min,
        reps_max: exercise.reps_max,
      })),
    })),
  }));
}

export function compileEvidenceTemplates(snapshot: EvidenceSnapshot): CompiledEvidenceSet {
  const rulesById = Object.fromEntries(snapshot.rules.map((rule) => [rule.id, rule]));
  return {
    templates: toSplitTemplate(snapshot),
    rulesById,
  };
}
