import { afterEach, describe, expect, it } from 'vitest';

import {
  MAIN_MUSCLES,
  formatSetCount,
  muscleLabel,
  plannedWeekDays,
  programVolume,
  usualWeek,
  volumeBand,
  volumeMuscle,
  volumeRows,
  weekProgress,
  type MuscleSource,
  type VolumeSession,
} from '@/lib/muscleVolume';
import type { PlanSchedule, ScheduleWorkout } from '@/lib/planSchedule';
import { serializeSetRangeNotes } from '@/lib/setRangeNotes';
import type { SplitDay, SplitExercise } from '@/types';

const move = (muscle_group: string, muscle_group_secondary: string | null = null): MuscleSource => ({ muscle_group, muscle_group_secondary });

const BENCH = move('chest', 'triceps');
const ROW = move('back', 'biceps');
const SQUAT = move('quads', 'glutes');
const PRESS = move('shoulders', 'triceps');
const RAISE = move('side_delts');

function exercise(source: MuscleSource, target_sets: number, extra: Partial<SplitExercise> = {}): SplitExercise {
  return {
    id: `ex-${Math.random()}`,
    split_day_id: 'day',
    exercise_id: `${source.muscle_group}-${source.muscle_group_secondary}`,
    exercise: { id: 'x', name: 'X', equipment: null, is_compound: false, ...source } as SplitExercise['exercise'],
    target_sets,
    target_reps_min: 8,
    target_reps_max: 12,
    exercise_order: 0,
    notes: null,
    ...extra,
  };
}

function day(id: string, exercises: SplitExercise[]): SplitDay {
  return { id, split_id: 'split', day_name: id, day_order: 0, exercises };
}

/** A finished session of `count` finished sets of each movement. */
function session(date: string, movements: MuscleSource[], count = 3, split_day_id: string | null = null): VolumeSession {
  return {
    date,
    split_day_id,
    sets: movements.flatMap((exercise) => Array.from({ length: count }, () => ({ completed: true, exercise }))),
  };
}

describe('muscle names', () => {
  it('counts shoulders as front delts and maps the live library values the app lacks', () => {
    expect(volumeMuscle('shoulders')).toBe('front_delts');
    expect(volumeMuscle('abs')).toBe('core');
    expect(volumeMuscle('brachialis')).toBe('biceps');
    expect(volumeMuscle('legs')).toBe('quads');
    expect(volumeMuscle('Hip Flexors')).toBe('hip_flexors');
    expect(volumeMuscle('')).toBeNull();
    expect(volumeMuscle(null)).toBeNull();
  });

  it('names a muscle the app does not know without crashing', () => {
    expect(muscleLabel('front_delts')).toBe('Front delts');
    expect(muscleLabel('hip_flexors')).toBe('Hip flexors');
    expect(muscleLabel('forearms')).toBe('Forearms');
    expect(muscleLabel('')).toBe('Other');
  });
});

describe('bands', () => {
  it('are low under 4, solid to 10 and high above, with no ceiling', () => {
    expect(volumeBand(0)).toBe('low');
    expect(volumeBand(3.5)).toBe('low');
    expect(volumeBand(4)).toBe('solid');
    expect(volumeBand(10)).toBe('solid');
    expect(volumeBand(10.5)).toBe('high');
    expect(volumeBand(40)).toBe('high');
  });

  it('formats counts to the nearest half set', () => {
    expect(formatSetCount(3)).toBe('3');
    expect(formatSetCount(8.5)).toBe('8.5');
    expect(formatSetCount(3.875)).toBe('4');
    expect(formatSetCount(3.3)).toBe('3.5');
  });
});

