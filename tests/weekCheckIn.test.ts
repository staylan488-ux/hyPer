import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockClient } from '@/preview/mockSupabase';
import { previewTables } from '@/preview/previewData';

vi.mock('@/lib/supabase', () => ({ supabase: {
  auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } }, error: null }) },
  from: (table: string) => client.from(table),
} }));

import {
  checkInWeek, checkInWeekLabel, goalPaceKg, hasCheckIn, isCheckInDay, paceCall, priorRecords,
  readWeekCheckIn, weekEating, weekRecords, weekWeight, type RecordSet, type WeekSet,
} from '@/lib/weekCheckIn';
import type { MovementSetRow } from '@/lib/movementHistory';

// The Monday check-in looks back at the training week before (Monday to
// Sunday): weight against the goal's pace, food a day, sets per muscle and
// records.

let client = createMockClient();

describe('the week it looks back at', () => {
  it('shows on Mondays only', () => {
    expect(isCheckInDay('2026-11-09')).toBe(true);
    expect(isCheckInDay('2026-11-08')).toBe(false);
    expect(isCheckInDay('2026-11-10')).toBe(false);
  });

  it('is the Monday-to-Sunday week before this one, with the week before that for the weight change', () => {
    expect(checkInWeek('2026-11-09')).toEqual({ start: '2026-11-02', end: '2026-11-08', before: '2026-10-26' });
    // Any day of a week looks back at the same one.
    expect(checkInWeek('2026-11-15')).toEqual(checkInWeek('2026-11-09'));
    expect(checkInWeekLabel(checkInWeek('2026-11-09'))).toBe('Nov 2–8');
    expect(checkInWeekLabel(checkInWeek('2026-11-03'))).toBe('Oct 26–Nov 1');
  });
});

describe('weight', () => {
  const week = checkInWeek('2026-11-09');
  const at = (day: string, kilograms: number, hour = 8) => ({ measured_at: new Date(`${day}T${String(hour).padStart(2, '0')}:00:00`).toISOString(), kilograms });

  it('compares the weeks’ averages of each day’s median, so one odd reading moves nothing', () => {
    const weight = weekWeight([
      at('2026-10-27', 60), at('2026-10-29', 60.2),
      // Two readings on the 3rd: the day counts once, at their median.
      at('2026-11-03', 60.4), at('2026-11-03', 60.4, 20), at('2026-11-03', 63, 21),
      at('2026-11-06', 60.6),
      // This week's weigh-in is not last week's.
      at('2026-11-09', 70),
    ], week);
    expect(weight?.days).toBe(2);
    expect(weight?.averageKg).toBeCloseTo(60.5);
    expect(weight?.changeKg).toBeCloseTo(0.4);
  });

  it('gives the average alone without a weigh-in the week before, and nothing without one last week', () => {
    expect(weekWeight([at('2026-11-04', 61)], week)).toEqual({ averageKg: 61, days: 1, changeKg: null });
    expect(weekWeight([at('2026-10-28', 61)], week)).toBeNull();
  });

  it('turns the goal’s rate into a pace at this weight, with none while maintaining', () => {
    expect(goalPaceKg({ goal: 'bulk', rate_pct_per_week: 0.5 }, 60)).toBeCloseTo(0.3);
    expect(goalPaceKg({ goal: 'cut', rate_pct_per_week: -0.5 }, 80)).toBeCloseTo(-0.4);
    expect(goalPaceKg({ goal: 'maintain', rate_pct_per_week: 0 }, 60)).toBeNull();
    expect(goalPaceKg({ goal: 'lean_bulk', rate_pct_per_week: 0 }, 60)).toBeNull();
    expect(goalPaceKg(null, 60)).toBeNull();
  });

  it('calls the week ahead, on or behind pace in the goal’s direction', () => {
    expect(paceCall(0.3, 0.3)).toBe('on pace');
    expect(paceCall(0.35, 0.3)).toBe('on pace');
    expect(paceCall(0.6, 0.3)).toBe('ahead of pace');
    expect(paceCall(0, 0.3)).toBe('behind pace');
    // A slow pace keeps a tenth of a kilo either side.
    expect(paceCall(0.15, 0.1)).toBe('on pace');
    // Cutting: losing faster is ahead.
    expect(paceCall(-0.8, -0.4)).toBe('ahead of pace');
    expect(paceCall(0.1, -0.4)).toBe('behind pace');
  });
});

