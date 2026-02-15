import { addDays, format } from 'date-fns';

import type { SplitDay } from '@/types';

export type PlanMode = 'fixed' | 'flex';

export interface PlanSchedule {
  splitId: string;
  startDate: string;
  mode: PlanMode;
  weekdays: number[];
  anchorDay?: number;
}

function keyFor(userId: string, splitId: string): string {
  return `plan-schedule:${userId}:${splitId}`;
}

export function defaultStartDate(): string {
  const now = new Date();
  const start = now.getHours() >= 20 ? addDays(now, 1) : now;
  return format(start, 'yyyy-MM-dd');
}

export function defaultWeekdays(daysPerWeek: number): number[] {
  if (daysPerWeek <= 3) return [1, 3, 5];
  if (daysPerWeek === 4) return [1, 2, 4, 5];
  if (daysPerWeek === 5) return [1, 2, 3, 5, 6];
  return [1, 2, 3, 4, 5, 6];
}

export function buildFixedWeekdays(anchorDay: number, daysPerWeek: number): number[] {
  const offsetsByFrequency: Record<number, number[]> = {
    2: [0, 3],
    3: [0, 2, 4],
    4: [0, 1, 3, 4],
    5: [0, 1, 2, 4, 5],
    6: [0, 1, 2, 3, 4, 5],
    7: [0, 1, 2, 3, 4, 5, 6],
  };

  const normalizedAnchor = ((anchorDay % 7) + 7) % 7;
  const offsets = offsetsByFrequency[Math.max(2, Math.min(7, daysPerWeek))] || offsetsByFrequency[4];

  return offsets.map((offset) => (normalizedAnchor + offset) % 7);
}

function normalizeWeekdayOrder(weekdays: number[]): number[] {
  const seen = new Set<number>();
  const ordered: number[] = [];

  for (const day of weekdays) {
    const normalized = ((day % 7) + 7) % 7;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    ordered.push(normalized);
  }

  return ordered;
}

export function loadPlanSchedule(userId: string, splitId: string): PlanSchedule | null {
  const raw = globalThis.localStorage?.getItem(keyFor(userId, splitId));
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as PlanSchedule;
    if (!parsed.startDate || !parsed.mode || !Array.isArray(parsed.weekdays)) return null;

    const normalizedWeekdays = normalizeWeekdayOrder(parsed.weekdays);
    if (parsed.mode === 'fixed' && normalizedWeekdays.length === 0) return null;

    return {
      ...parsed,
      weekdays: normalizedWeekdays,
      anchorDay:
        typeof parsed.anchorDay === 'number'
          ? ((parsed.anchorDay % 7) + 7) % 7
          : normalizedWeekdays[0] ?? 1,
    };
  } catch {
    return null;
  }
}

export function savePlanSchedule(userId: string, schedule: PlanSchedule): void {
  globalThis.localStorage?.setItem(keyFor(userId, schedule.splitId), JSON.stringify(schedule));
}

export function plannedDayForDate(
  date: Date,
  splitDays: SplitDay[],
  schedule: PlanSchedule,
  completedWorkoutsSinceStart: number
): SplitDay | null {
  if (splitDays.length === 0) return null;

  if (schedule.mode === 'fixed') {
    const weekDay = date.getDay();
    const idx = schedule.weekdays.indexOf(weekDay);
    if (idx < 0) return null;
    return splitDays[idx % splitDays.length] || null;
  }

  const index = completedWorkoutsSinceStart % splitDays.length;
  return splitDays[index] || null;
}