describe("the program's week", () => {
  it('counts 1 for the main muscle and 0.5 for the second, and presses as front delts', () => {
    const sets = programVolume({ days: [day('a', [exercise(BENCH, 3), exercise(PRESS, 3)]), day('b', [exercise(BENCH, 2)])] });
    expect(sets.get('chest')).toBe(5);
    expect(sets.get('triceps')).toBe(4);
    expect(sets.get('front_delts')).toBe(3);
    expect(sets.has('shoulders')).toBe(false);
  });

  it('counts a movement with a set range at its target', () => {
    const ranged = exercise(BENCH, 3, { notes: serializeSetRangeNotes('Pause at the chest', 2, 3, 5) });
    expect(programVolume({ days: [day('a', [ranged])] }).get('chest')).toBe(3);
  });

  it('counts each member of a superset by its own sets', () => {
    const sets = programVolume({ days: [day('a', [
      exercise(BENCH, 3, { superset_group_id: 'g' }),
      exercise(ROW, 3, { superset_group_id: 'g' }),
    ])] });
    expect(sets.get('chest')).toBe(3);
    expect(sets.get('back')).toBe(3);
  });

  it('counts one press filed under shoulders with front delts second once', () => {
    expect(programVolume({ days: [day('a', [exercise(move('shoulders', 'front_delts'), 3)])] }).get('front_delts')).toBe(3);
  });

  it('counts a muscle it does not know, and never calls it low', () => {
    const rows = volumeRows(programVolume({ days: [day('a', [exercise(move('forearms'), 2), exercise(move('chest', 'mystery_muscle'), 4)])] }));
    const forearms = rows.find((row) => row.muscle === 'forearms');
    expect(forearms).toMatchObject({ label: 'Forearms', sets: 2, band: 'low', main: false });
    expect(rows.find((row) => row.muscle === 'mystery_muscle')).toMatchObject({ sets: 2, main: false });
  });

  it('lists every main muscle, at 0 when the program never trains it', () => {
    const rows = volumeRows(programVolume({ days: [] }));
    expect(rows.map((row) => row.muscle)).toEqual([...MAIN_MUSCLES]);
    expect(rows.every((row) => row.sets === 0 && row.band === 'low')).toBe(true);
  });

  it('skips a movement whose exercise is missing', () => {
    const missing = { ...exercise(BENCH, 3), exercise: null as unknown as SplitExercise['exercise'] };
    expect(programVolume({ days: [day('a', [missing])] }).size).toBe(0);
  });
});

// Session dates shaped like a real account's (sets made up): training weeks
// of different sizes with a week off in between.
const HISTORY: VolumeSession[] = [
  session('2026-09-08', [BENCH]), // outside the 8-week look-back from Nov 11
  session('2026-10-09', [BENCH, ROW]),
  session('2026-10-11', [SQUAT]),
  session('2026-10-12', [BENCH]),
  session('2026-10-14', [ROW]),
  { ...session('2026-10-16', [SQUAT]), sets: [{ completed: false, exercise: SQUAT }] }, // opened, nothing logged
  session('2026-10-16', [SQUAT]),
  session('2026-10-26', [BENCH]),
  session('2026-10-27', [ROW]),
  session('2026-10-28', [SQUAT]),
  session('2026-10-30', [BENCH]),
  session('2026-10-31', [ROW]),
  session('2026-11-02', [BENCH]),
  session('2026-11-03', [ROW]),
  session('2026-11-04', [SQUAT]),
  session('2026-11-10', [SQUAT]), // this week: not part of the usual week
];

