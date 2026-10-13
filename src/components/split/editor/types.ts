export type PickMode = 'add' | 'swap' | 'superset';

/** Opens the shared exercise picker for a day, optionally for one of its exercises. */
export type PickExercise = (dayId: string, mode: PickMode, exerciseId?: string) => void;
