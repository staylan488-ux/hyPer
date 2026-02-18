import type { SplitTemplate } from '@/types';
import { beardsleyEvidenceSnapshot } from '@/lib/evidence/snapshot';
import type { ExerciseProfile } from '@/lib/evidence/types';

export type ProgramFocus = 'no_focus' | 'upper_focus' | 'lower_focus';
export type EquipmentProfile = 'full_gym' | 'dumbbell_only';
export type SessionLength = 'short' | 'moderate' | 'long';
export type ExperienceLevel = 'beginner' | 'intermediate' | 'advanced';
type LegacyEquipmentProfile = 'limited_gym' | 'minimal';

export interface ProgramDesignAnswers {
  daysPerWeek: number;
  focus: ProgramFocus;
  equipment: EquipmentProfile | LegacyEquipmentProfile;
  sessionLength: SessionLength;
  experience: ExperienceLevel;
}

const exerciseProfileByName = new Map(
  beardsleyEvidenceSnapshot.exercise_profiles.map((profile) => [normalizeExerciseName(profile.name), profile])
);

type EquipmentTier = 'barbell' | 'cable' | 'machine' | 'dumbbells' | 'bodyweight' | 'unknown';

const AMBIGUOUS_EQUIPMENT_HINTS: Record<string, EquipmentTier> = {
  'romanian deadlift': 'barbell',
  'hip thrust': 'barbell',
  'leg press': 'machine',
  'leg extension': 'machine',
  'leg curl': 'machine',
  'lying leg curl': 'machine',
  'seated leg curl': 'machine',
  'calf raise': 'machine',
  'lateral raise': 'dumbbells',
  'rear delt fly': 'dumbbells',
  'overhead tricep extension': 'dumbbells',
  'dumbbell curl': 'dumbbells',
  'hammer curl': 'dumbbells',
  'incline dumbbell curl': 'dumbbells',
  'goblet squat': 'dumbbells',
  lunge: 'dumbbells',
  'bulgarian split squat': 'dumbbells',
};

const EQUIPMENT_FALLBACKS: Record<EquipmentProfile, Record<string, string[]>> = {
  full_gym: {},
  dumbbell_only: {
    'barbell back squat': ['Goblet Squat', 'Bulgarian Split Squat', 'Lunge'],
    'romanian deadlift': ['Bulgarian Split Squat', 'Lunge', 'Goblet Squat'],
    'barbell deadlift': ['Goblet Squat', 'Bulgarian Split Squat', 'Lunge'],
    'flat barbell bench press': ['Push-Up', 'Dips', 'Flat Dumbbell Bench Press'],
    'incline barbell bench press': ['Push-Up', 'Incline Dumbbell Bench Press', 'Dips'],
    'flat dumbbell bench press': ['Push-Up', 'Dips'],
    'incline dumbbell bench press': ['Push-Up', 'Dips'],
    'overhead barbell press': ['Overhead Dumbbell Press', 'Arnold Press', 'Push-Up'],
    'overhead dumbbell press': ['Arnold Press', 'Push-Up'],
    'lat pulldown': ['Pull-Up', 'Chin-Up', 'One-Arm Dumbbell Row'],
    'seated cable row': ['One-Arm Dumbbell Row', 'Pull-Up', 'Chin-Up'],
    'barbell row': ['One-Arm Dumbbell Row', 'Pull-Up'],
    'cable fly': ['Push-Up', 'Flat Dumbbell Bench Press'],
    'pec deck machine fly': ['Push-Up', 'Flat Dumbbell Bench Press'],
    'tricep pushdown': ['Dips', 'Overhead Tricep Extension'],
    'cable curl': ['Dumbbell Curl', 'Hammer Curl', 'Incline Dumbbell Curl'],
    'leg press': ['Goblet Squat', 'Bulgarian Split Squat', 'Lunge'],
    'leg extension': ['Goblet Squat', 'Lunge', 'Bulgarian Split Squat'],
    'lying leg curl': ['Lunge', 'Bulgarian Split Squat', 'Goblet Squat'],
    'seated leg curl': ['Lunge', 'Bulgarian Split Squat', 'Goblet Squat'],
    'leg curl': ['Lunge', 'Bulgarian Split Squat', 'Goblet Squat'],
    'hip thrust': ['Lunge', 'Bulgarian Split Squat', 'Goblet Squat'],
    'calf raise': ['Standing Calf Raise'],
    'cable crunch': ['Plank', 'Hanging Leg Raise', 'Russian Twist'],
  },
};