describe('the usual week', () => {
  it('averages the last 4 training weeks before this one, skipping empty sessions and weeks', () => {
    const usual = usualWeek(HISTORY, '2026-11-11');
    expect(usual?.weekStarts).toEqual(['2026-11-02', '2026-10-26', '2026-10-12', '2026-10-05']);
    // Chest: 3 sets in each of 5 sessions, over 4 weeks.
    expect(usual?.sets.get('chest')).toBe(15 / 4);
  });

  it('is not there yet with fewer than 2 training weeks in the last 8', () => {
    expect(usualWeek([session('2026-11-03', [BENCH]), session('2026-11-04', [ROW])], '2026-11-11')).toBeNull();
    expect(usualWeek([session('2026-09-01', [BENCH]), session('2026-11-03', [ROW])], '2026-11-11')).toBeNull();
    expect(usualWeek([], '2026-11-11')).toBeNull();
  });

  it('leaves out an unfinished workout', () => {
    const unfinished = { ...session('2026-11-03', [BENCH]), completed: false };
    expect(usualWeek([unfinished, session('2026-10-27', [ROW])], '2026-11-11')).toBeNull();
  });

  it('weeks run Monday to Sunday', () => {
    const usual = usualWeek([session('2026-11-01', [BENCH]), session('2026-11-02', [BENCH])], '2026-11-09');
    expect(usual?.weekStarts).toEqual(['2026-11-02', '2026-10-26']);
  });

  it('carries no band and no session count', () => {
    expect(Object.keys(usualWeek(HISTORY, '2026-11-11') ?? {}).sort()).toEqual(['sets', 'weekStarts']);
  });
});

const A = day('A', [exercise(BENCH, 3)]);
const B = day('B', [exercise(ROW, 3)]);
const C = day('C', [exercise(SQUAT, 4)]);
const D = day('D', [exercise(RAISE, 3)]);

const scheduleWorkout = (date: string, split_day_id: string): ScheduleWorkout => ({
  id: `${date}-${split_day_id}`, date, split_day_id, completed: true, created_at: `${date}T18:00:00Z`,
});

describe('this week, done of planned', () => {
  const fixed: PlanSchedule = { splitId: 'split', startDate: '2026-11-02', mode: 'fixed', weekdays: [1, 3, 5] };

  it('takes a fixed schedule day by day', () => {
    const days = plannedWeekDays({
      splitDays: [A, B, C], daysPerWeek: 3, schedule: fixed, scheduleWorkouts: [], adaptiveSchedulingEnabled: true,
      dayKey: '2026-11-11', sessions: [],
    });
    expect(days.map((entry) => entry.id)).toEqual(['A', 'B', 'C']);
  });

  it('counts every finished set as done, off-plan movements included, and done may pass planned', () => {
    const progress = weekProgress({
      workoutMode: 'split', splitDays: [A, B, C], daysPerWeek: 3, schedule: fixed, scheduleWorkouts: [],
      adaptiveSchedulingEnabled: true, dayKey: '2026-11-11',
      sessions: [session('2026-11-09', [BENCH, RAISE], 5, 'A'), session('2026-11-08', [ROW])],
    });
    expect(progress.weekStart).toBe('2026-11-09');
    expect(progress.sessionsDone).toBe(1);
    expect(progress.planned?.get('chest')).toBe(3);
    expect(progress.done.get('chest')).toBe(5);
    expect(progress.done.get('side_delts')).toBe(5);
    expect(progress.done.has('back')).toBe(false);
  });

  it('takes a rotation as the days done this week, then the next ones in turn', () => {
    const flex: PlanSchedule = { splitId: 'split', startDate: '2026-11-02', mode: 'flex', weekdays: [], flexAnchorIndex: 0 };
    const days = plannedWeekDays({
      splitDays: [A, B, C, D], daysPerWeek: 3, schedule: flex,
      scheduleWorkouts: [scheduleWorkout('2026-11-06', 'A'), scheduleWorkout('2026-11-10', 'B')],
      adaptiveSchedulingEnabled: true, dayKey: '2026-11-11',
      sessions: [session('2026-11-10', [ROW], 3, 'B')],
    });
    expect(days.map((entry) => entry.id)).toEqual(['B', 'C', 'D']);
  });

  it('starts a rotation with nothing done this week at the schedule’s next day', () => {
    const flex: PlanSchedule = { splitId: 'split', startDate: '2026-11-02', mode: 'flex', weekdays: [], flexAnchorIndex: 0 };
    const days = plannedWeekDays({
      splitDays: [A, B, C, D], daysPerWeek: 2, schedule: flex,
      scheduleWorkouts: [scheduleWorkout('2026-11-06', 'C')],
      adaptiveSchedulingEnabled: true, dayKey: '2026-11-10', sessions: [],
    });
    expect(days.map((entry) => entry.id)).toEqual(['D', 'A']);
  });

  it('with no schedule, rotates from the first day', () => {
    const days = plannedWeekDays({
      splitDays: [A, B, C], daysPerWeek: 3, schedule: null, scheduleWorkouts: [],
      adaptiveSchedulingEnabled: true, dayKey: '2026-11-10', sessions: [],
    });
    expect(days.map((entry) => entry.id)).toEqual(['A', 'B', 'C']);
  });

  it('a one-day program repeats its day', () => {
    const days = plannedWeekDays({
      splitDays: [A], daysPerWeek: 2, schedule: null, scheduleWorkouts: [],
      adaptiveSchedulingEnabled: true, dayKey: '2026-11-10', sessions: [],
    });
    expect(days.map((entry) => entry.id)).toEqual(['A', 'A']);
  });

  it('has no plan in flexible mode or without a program, only what was done', () => {
    for (const input of [
      { workoutMode: 'flexible' as const, splitDays: [A, B] },
      { workoutMode: 'split' as const, splitDays: [] },
    ]) {
      const progress = weekProgress({
        ...input, daysPerWeek: 2, schedule: null, scheduleWorkouts: [], adaptiveSchedulingEnabled: true,
        dayKey: '2026-11-11', sessions: [session('2026-11-10', [BENCH])],
      });
      expect(progress.planned).toBeNull();
      expect(progress.plannedDays).toEqual([]);
      expect(progress.done.get('chest')).toBe(3);
    }
  });

  it('a zero-set week is empty, not an error', () => {
    const progress = weekProgress({
      workoutMode: 'split', splitDays: [A], daysPerWeek: 1, schedule: null, scheduleWorkouts: [],
      adaptiveSchedulingEnabled: true, dayKey: '2026-11-11', sessions: [],
    });
    expect(progress.sessionsDone).toBe(0);
    expect(progress.done.size).toBe(0);
    expect(progress.planned?.get('chest')).toBe(3);
  });
});

