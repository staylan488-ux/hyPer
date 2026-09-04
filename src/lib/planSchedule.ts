import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns';

import type { SplitDay } from '@/types';
import { supabase } from '@/lib/supabase';

export type PlanMode = 'fixed' | 'flex';

export interface PlanSchedule {
  splitId: string;
  startDate: string;
  mode: PlanMode;
  weekdays: number[];
  anchorDay?: number;
  /** Explicit flex split index; absent on legacy completion-offset schedules. */
  flexAnchorIndex?: number;
  updatedAt?: string;
}

function normalizeBySize(value: number, size: number): number {
  return ((value % size) + size) % size;
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

  const normalizedAnchor = normalizeBySize(anchorDay, 7);
  const offsets = offsetsByFrequency[Math.max(2, Math.min(7, daysPerWeek))] || offsetsByFrequency[4];

  return offsets.map((offset) => (normalizedAnchor + offset) % 7);
}

function normalizeWeekdayOrder(weekdays: number[]): number[] {
  const seen = new Set<number>();
  const ordered: number[] = [];

  for (const day of weekdays) {
    const normalized = normalizeBySize(day, 7);
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

  const fallbackAnchorDay =
    parsed.mode === 'fixed'
      ? normalizedWeekdays[0] ?? 1
      : 0;

  return {
    ...parsed,
    weekdays: normalizedWeekdays,
    anchorDay:
      typeof parsed.anchorDay === 'number'
        ? parsed.mode === 'fixed' ? normalizeBySize(parsed.anchorDay, 7) : parsed.anchorDay
        : fallbackAnchorDay,
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
    // Flex has no weekdays: a one-element array stores the explicit split index
    // without the legacy anchor_day column's 0..6 constraint. No schema change.
    flexAnchorIndex: row.mode === 'flex' && row.weekdays?.length === 1 ? row.weekdays[0] : undefined,
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
        weekdays: schedule.mode === 'flex' && schedule.flexAnchorIndex !== undefined
          ? [schedule.flexAnchorIndex] : schedule.weekdays,
        anchor_day: schedule.mode === 'flex' && schedule.flexAnchorIndex !== undefined
          ? null : schedule.anchorDay ?? null,
        updated_at: schedule.updatedAt ?? new Date().toISOString(),
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
export function savePlanSchedule(userId: string, schedule: PlanSchedule): PlanSchedule {
  const stamped = { ...schedule, updatedAt: new Date().toISOString() };
  saveLocalCache(userId, stamped);
  void saveToDB(userId, stamped);
  return stamped;
}

/**
 * Load with background sync: returns cached schedule instantly for fast UI,
 * then checks DB in the background. If remote is newer (by updated_at),
 * updates local cache and calls onRemoteUpdate so the component can re-render.
 *
 * Returns { cached, cancel, done } where cancel aborts the background fetch
 * and done resolves when the background fetch settles.
 */
export function loadWithBackgroundSync(
  userId: string,
  splitId: string,
  onRemoteUpdate: (schedule: PlanSchedule) => void,
): { cached: PlanSchedule | null; cancel: () => void; done: Promise<void> } {
  const cached = loadLocalCache(userId, splitId);
  let cancelled = false;

  const done = loadFromDB(userId, splitId).then((remote) => {
    if (cancelled || !remote) return;

    // A schedule may have been edited while this request was in flight.
    const currentCache = loadLocalCache(userId, splitId);
    if (!currentCache) {
      saveLocalCache(userId, remote);
      onRemoteUpdate(remote);
      return;
    }

    // Compare timestamps — only update if remote is strictly newer
    const localTime = currentCache.updatedAt ? new Date(currentCache.updatedAt).getTime() : 0;
    const remoteTime = remote.updatedAt ? new Date(remote.updatedAt).getTime() : 0;

    if (remoteTime > localTime) {
      saveLocalCache(userId, remote);
      onRemoteUpdate(remote);
    }
  });

  return {
    cached,
    cancel: () => {
      cancelled = true;
    },
    done,
  };
}

/** Persisted completion is the scheduling event; selecting/starting a day is not. */
export interface ScheduleWorkout {
  id: string;
  date: string;
  split_day_id: string | null;
  completed: boolean;
  created_at: string;
  completed_at?: string | null;
}

/**
 * Combine the saved workout order with the saved rest gaps. The full cycle may
 * span multiple weeks: repeat until both the split and weekday slots wrap.
 */
export function buildScheduleCycle(splitDays: SplitDay[], schedule: PlanSchedule): (SplitDay | null)[] {
  if (!splitDays.length) return [];
  if (schedule.mode === 'flex') return [...splitDays];
  const weekdays = normalizeWeekdayOrder(schedule.weekdays);
  if (!weekdays.length) return [];
  const cycle: (SplitDay | null)[] = [];
  let index = 0;
  do {
    cycle.push(splitDays[index % splitDays.length]);
    const slot = index % weekdays.length;
    const gap = normalizeBySize(weekdays[(slot + 1) % weekdays.length] - weekdays[slot], 7) || 7;
    for (let rest = 1; rest < gap; rest++) cycle.push(null);
    index++;
  } while (index % splitDays.length !== 0 || index % weekdays.length !== 0);
  return cycle;
}

export function plannedDayForDate(
  date: Date,
  splitDays: SplitDay[],
  schedule: PlanSchedule,
  completedWorkoutsSinceStart: number,
  history: ScheduleWorkout[] = [],
): SplitDay | null {
  if (splitDays.length === 0) return null;
  const dateKey = format(date, 'yyyy-MM-dd');
  if (dateKey < schedule.startDate) return null;

  const relevant = history.filter((workout) => (
    workout.completed && workout.date >= schedule.startDate && workout.date <= dateKey
    && splitDays.some((day) => day.id === workout.split_day_id)
    // An explicit schedule edit takes precedence over sessions already started.
    && (!schedule.updatedAt || Date.parse(workout.created_at) >= Date.parse(schedule.updatedAt))
  )).sort((a, b) => a.date.localeCompare(b.date)
    || Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id));

  if (schedule.mode === 'flex') {
    const last = relevant.at(-1);
    if (last) {
      const index = splitDays.findIndex((day) => day.id === last.split_day_id);
      // Flexible schedules have no saved rest rhythm and still wait for completion.
      return splitDays[(index + (last.date < dateKey ? 1 : 0)) % splitDays.length];
    }
    // Existing flex saves compensated anchorDay by the completed-session count.
    // Preserve that representation until the user explicitly edits the schedule.
    const legacyCount = history.length ? history.filter((workout) => (
      workout.completed && workout.date >= schedule.startDate && workout.date < dateKey
      && (!schedule.updatedAt || Date.parse(workout.created_at) < Date.parse(schedule.updatedAt))
    )).length : completedWorkoutsSinceStart;
    const index = normalizeBySize(schedule.flexAnchorIndex ?? ((schedule.anchorDay ?? 0) + legacyCount), splitDays.length);
    return splitDays[index];
  }

  const cycle = buildScheduleCycle(splitDays, schedule);
  if (!cycle.length) return null;
  const start = parseISO(schedule.startDate);
  // Day 1 is the first saved weekday on/before the plan's start date.
  let anchorDate = addDays(start, -normalizeBySize(start.getDay() - schedule.weekdays[0], 7));
  let anchorIndex = 0;
  for (const workout of relevant) {
    const performedDate = parseISO(workout.date);
    const expectedIndex = normalizeBySize(anchorIndex + differenceInCalendarDays(performedDate, anchorDate), cycle.length);
    const candidates = cycle.flatMap((day, index) => day?.id === workout.split_day_id ? [index] : []);
    // A split day can occur more than once in a multiweek cycle. Choose the
    // nearest occurrence; prefer forward on ties, without reordering the split.
    const distance = (index: number) => Math.min(
      normalizeBySize(index - expectedIndex, cycle.length),
      normalizeBySize(expectedIndex - index, cycle.length),
    );
    candidates.sort((a, b) => distance(a) - distance(b)
      || normalizeBySize(a - expectedIndex, cycle.length) - normalizeBySize(b - expectedIndex, cycle.length));
    anchorIndex = candidates[0];
    anchorDate = performedDate;
  }
  return cycle[normalizeBySize(anchorIndex + differenceInCalendarDays(date, anchorDate), cycle.length)];
}

/** Read all matching completions, including anchors before the visible week. */
export async function loadScheduleWorkouts(userId: string, splitDays: SplitDay[], schedule: PlanSchedule): Promise<ScheduleWorkout[]> {
  if (!splitDays.length) return [];
  const workouts: ScheduleWorkout[] = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    let query = supabase.from('workouts')
      .select('id, date, split_day_id, completed, created_at, completed_at')
      .eq('user_id', userId)
      .eq('completed', true)
      .gte('date', schedule.startDate)
      .order('date')
      .order('created_at')
      .order('id')
      .range(offset, offset + pageSize - 1);
    // Old flex offsets counted all sessions, including other programs.
    if (schedule.mode !== 'flex' || schedule.flexAnchorIndex !== undefined) {
      query = query.in('split_day_id', splitDays.map((day) => day.id));
    }
    const { data, error } = await query;
    if (error) throw error;
    workouts.push(...(data || []) as ScheduleWorkout[]);
    if (!data || data.length < pageSize) return workouts;
  }
}