function normalizeEquipmentProfile(equipment: EquipmentProfile | LegacyEquipmentProfile): EquipmentProfile {
  if (equipment === 'full_gym') return 'full_gym';
  return 'dumbbell_only';
}

function normalizeExerciseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function inferEquipmentTier(exerciseName: string): EquipmentTier {
  const normalized = normalizeExerciseName(exerciseName);

  if (normalized.includes('barbell')) return 'barbell';
  if (normalized.includes('cable') || normalized.includes('pulldown') || normalized.includes('pushdown')) return 'cable';
  if (normalized.includes('machine') || normalized.includes('pec deck')) return 'machine';
  if (normalized.includes('dumbbell') || normalized.includes('arnold') || normalized.includes('goblet')) return 'dumbbells';
  if (/(push up|pull up|chin up|bodyweight|dip|plank|hanging|ab wheel|russian twist)/.test(normalized)) return 'bodyweight';

  return AMBIGUOUS_EQUIPMENT_HINTS[normalized] || 'unknown';
}

function isExerciseCompatible(exerciseName: string, equipment: EquipmentProfile): boolean {
  if (equipment === 'full_gym') return true;

  const tier = inferEquipmentTier(exerciseName);
  if (tier === 'unknown') return false;

  return tier === 'dumbbells' || tier === 'bodyweight';
}

function getExerciseProfile(exerciseName: string): ExerciseProfile | undefined {
  const normalized = normalizeExerciseName(exerciseName);
  return exerciseProfileByName.get(normalized);
}

function resolveExerciseForEquipment(
  exerciseName: string,
  equipment: EquipmentProfile,
  usedInDay: Set<string>,
  visited = new Set<string>()
): string {
  if (isExerciseCompatible(exerciseName, equipment) && !usedInDay.has(normalizeExerciseName(exerciseName))) {
    return exerciseName;
  }

  const normalized = normalizeExerciseName(exerciseName);
  if (visited.has(normalized)) {
    return exerciseName;
  }
  visited.add(normalized);

  const profileFallbacks = getExerciseProfile(exerciseName)?.substitutions || [];
  const ruleFallbacks = EQUIPMENT_FALLBACKS[equipment][normalized] || [];
  const fallbackCandidates = [...profileFallbacks, ...ruleFallbacks];

  for (const candidate of fallbackCandidates) {
    if (!candidate) continue;

    if (isExerciseCompatible(candidate, equipment) && !usedInDay.has(normalizeExerciseName(candidate))) {
      return candidate;
    }

    const nested = resolveExerciseForEquipment(candidate, equipment, usedInDay, visited);
    if (isExerciseCompatible(nested, equipment) && !usedInDay.has(normalizeExerciseName(nested))) {
      return nested;
    }
  }

  for (const candidate of fallbackCandidates) {
    if (!candidate) continue;
    if (!usedInDay.has(normalizeExerciseName(candidate))) {
      return candidate;
    }
  }

  return exerciseName;
}