describe('dates in any time zone', () => {
  const saved = process.env.TZ;
  afterEach(() => {
    if (saved === undefined) delete process.env.TZ;
    else process.env.TZ = saved;
  });

  for (const zone of ['Asia/Tokyo', 'America/Los_Angeles']) {
    it(`groups weeks by the account's local days in ${zone}`, () => {
      process.env.TZ = zone;
      const usual = usualWeek(HISTORY, '2026-11-11');
      expect(usual?.weekStarts).toEqual(['2026-11-02', '2026-10-26', '2026-10-12', '2026-10-05']);

      // Sunday night and Monday morning fall in different weeks.
      const edge = weekProgress({
        workoutMode: 'flexible', splitDays: [], daysPerWeek: null, schedule: null, scheduleWorkouts: [],
        adaptiveSchedulingEnabled: true, dayKey: '2026-11-09',
        sessions: [session('2026-11-08', [BENCH]), session('2026-11-09', [ROW])],
      });
      expect(edge.weekStart).toBe('2026-11-09');
      expect(edge.sessionsDone).toBe(1);
      expect(edge.done.has('chest')).toBe(false);

      const fixed: PlanSchedule = { splitId: 'split', startDate: '2026-11-02', mode: 'fixed', weekdays: [1, 3, 5] };
      const days = plannedWeekDays({
        splitDays: [A, B, C], daysPerWeek: 3, schedule: fixed, scheduleWorkouts: [], adaptiveSchedulingEnabled: true,
        dayKey: '2026-11-15', sessions: [],
      });
      expect(days.map((entry) => entry.id)).toEqual(['A', 'B', 'C']);
    });
  }
});