describe('food', () => {
  it('averages calories and protein over the days logged', () => {
    const days = [
      { date: '2026-11-02', calories: 3000, protein: 200 },
      { date: '2026-11-03', calories: 0, protein: 0 },
      { date: '2026-11-04', calories: 2600, protein: 160 },
    ];
    expect(weekEating(days)).toEqual({ days: 2, calories: 2800, protein: 180 });
    expect(weekEating([{ date: '2026-11-02', calories: 0, protein: 0 }])).toBeNull();
    expect(weekEating([])).toBeNull();
  });
});

describe('records', () => {
  const names: Record<string, string> = { bench: 'Bench press', lever: 'Front lever', squat: 'Squat', row: 'Row' };
  const weekSet = (exercise: string, weight: number, reps: number, date = '2026-11-04'): WeekSet => ({ exercise_id: exercise, name: names[exercise], weight, reps, date });
  let rowId = 0;
  const priorRow = (exercise: string, weight: number, reps: number, date: string, completed = true): MovementSetRow => ({
    id: `r${++rowId}`, workout_id: `w-${date}`, exercise_id: exercise, set_number: 1, weight, reps, completed: true,
    workout: { date, created_at: null, completed },
  });
  const ids = ['bench', 'lever', 'squat', 'row'];

  it('finds one record a movement by the movement history’s rule: a higher estimated max, else a heavier load, else more bodyweight reps', () => {
    const prior = priorRecords([
      priorRow('bench', 200, 5, '2026-10-20'),
      priorRow('squat', 200, 10, '2026-10-21'),
      priorRow('lever', 0, 6, '2026-10-22'),
      priorRow('row', 150, 10, '2026-10-22'),
      // Unfinished workouts and the week itself never set the bar.
      priorRow('bench', 300, 5, '2026-10-23', false),
      priorRow('bench', 205, 5, '2026-11-04'),
    ], ids, '2026-11-02');
    const records = weekRecords([
      weekSet('bench', 205, 5), weekSet('bench', 205, 3),
      // A heavier single that doesn't raise the estimated max.
      weekSet('squat', 230, 1, '2026-11-06'),
      weekSet('lever', 0, 8, '2026-11-05'),
      // Matching the best is not beating it.
      weekSet('row', 150, 10),
    ], prior);
    expect(records.map((record) => [record.name, record.kind, record.set.weight, record.set.reps, record.set.date])).toEqual([
      ['Squat', 'heaviest', 230, 1, '2026-11-06'],
      ['Front lever', 'reps', 0, 8, '2026-11-05'],
      ['Bench press', 'max', 205, 5, '2026-11-04'],
    ]);
    expect(records.find((record) => record.name === 'Bench press')?.previous).toEqual({ weight: 200, reps: 5, date: '2026-10-20' });
  });

  it('sets nothing in a movement’s first week, with nothing to beat', () => {
    expect(weekRecords([weekSet('bench', 300, 5)], priorRecords([], ids, '2026-11-02'))).toEqual([]);
    expect(weekRecords([weekSet('lever', 0, 10)], priorRecords([priorRow('lever', 20, 5, '2026-10-01')], ids, '2026-11-02'))).toEqual([]);
  });
});

