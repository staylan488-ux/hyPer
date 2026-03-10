import { addWeeks, format, parseISO, startOfWeek, subWeeks } from 'date-fns';

import type { Workout } from '@/types';

type WorkoutTitleInput = {
  splitDayName?: string | null;
  dayLabel?: string | null;
  exerciseNames?: Array<string | null | undefined>;
};

export type TrainingHoursWorkout = Pick<Workout, 'completed' | 'completed_at' | 'created_at' | 'date'>;

export interface TrainingHoursPoint {
  weekStart: string;
  label: string;
  totalMinutes: number;
  totalHours: number;
}

function trimValue(value?: string | null): string {
  return value?.trim() || '';
}

function uniqueExerciseNames(names: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];

  for (const name of names) {
    const trimmed = trimValue(name);
    if (!trimmed) continue;

    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    ordered.push(trimmed);
  }

  return ordered;
}

function toDate(value?: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function resolveWorkoutTitle(input: WorkoutTitleInput): string {
  const splitDayName = trimValue(input.splitDayName);
  if (splitDayName) return splitDayName;

  const dayLabel = trimValue(input.dayLabel);
  if (dayLabel) return dayLabel;

  const exerciseNames = uniqueExerciseNames(input.exerciseNames || []);
  if (exerciseNames.length === 0) return 'Session';
  if (exerciseNames.length === 1) return exerciseNames[0];
  if (exerciseNames.length === 2) return `${exerciseNames[0]} / ${exerciseNames[1]}`;
  return `${exerciseNames[0]} +${exerciseNames.length - 1}`;
}

export function getWorkoutDurationMs(workout: Pick<Workout, 'completed_at' | 'created_at'>): number | null {
  const createdAt = toDate(workout.created_at);
  const completedAt = toDate(workout.completed_at);

  if (!createdAt || !completedAt) return null;

  const durationMs = completedAt.getTime() - createdAt.getTime();
  if (!Number.isFinite(durationMs) || durationMs <= 0) return null;

  return durationMs;
}

export function formatWorkoutDuration(durationMs: number | null): string {
  if (!durationMs || durationMs <= 0) return '—';

  const totalMinutes = Math.max(1, Math.round(durationMs / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) return `${totalMinutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

export function buildWeeklyTrainingHours(
  workouts: TrainingHoursWorkout[],
  now: Date = new Date(),
  weeks = 8,
): TrainingHoursPoint[] {
  const safeWeeks = Math.max(1, Math.floor(weeks));
  const currentWeekStart = startOfWeek(now, { weekStartsOn: 1 });
  const firstWeekStart = subWeeks(currentWeekStart, safeWeeks - 1);

  const buckets = new Map<string, TrainingHoursPoint>();

  for (let index = 0; index < safeWeeks; index += 1) {
    const weekStartDate = addWeeks(firstWeekStart, index);
    const weekStart = format(weekStartDate, 'yyyy-MM-dd');
    buckets.set(weekStart, {
      weekStart,
      label: format(weekStartDate, 'MMM d'),
      totalMinutes: 0,
      totalHours: 0,
    });
  }

  for (const workout of workouts) {
    if (!workout.completed) continue;

    const durationMs = getWorkoutDurationMs(workout);
    if (!durationMs) continue;

    const workoutDate = parseISO(workout.date);
    if (Number.isNaN(workoutDate.getTime())) continue;

    const weekStart = format(startOfWeek(workoutDate, { weekStartsOn: 1 }), 'yyyy-MM-dd');
    const bucket = buckets.get(weekStart);
    if (!bucket) continue;

    bucket.totalMinutes += Math.round(durationMs / 60000);
  }

  return Array.from(buckets.values()).map((bucket) => ({
    ...bucket,
    totalHours: Number((bucket.totalMinutes / 60).toFixed(1)),
  }));
}
