import { MUSCLE_GROUP_LABELS, type MuscleGroup } from '@/types';

/** Muscles named in the singular; every other group reads as plural. */
const SINGULAR: ReadonlySet<MuscleGroup> = new Set(['chest', 'back', 'core']);

/** Names that read as the subject of a sentence ("Shoulders are…", "Core is…"). */
const SENTENCE_NAMES: Partial<Record<MuscleGroup, string>> = {
  shoulders: 'Shoulders',
  core: 'Core',
};

export function isPluralMuscle(muscle: MuscleGroup): boolean {
  return !SINGULAR.has(muscle);
}

/** "Hamstrings are", "Chest is" — the muscle as a sentence subject with its verb. */
export function muscleSubject(muscle: MuscleGroup): { name: string; is: 'is' | 'are'; its: 'its' | 'their' } {
  const name = SENTENCE_NAMES[muscle] ?? MUSCLE_GROUP_LABELS[muscle] ?? muscle.replace(/_/g, ' ');
  const plural = isPluralMuscle(muscle);
  return { name, is: plural ? 'are' : 'is', its: plural ? 'their' : 'its' };
}