describe('reading the week', () => {
  const exercises = [
    { id: 'bench', name: 'Bench press', muscle_group: 'chest', muscle_group_secondary: 'triceps' },
    { id: 'lever', name: 'Front lever', muscle_group: 'back', muscle_group_secondary: null },
  ];
  const workout = (id: string, date: string, completed: boolean) => ({ id, user_id: 'u1', date, completed });
  const setRow = (id: string, workout_id: string, exercise_id: string, weight: number, reps: number, completed = true) => ({ id, workout_id, exercise_id, set_number: 1, weight, reps, completed });

  beforeEach(() => {
    for (const key of Object.keys(previewTables)) delete previewTables[key];
    Object.assign(previewTables, {
      exercises,
      workouts: [
        workout('old', '2026-10-20', true),
        // Unfinished workouts never set the bar to beat.
        workout('old-open', '2026-10-21', false),
        workout('w1', '2026-11-03', true),
        workout('w2', '2026-11-05', false),
        workout('now', '2026-11-09', true),
        { ...workout('theirs', '2026-11-04', true), user_id: 'u2' },
      ],
      sets: [
        setRow('s01', 'old', 'bench', 200, 5),
        setRow('s02', 'old', 'lever', 0, 10),
        setRow('s03', 'old-open', 'bench', 300, 5),
        setRow('s04', 'w1', 'bench', 205, 5),
        setRow('s05', 'w1', 'bench', 205, 5),
        setRow('s06', 'w1', 'lever', 0, 12),
        setRow('s07', 'w1', 'bench', 400, 5, false),
        // Counted as sets, never as records: its workout wasn't finished.
        setRow('s08', 'w2', 'bench', 250, 5),
        setRow('s09', 'now', 'bench', 260, 5),
        setRow('s10', 'theirs', 'bench', 100, 5),
      ],
      volume_landmarks: [],
      body_weight_measurements: [
        { user_id: 'u1', measured_at: new Date('2026-10-28T08:00:00').toISOString(), kilograms: 60 },
        { user_id: 'u1', measured_at: new Date('2026-11-04T08:00:00').toISOString(), kilograms: 60.5 },
      ],
      foods: [{ id: 'f1', calories: 500, protein: 40 }],
      nutrition_logs: [
        { user_id: 'u1', date: '2026-11-03', food_id: 'f1', servings: 5 },
        { user_id: 'u1', date: '2026-11-04', food_id: 'f1', servings: 6 },
        { user_id: 'u1', date: '2026-10-30', food_id: 'f1', servings: 9 },
      ],
    });
    client = createMockClient();
  });

  it('brings the week’s weight, food, sets per muscle and records together', async () => {
    const checkIn = await readWeekCheckIn({ userId: 'u1', todayKey: '2026-11-09', landmarks: [] });
    expect(checkIn.week.start).toBe('2026-11-02');
    expect(checkIn.weight?.changeKg).toBeCloseTo(0.5);
    expect(checkIn.eating).toEqual({ days: 2, calories: 2750, protein: 220 });
    // Completed sets in any workout of the week; another account's never.
    expect(checkIn.sets).toBe(4);
    expect(checkIn.muscles.map((volume) => [volume.muscle_group, volume.weekly_sets, volume.status])).toEqual([
      ['chest', 3, 'below_mev'],
      ['triceps', 1.5, 'below_mev'],
      ['back', 1, 'below_mev'],
    ]);
    expect(checkIn.records.map((record) => [record.name, record.kind, record.set.weight, record.previous.weight])).toEqual([
      ['Bench press', 'max', 205, 200],
      ['Front lever', 'reps', 0, 0],
    ]);
    expect(hasCheckIn(checkIn)).toBe(true);
  });

  it('holds nothing for an empty week', async () => {
    const checkIn = await readWeekCheckIn({ userId: 'u1', todayKey: '2026-12-07', landmarks: [] });
    expect(checkIn).toMatchObject({ weight: null, eating: null, sets: 0, muscles: [], records: [] });
    expect(hasCheckIn(checkIn)).toBe(false);
  });

  it('fails as a whole when a read fails, rather than showing a quiet week', async () => {
    const from = client.from.bind(client);
    client = { ...client, from: (table: string) => (table === 'workouts' ? { select: () => ({ eq: () => ({ gte: () => ({ lte: async () => ({ data: null, error: { message: 'offline' } }) }) }) }) } : from(table)) } as unknown as typeof client;
    await expect(readWeekCheckIn({ userId: 'u1', todayKey: '2026-11-09', landmarks: [] })).rejects.toThrow('offline');
  });
});

