import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SplitDay } from '@/types';

const database = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  type Result = { data: Row[] | null; error: Error | null };
  const state = {
    tables: {} as Record<string, Row[]>,
    failure: null as Error | null,
    failAtOffset: 0,
    ranges: [] as { table: string; from: number; to: number }[],
  };

  class Query implements PromiseLike<Result> {
    private filters: ((row: Row) => boolean)[] = [];
    private orders: string[] = [];
    private first = 0;
    private last = Infinity;

    constructor(private table: string) {}
    select() { return this; }
    eq(field: string, value: unknown) { this.filters.push((row) => row[field] === value); return this; }
    gte(field: string, value: string) { this.filters.push((row) => String(row[field]) >= value); return this; }
    in(field: string, values: unknown[]) { this.filters.push((row) => values.includes(row[field])); return this; }
    order(field: string) { this.orders.push(field); return this; }
    range(from: number, to: number) {
      this.first = from;
      this.last = to;
      state.ranges.push({ table: this.table, from, to });
      return this;
    }
    private result(): Result {
      if (state.failure && this.first >= state.failAtOffset) return { data: null, error: state.failure };
      const rows = (state.tables[this.table] ?? []).filter((row) => this.filters.every((filter) => filter(row)));
      rows.sort((a, b) => {
        for (const field of this.orders) {
          const difference = String(a[field]).localeCompare(String(b[field]));
          if (difference !== 0) return difference;
        }
        return 0;
      });
      return { data: rows.slice(this.first, this.last + 1), error: null };
    }
    async maybeSingle() {
      const result = this.result();
      return { ...result, data: result.data?.[0] ?? null };
    }
    async upsert(row: Row) {
      const anchor = row.anchor_day;
      if (typeof anchor === 'number' && (anchor < 0 || anchor > 6)) {
        return { data: null, error: new Error('anchor_day must be between 0 and 6') };
      }
      const rows = state.tables[this.table] ?? [];
      state.tables[this.table] = [...rows.filter((existing) => (
        existing.user_id !== row.user_id || existing.split_id !== row.split_id
      )), structuredClone(row)];
      return { data: null, error: null };
    }
    then<TResult1 = Result, TResult2 = never>(
      onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): PromiseLike<TResult1 | TResult2> {
      return Promise.resolve(this.result()).then(onfulfilled, onrejected);
    }
  }

  return { state, from: vi.fn((table: string) => new Query(table)) };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from: database.from } }));

import {
  loadPlanSchedule,
  loadPlanScheduleAsync,
  loadScheduleWorkouts,
  plannedDayForDate,
  savePlanSchedule,
  type PlanSchedule,
} from '@/lib/planSchedule';

const splitDays: SplitDay[] = ['Upper A', 'Lower A', 'Upper B', 'Lower B'].map((name, index) => ({
  id: `day-${index}`, split_id: 'split', day_name: name, day_order: index, exercises: [],
}));
const schedule: PlanSchedule = {
  splitId: 'split', startDate: '2026-08-31', mode: 'fixed', weekdays: [1, 2, 4, 5], anchorDay: 1,
};

function session(id: string, date: string, day: string | null, userId = 'user') {
  return {
    id, user_id: userId, date, split_day_id: day, completed: true,
    created_at: `${date}T12:00:00Z`, completed_at: `${date}T13:00:00Z`,
  };
}

