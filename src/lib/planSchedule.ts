import { addDays, format } from 'date-fns';

import type { SplitDay } from '@/types';
import { supabase } from '@/lib/supabase';

export type PlanMode = 'fixed' | 'flex';

export interface PlanSchedule {
  splitId: string;
  startDate: string;
  mode: PlanMode;
  weekdays: number[];
  anchorDay?: number;
  updatedAt?: string;
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

/** Validate and normalize a raw PlanSchedule-shaped object. */
function normalizeParsed(parsed: PlanSchedule): PlanSchedule | null {
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
}

// ── Local cache helpers ──

function loadLocalCache(userId: string, splitId: string): PlanSchedule | null {
  const raw = globalThis.localStorage?.getItem(keyFor(userId, splitId));
  if (!raw) return null;

  try {
    return normalizeParsed(JSON.parse(raw) as PlanSchedule);
  } catch {
    return null;
  }
}

function saveLocalCache(userId: string, schedule: PlanSchedule): void {
  globalThis.localStorage?.setItem(keyFor(userId, schedule.splitId), JSON.stringify(schedule));
}

// ── DB helpers ──

function rowToSchedule(row: {
  split_id: string;
  start_date: string;
  mode: string;
  weekdays: number[];
  anchor_day: number | null;
  updated_at?: string;
}): PlanSchedule | null {
  return normalizeParsed({
    splitId: row.split_id,
    startDate: row.start_date,
    mode: row.mode as PlanMode,
    weekdays: row.weekdays ?? [],
    anchorDay: row.anchor_day ?? undefined,
    updatedAt: row.updated_at ?? undefined,
  });
}

async function loadFromDB(userId: string, splitId: string): Promise<PlanSchedule | null> {
  try {
    const { data, error } = await supabase
      .from('plan_schedules')
      .select('split_id, start_date, mode, weekdays, anchor_day, updated_at')
      .eq('user_id', userId)
      .eq('split_id', splitId)
      .maybeSingle();

    if (error || !data) return null;
    return rowToSchedule(data);
  } catch {
    return null;
  }
}

async function saveToDB(userId: string, schedule: PlanSchedule): Promise<void> {
  try {
    await supabase
      .from('plan_schedules')
      .upsert({
        user_id: userId,
        split_id: schedule.splitId,
        start_date: schedule.startDate,
        mode: schedule.mode,
        weekdays: schedule.weekdays,
        anchor_day: schedule.anchorDay ?? null,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'user_id,split_id',
      });
  } catch {
    // Silently fail — localStorage still has the data
  }
}

// ── Public API ──

/**
 * Load plan schedule: instant from localStorage, then background-sync from DB.
 * Returns the cached value immediately; if DB has newer data, calls onRemoteUpdate.
 */
export function loadPlanSchedule(userId: string, splitId: string): PlanSchedule | null {
  return loadLocalCache(userId, splitId);
}

/**
 * Async load that checks DB when localStorage misses.
 * Use this on page mount for cross-device persistence.
 */
export async function loadPlanScheduleAsync(userId: string, splitId: string): Promise<PlanSchedule | null> {
  const cached = loadLocalCache(userId, splitId);
  if (cached) return cached;

  const remote = await loadFromDB(userId, splitId);
  if (remote) {
    saveLocalCache(userId, remote);
  }
  return remote;
}

/**
 * Save plan schedule to both localStorage (instant) and DB (async).
 */
export function savePlanSchedule(userId: string, schedule: PlanSchedule): void {
  const stamped = { ...schedule, updatedAt: new Date().toISOString() };
  saveLocalCache(userId, stamped);
  void saveToDB(userId, stamped);
}

/**
 * Load with background sync: returns cached schedule instantly for fast UI,
 * then checks DB in the background. If remote is newer (by updated_at),
 * updates local cache and calls onRemoteUpdate so the component can re-render.
 *
 * Returns { cached, cancel } where cancel aborts the background fetch.
 */
export function loadWithBackgroundSync(
  userId: string,
  splitId: string,
  onRemoteUpdate: (schedule: PlanSchedule) => void,
): { cached: PlanSchedule | null; cancel: () => void } {
  const cached = loadLocalCache(userId, splitId);
  let cancelled = false;

  void loadFromDB(userId, splitId).then((remote) => {
    if (cancelled || !remote) return;

    // If no local cache, just populate it
    if (!cached) {
      saveLocalCache(userId, remote);
      onRemoteUpdate(remote);
      return;
    }

    // Compare timestamps — only update if remote is strictly newer
    const localTime = cached.updatedAt ? new Date(cached.updatedAt).getTime() : 0;
    const remoteTime = remote.updatedAt ? new Date(remote.updatedAt).getTime() : 0;

    if (remoteTime > localTime) {
      saveLocalCache(userId, remote);
      onRemoteUpdate(remote);
    }
  });

  return { cached, cancel: () => { cancelled = true; } };
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