describe('the words on the card and Last week', async () => {
  const words = await import('../native/src/lib/weekCheckIn');
  const set = (weight: number, reps: number): RecordSet => ({ weight, reps, date: '2026-11-04' });

  it('signs a change in the chosen unit, with no sign when it rounds to nothing', () => {
    expect(words.signedWeight(0.2, 'lb')).toBe('+0.4 lb');
    expect(words.signedWeight(-0.25, 'kg')).toBe('−0.3 kg');
    expect(words.signedWeight(0.01, 'lb')).toBe('0.0 lb');
    expect(words.paceWeekLabel(0.227, 'lb')).toBe('+0.5 lb a week');
  });

  it('says the change against the pace, or the average when there is nothing to compare', () => {
    expect(words.weightLine({ averageKg: 60, days: 4, changeKg: 0.2 }, 'lb', 0.2)).toEqual({ value: '+0.4 lb', after: ' · on pace' });
    expect(words.weightLine({ averageKg: 60, days: 4, changeKg: 0.5 }, 'lb', 0.2)).toEqual({ value: '+1.1 lb', after: ' · ahead of pace' });
    expect(words.weightLine({ averageKg: 60, days: 4, changeKg: 0.2 }, 'lb', null)).toEqual({ value: '+0.4 lb', after: '' });
    expect(words.weightLine({ averageKg: 60, days: 1, changeKg: null }, 'kg', 0.2)).toEqual({ value: '60.0 kg', after: ' average' });
  });

  it('says what each record beat', () => {
    expect(words.recordDetail({ exerciseId: 'bench', name: 'Bench', kind: 'max', set: set(205, 5), previous: set(200, 5) })).toBe('Est. max 239 lb · was 233');
    expect(words.recordDetail({ exerciseId: 'bench', name: 'Bench', kind: 'heaviest', set: set(230, 1), previous: set(202.5, 8) })).toBe('Heaviest · was 202.5 lb');
    expect(words.recordDetail({ exerciseId: 'lever', name: 'Lever', kind: 'reps', set: set(0, 8), previous: set(0, 6) })).toBe('Most reps · was 6');
  });

  it('notes a muscle only outside its range', () => {
    const landmark = { id: 'l', user_id: 'u1', muscle_group: 'chest' as const, mv: 0, mev: 8, mav_low: 10, mav_high: 16, mrv: 22 };
    expect(words.muscleNote({ muscle_group: 'chest', weekly_sets: 4, landmark, status: 'below_mev' })).toBe('Under its minimum of 8');
    expect(words.muscleNote({ muscle_group: 'chest', weekly_sets: 24, landmark, status: 'above_mrv' })).toBe('Over its ceiling of 22');
    expect(words.muscleNote({ muscle_group: 'chest', weekly_sets: 12, landmark, status: 'mav' })).toBeUndefined();
    expect(words.musclesInRange([
      { muscle_group: 'chest', weekly_sets: 12, landmark, status: 'mav' },
      { muscle_group: 'back', weekly_sets: 2, landmark: { ...landmark, muscle_group: 'back' }, status: 'below_mev' },
      { muscle_group: 'traps', weekly_sets: 3, landmark: undefined, status: null },
    ])).toBe('1 of 2 muscles in range');
  });
});

describe('Today’s Monday card', async () => {
  const { checkInLines } = await import('../native/src/lib/weekCheckIn');
  const week = checkInWeek('2026-11-09');
  const landmark = { id: 'l', user_id: 'u1', muscle_group: 'chest' as const, mv: 0, mev: 8, mav_low: 10, mav_high: 16, mrv: 22 };
  const record = { exerciseId: 'bench', name: 'Bench', kind: 'max' as const, set: { weight: 205, reps: 5, date: '2026-11-04' }, previous: { weight: 200, reps: 5, date: '2026-10-20' } };

  it('reads a bulking week past its targets as plainly as one under them', () => {
    const lines = checkInLines(
      { week, weight: { averageKg: 60, days: 5, changeKg: 0.3 }, eating: { days: 7, calories: 3120, protein: 196 }, sets: 58, muscles: [{ muscle_group: 'chest', weekly_sets: 12, landmark, status: 'mav' }], records: [record, record] },
      'lb',
      { calories: 2800, protein: 180 },
      0.3,
    );
    expect(lines.map((line) => `${line.label}: ${line.value}${line.after}`)).toEqual([
      'Weight: +0.7 lb · on pace',
      'Calories a day: 3,120 of 2,800 kcal',
      'Protein a day: 196 of 180 g',
      'Sets: 58 · 1 of 1 muscles in range',
      'Records: 2 new',
    ]);
  });

  it('leaves out what the week doesn’t hold', () => {
    const lines = checkInLines({ week, weight: null, eating: { days: 2, calories: 2000, protein: 120 }, sets: 0, muscles: [], records: [] }, 'kg', null, null);
    expect(lines.map((line) => `${line.label}: ${line.value}${line.after}`)).toEqual(['Calories a day: 2,000 kcal', 'Protein a day: 120 g']);
  });
});