function scoreTemplateEquipmentFit(template: SplitTemplate, equipment: EquipmentProfile): number {
  if (equipment === 'full_gym') return 24;

  const allExercises = template.days.flatMap((day) => day.exercises.map((exercise) => exercise.name));
  if (allExercises.length === 0) return 0;

  let compatible = 0;
  let recoverable = 0;

  for (const exerciseName of allExercises) {
    if (isExerciseCompatible(exerciseName, equipment)) {
      compatible += 1;
      continue;
    }

    const replacement = resolveExerciseForEquipment(exerciseName, equipment, new Set<string>());
    if (replacement !== exerciseName && isExerciseCompatible(replacement, equipment)) {
      recoverable += 1;
    }
  }

  const compatibilityRatio = compatible / allExercises.length;
  const recoverableRatio = recoverable / allExercises.length;
  return Math.round((compatibilityRatio * 20) + (recoverableRatio * 10));
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

function isCoreExercise(exerciseName: string, exerciseIndex: number): boolean {
  if (exerciseIndex < 2) return true;
  return /squat|deadlift|bench|row|press|pull.up|chin.up|hip thrust/i.test(exerciseName);
}

type TemplateExercise = { name: string; sets: number; reps_min: number; reps_max: number };

const SESSION_ACCESSORY_POOL: Record<string, TemplateExercise[]> = {
  upper: [
    { name: 'Lateral Raise', sets: 2, reps_min: 12, reps_max: 15 },
    { name: 'Rear Delt Fly', sets: 2, reps_min: 12, reps_max: 15 },
    { name: 'Tricep Pushdown', sets: 2, reps_min: 10, reps_max: 12 },
    { name: 'Dumbbell Curl', sets: 2, reps_min: 10, reps_max: 12 },
  ],
  lower: [
    { name: 'Leg Curl', sets: 2, reps_min: 10, reps_max: 12 },
    { name: 'Leg Extension', sets: 2, reps_min: 10, reps_max: 12 },
    { name: 'Calf Raise', sets: 2, reps_min: 12, reps_max: 15 },
  ],
  full: [
    { name: 'Calf Raise', sets: 2, reps_min: 12, reps_max: 15 },
    { name: 'Lateral Raise', sets: 2, reps_min: 12, reps_max: 15 },
    { name: 'Dumbbell Curl', sets: 2, reps_min: 10, reps_max: 12 },
  ],
};

function getDayCategory(dayName: string): 'upper' | 'lower' | 'full' {
  if (isUpperDay(dayName)) return 'upper';
  if (isLowerDay(dayName)) return 'lower';
  return 'full';
}

function applySessionLengthStructure(
  exercises: TemplateExercise[],
  dayName: string,
  sessionLength: SessionLength
): TemplateExercise[] {
  if (sessionLength === 'moderate') return exercises;

  if (sessionLength === 'short') {
    const minExercises = 4;
    let result = [...exercises];

    // Remove accessories from the end
    while (result.length > minExercises) {
      const lastIndex = result.length - 1;
      if (isCoreExercise(result[lastIndex].name, lastIndex)) break;
      result = result.slice(0, -1);
      if (exercises.length - result.length >= 2) break;
    }

    // Reduce sets on remaining accessories
    return result.map((exercise, index) => {
      if (!isCoreExercise(exercise.name, index) && exercise.sets > 1) {
        return { ...exercise, sets: exercise.sets - 1 };
      }
      return exercise;
    });
  }

  // Long: add an accessory if day has room
  if (exercises.length <= 6) {
    const category = getDayCategory(dayName);
    const pool = SESSION_ACCESSORY_POOL[category];
    const existingNames = new Set(exercises.map((e) => normalizeExerciseName(e.name)));

    for (const candidate of pool) {
      if (!existingNames.has(normalizeExerciseName(candidate.name))) {
        return [
          ...exercises.map((exercise, index) => {
            // +1 set on lead compound
            if (index === 0 && exercise.sets < 6) {
              return { ...exercise, sets: exercise.sets + 1 };
            }
            return exercise;
          }),
          candidate,
        ];
      }
    }
  }

  // Fallback: just boost lead compound set
  return exercises.map((exercise, index) => {
    if (index === 0 && exercise.sets < 6) {
      return { ...exercise, sets: exercise.sets + 1 };
    }
    return exercise;
  });
}

export function recommendProgramTemplate(
  templates: SplitTemplate[],
  answers: ProgramDesignAnswers
): SplitTemplate {
  const equipment = normalizeEquipmentProfile(answers.equipment);

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

      score += scoreTemplateEquipmentFit(template, equipment);

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
  const equipment = normalizeEquipmentProfile(answers.equipment);

  // 1. Session-length structural changes first (add/remove exercises)
  const structuredDays = baseTemplate.days.map((day) => ({
    ...day,
    exercises: applySessionLengthStructure(day.exercises, day.day_name, answers.sessionLength),
  }));

  // 2. Set adjustments for focus, experience, and equipment
  const adjustedDays = structuredDays.map((day) => ({
    ...day,
    exercises: day.exercises.map((exercise, exerciseIndex) => {
      let sets = exercise.sets;

      if (answers.experience === 'beginner' && sets > 2) {
        sets -= 1;
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

      if (equipment === 'dumbbell_only' && isHighSkillExercise(exercise.name) && sets > 2) {
        sets -= 1;
      }

      return {
        ...exercise,
        sets: clampSets(sets),
      };
    }),
  }));

  const equipmentAdjustedDays = adjustedDays.map((day) => {
    const usedNames = new Set<string>();

    return {
      ...day,
      exercises: day.exercises.map((exercise) => {
        const resolvedName = resolveExerciseForEquipment(exercise.name, equipment, usedNames);
        usedNames.add(normalizeExerciseName(resolvedName));

        return {
          ...exercise,
          name: resolvedName,
        };
      }),
    };
  });

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

  const equipmentLabel =
    equipment === 'full_gym'
      ? 'full-gym selection'
      : 'dumbbell-and-bodyweight substitutions';

  return {
    ...baseTemplate,
    name: `${baseTemplate.name} · Guided`,
    description: `${focusLabel} setup for ${answers.daysPerWeek} days/week with ${sessionLabel}, ${experienceLabel}, and ${equipmentLabel}.`,
    days: equipmentAdjustedDays,
  };
}