describe('schedule persistence and completion loading', () => {
  beforeEach(() => {
    database.state.tables = {};
    database.state.failure = null;
    database.state.failAtOffset = 0;
    database.state.ranges = [];
    database.from.mockClear();
    const cache = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => cache.get(key) ?? null,
      setItem: (key: string, value: string) => cache.set(key, value),
      clear: () => cache.clear(),
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-31T08:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('rebuilds the adaptive calendar from remote persisted rows after the local cache is cleared', async () => {
    const saved = savePlanSchedule('user', schedule);
    database.state.tables.workouts = [
      session('manual', '2026-09-01', 'day-2'),
      session('other-user', '2026-09-01', 'day-0', 'another-user'),
      session('other-program', '2026-09-01', 'another-day'),
      session('flexible', '2026-09-01', null),
      session('before-start', '2026-08-30', 'day-1'),
      { ...session('incomplete', '2026-09-02', 'day-0'), completed: false },
    ];
    localStorage.clear();
    expect(loadPlanSchedule('user', 'split')).toBeNull();
    const restored = await loadPlanScheduleAsync('user', 'split');
    expect(restored).toMatchObject(saved);
    expect(loadPlanSchedule('user', 'split')).toEqual(restored);
    const history = await loadScheduleWorkouts('user', splitDays, restored!);
    expect(history.map((row) => row.id)).toEqual(['manual']);
    const labels = Array.from({ length: 8 }, (_, index) => (
      plannedDayForDate(new Date(2026, 8, index + 1), splitDays, restored!, 0, history)?.day_name ?? 'Rest'
    ));
    expect(labels).toEqual(['Upper B', 'Lower B', 'Rest', 'Rest', 'Upper A', 'Lower A', 'Rest', 'Upper B']);
  });

  it('loads all old flex completions to restore the legacy offset, then follows a new active-split completion', async () => {
    const legacy: PlanSchedule = {
      ...schedule, mode: 'flex', weekdays: [], anchorDay: 3, updatedAt: '2026-09-04T08:00:00Z',
    };
    database.state.tables.workouts = [
      session('active-old', '2026-08-31', 'day-0'),
      session('other-old', '2026-09-01', 'another-program'),
      session('flex-old', '2026-09-02', null),
      session('other-new', '2026-09-04', 'another-program'),
      session('other-user', '2026-09-03', 'day-2', 'another-user'),
    ];
    const history = await loadScheduleWorkouts('user', splitDays, legacy);
    expect(history.map((row) => row.id)).toEqual(['active-old', 'other-old', 'flex-old', 'other-new']);
    expect(plannedDayForDate(new Date(2026, 8, 4), splitDays, legacy, 0, history)?.day_name).toBe('Upper B');
    database.state.tables.workouts.push(session('active-new', '2026-09-05', 'day-3'));
    const updatedHistory = await loadScheduleWorkouts('user', splitDays, legacy);
    expect(plannedDayForDate(new Date(2026, 8, 6), splitDays, legacy, 0, updatedHistory)?.day_name).toBe('Upper A');
  });

  it('rejects read failures instead of returning an empty or partial completion history', async () => {
    database.state.failure = new Error('network unavailable');
    await expect(loadScheduleWorkouts('user', splitDays, schedule)).rejects.toThrow('network unavailable');
    database.state.tables.workouts = Array.from({ length: 1000 }, (_, index) => (
      session(`old-${String(index).padStart(4, '0')}`, '2026-08-31', 'day-0')
    ));
    database.state.failAtOffset = 1000;
    await expect(loadScheduleWorkouts('user', splitDays, schedule)).rejects.toThrow('network unavailable');
  });

  it('paginates beyond the database row cap so the newest anchor is never omitted', async () => {
    database.state.tables.workouts = [
      ...Array.from({ length: 1000 }, (_, index) => (
        session(`old-${String(index).padStart(4, '0')}`, '2026-08-31', 'day-0')
      )),
      session('latest', '2026-09-01', 'day-2'),
    ];
    const history = await loadScheduleWorkouts('user', splitDays, schedule);
    expect(history).toHaveLength(1001);
    expect(history.at(-1)?.id).toBe('latest');
    expect(database.state.ranges).toEqual([
      { table: 'workouts', from: 0, to: 999 },
      { table: 'workouts', from: 1000, to: 1999 },
    ]);
    expect(plannedDayForDate(new Date(2026, 8, 2), splitDays, schedule, 0, history)?.day_name).toBe('Lower B');
  });

  it('round-trips explicit flex index eight remotely within the existing database constraints', async () => {
    const days = Array.from({ length: 9 }, (_, index) => ({
      ...splitDays[0], id: `long-${index}`, day_order: index, day_name: `Day ${index + 1}`,
    }));
    savePlanSchedule('user', {
      ...schedule, mode: 'flex', weekdays: [], anchorDay: 8, flexAnchorIndex: 8,
    });
    expect(database.state.tables.plan_schedules[0]).toMatchObject({
      mode: 'flex', weekdays: [8], anchor_day: null,
    });
    localStorage.clear();
    const restored = await loadPlanScheduleAsync('user', 'split');
    expect(restored?.flexAnchorIndex).toBe(8);
    expect(loadPlanSchedule('user', 'split')?.flexAnchorIndex).toBe(8);
    expect(plannedDayForDate(new Date(2026, 8, 1), days, restored!, 0, [])?.day_name).toBe('Day 9');
    database.state.tables.workouts = [
      session('other-program', '2026-09-01', 'another-program'),
      session('flexible', '2026-09-01', null),
      session('completed-last', '2026-09-02', 'long-8'),
    ];
    const history = await loadScheduleWorkouts('user', days, restored!);
    expect(history.map((row) => row.id)).toEqual(['completed-last']);
    expect(plannedDayForDate(new Date(2026, 8, 3), days, restored!, 0, history)?.day_name).toBe('Day 1');
  });
});
