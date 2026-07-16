// DEV-ONLY preview sample data. Pure data (no store imports) so it can be shared
// by the mock Supabase client and the store seeder without import cycles.
import { format } from 'date-fns';
import type {
  Exercise,
  Split,
  SplitDay,
  SplitExercise,
  Workout,
  WorkoutSet,
  MacroTarget,
  VolumeLandmark,
  MuscleVolume,
  Food,
  ActivitySession,
  ActivitySegment,
} from '@/types';

export const PREVIEW_USER_ID = 'preview-user';

const now = new Date();
const iso = (d: Date) => d.toISOString();
const ymd = (d: Date) => format(d, 'yyyy-MM-dd');
const daysAgo = (n: number) => {
  const d = new Date(now);
  d.setDate(d.getDate() - n);
  return d;
};
const at = (d: Date, h: number, m: number) => {
  const x = new Date(d);
  x.setHours(h, m, 0, 0);
  return x;
};
export const PREVIEW_TODAY = ymd(now);

/* ── Exercises ── */
const ex = (id: string, name: string, mg: Exercise['muscle_group'], sec: Exercise['muscle_group_secondary'], equip: string, compound: boolean): Exercise =>
  ({ id, name, muscle_group: mg, muscle_group_secondary: sec, equipment: equip, is_compound: compound });

const exBench = ex('ex_bench', 'Barbell Bench Press', 'chest', 'front_delts', 'Barbell', true);
const exIncline = ex('ex_incline', 'Incline Dumbbell Press', 'chest', 'front_delts', 'Dumbbell', true);
const exRow = ex('ex_row', 'Barbell Row', 'back', 'biceps', 'Barbell', true);
const exPulldown = ex('ex_pulldown', 'Lat Pulldown', 'back', 'biceps', 'Cable', true);
const exSquat = ex('ex_squat', 'Back Squat', 'quads', 'glutes', 'Barbell', true);
const exRdl = ex('ex_rdl', 'Romanian Deadlift', 'hamstrings', 'glutes', 'Barbell', true);
const exOhp = ex('ex_ohp', 'Overhead Press', 'shoulders', 'triceps', 'Barbell', true);
const exCurl = ex('ex_curl', 'Dumbbell Curl', 'biceps', null, 'Dumbbell', false);
const exPushdown = ex('ex_pushdown', 'Triceps Pushdown', 'triceps', null, 'Cable', false);
const exLateral = ex('ex_lateral', 'Lateral Raise', 'side_delts', null, 'Dumbbell', false);
const exLegcurl = ex('ex_legcurl', 'Seated Leg Curl', 'hamstrings', null, 'Machine', false);
const exLegext = ex('ex_legext', 'Leg Extension', 'quads', null, 'Machine', false);
const exCalf = ex('ex_calf', 'Standing Calf Raise', 'calves', null, 'Machine', false);

export const previewExercises: Exercise[] = [
  exBench, exIncline, exRow, exPulldown, exSquat, exRdl, exOhp, exCurl, exPushdown, exLateral, exLegcurl, exLegext, exCalf,
];

/* ── Split (active program) ── */
let seq = 0;
const se = (dayId: string, e: Exercise, sets: number, rmin: number, rmax: number, order: number): SplitExercise =>
  ({ id: `se${++seq}`, split_day_id: dayId, exercise_id: e.id, exercise: e, target_sets: sets, target_reps_min: rmin, target_reps_max: rmax, exercise_order: order, notes: null });

const dayUA: SplitDay = { id: 'd1', split_id: 'split1', day_name: 'Upper A', day_order: 0, exercises: [se('d1', exBench, 4, 6, 8, 0), se('d1', exRow, 4, 8, 10, 1), se('d1', exIncline, 3, 8, 12, 2), se('d1', exPulldown, 3, 10, 12, 3), se('d1', exLateral, 3, 12, 15, 4)] };
const dayLA: SplitDay = { id: 'd2', split_id: 'split1', day_name: 'Lower A', day_order: 1, exercises: [se('d2', exSquat, 4, 5, 8, 0), se('d2', exRdl, 3, 8, 10, 1), se('d2', exLegext, 3, 12, 15, 2), se('d2', exCalf, 4, 10, 15, 3)] };
const dayUB: SplitDay = { id: 'd3', split_id: 'split1', day_name: 'Upper B', day_order: 2, exercises: [se('d3', exOhp, 4, 6, 8, 0), se('d3', exPulldown, 4, 10, 12, 1), se('d3', exIncline, 3, 8, 12, 2), se('d3', exCurl, 3, 10, 12, 3), se('d3', exPushdown, 3, 10, 12, 4)] };
const dayLB: SplitDay = { id: 'd4', split_id: 'split1', day_name: 'Lower B', day_order: 3, exercises: [se('d4', exRdl, 4, 6, 8, 0), se('d4', exSquat, 3, 8, 10, 1), se('d4', exLegcurl, 3, 12, 15, 2), se('d4', exCalf, 4, 10, 15, 3)] };

export const previewSplit: Split = {
  id: 'split1', user_id: PREVIEW_USER_ID, name: 'Upper / Lower', description: 'A 4-day upper/lower hypertrophy block.', days_per_week: 4, is_active: true, days: [dayUA, dayLA, dayUB, dayLB],
};

/* ── Current (in-progress) workout — drives the "resume" hero + in-session view ── */
let wsId = 0;
const ws = (e: Exercise, n: number, weight: number | null, reps: number | null, rpe: number | null, completed: boolean, completedAt: Date | null): WorkoutSet =>
  ({ id: `cs${++wsId}`, workout_id: 'w_current', exercise_id: e.id, exercise: e, set_number: n, weight, reps, rpe, completed, completed_at: completedAt ? iso(completedAt) : null });

export const previewCurrentWorkout: Workout = {
  id: 'w_current', user_id: PREVIEW_USER_ID, split_day_id: 'd1', date: PREVIEW_TODAY, notes: null, completed: false,
  created_at: iso(at(now, 18, 5)),
  sets: [
    ws(exBench, 1, 100, 8, 8, true, at(now, 18, 9)),
    ws(exBench, 2, 100, 8, 8.5, true, at(now, 18, 13)),
    ws(exBench, 3, 102.5, 6, 9, true, at(now, 18, 18)),
    ws(exRow, 1, 80, 10, 7, false, null),
    ws(exRow, 2, 80, 10, 7, false, null),
    ws(exRow, 3, 80, 9, 8, false, null),
    ws(exIncline, 1, 30, 12, 7, false, null),
    ws(exIncline, 2, 30, 11, 8, false, null),
    ws(exIncline, 3, 30, 10, 8.5, false, null),
  ],
};

/* ── Macros ── */
export const previewMacroTarget: MacroTarget = { id: 'mt1', user_id: PREVIEW_USER_ID, calories: 2600, protein: 190, carbs: 280, fat: 80 };

/* ── Volume landmarks + this-week volume ── */
type LMSeed = [VolumeLandmark['muscle_group'], number, number, number, number, number, number, MuscleVolume['status']];
const lmSeeds: LMSeed[] = [
  // muscle, mv, mev, mav_low, mav_high, mrv, weekly_sets, status
  ['chest', 6, 10, 12, 18, 22, 15, 'mav'],
  ['back', 8, 12, 14, 20, 25, 18, 'mav'],
  ['quads', 6, 8, 10, 16, 20, 9, 'mev_mav'],
  ['hamstrings', 4, 6, 8, 12, 16, 5, 'below_mev'],
  ['side_delts', 6, 10, 12, 18, 22, 21, 'above_mrv'],
  ['biceps', 6, 8, 10, 16, 20, 12, 'mav'],
  ['triceps', 6, 8, 10, 16, 20, 10, 'mav'],
  ['glutes', 4, 6, 8, 14, 18, 11, 'mav'],
];
export const previewLandmarks: VolumeLandmark[] = lmSeeds.map(([mg, mv, mev, mavLow, mavHigh, mrv], i) =>
  ({ id: `lm${i}`, user_id: PREVIEW_USER_ID, muscle_group: mg, mv, mev, mav_low: mavLow, mav_high: mavHigh, mrv }));
export const previewWeeklyVolume: MuscleVolume[] = lmSeeds.map(([mg, , , , , , weekly, status], i) =>
  ({ muscle_group: mg, weekly_sets: weekly, status, landmark: previewLandmarks[i] }));

/* ── Foods + today's nutrition log ── */
const food = (id: string, name: string, cal: number, p: number, c: number, f: number, size: number, unit: string, source: Food['source'] = 'usda'): Food =>
  ({ id, name, calories: cal, protein: p, carbs: c, fat: f, serving_size: size, serving_unit: unit, source, fdc_id: source === 'usda' ? `fdc-${id}` : null, user_id: source === 'custom' ? PREVIEW_USER_ID : null });

export const previewFoods: Food[] = [
  food('f_oats', 'Rolled Oats', 150, 5, 27, 3, 40, 'g'),
  food('f_eggs', 'Whole Eggs', 156, 13, 1, 11, 2, 'large'),
  food('f_chicken', 'Chicken Breast, grilled', 248, 47, 0, 5, 150, 'g'),
  food('f_rice', 'White Rice, cooked', 260, 5, 57, 1, 200, 'g'),
  food('f_yogurt', 'Greek Yogurt, nonfat', 100, 17, 6, 1, 170, 'g'),
  food('f_banana', 'Banana', 105, 1, 27, 0, 1, 'medium'),
  food('f_whey', 'Whey Protein', 120, 24, 3, 2, 1, 'scoop'),
  food('f_almond', 'Almonds', 164, 6, 6, 14, 28, 'g'),
  food('f_salmon', 'Salmon Fillet', 280, 39, 0, 13, 170, 'g', 'custom'),
];

type LogSeed = [string, number, NonNullable<import('@/types').NutritionLog['meal_type']>, number, number];
const logSeeds: LogSeed[] = [
  // food_id, servings, meal, hour, min
  ['f_oats', 1.5, 'breakfast', 7, 30],
  ['f_eggs', 1.5, 'breakfast', 7, 35],
  ['f_yogurt', 1, 'breakfast', 7, 40],
  ['f_chicken', 1.2, 'lunch', 12, 45],
  ['f_rice', 1, 'lunch', 12, 50],
  ['f_banana', 1, 'snack', 15, 10],
  ['f_whey', 1, 'snack', 15, 12],
];
export const previewNutritionLogs = logSeeds.map(([foodId, servings, meal, h, m], i) => ({
  id: `nl${i}`, user_id: PREVIEW_USER_ID, date: PREVIEW_TODAY, food_id: foodId, servings, meal_type: meal,
  created_at: iso(at(now, h, m)), logged_at: iso(at(now, h, m)),
}));

/* ── History: completed workouts + their sets over the last fortnight ── */
const historyPlan: { offset: number; dayId: string; ex: Exercise[] }[] = [
  { offset: 2, dayId: 'd2', ex: [exSquat, exRdl, exLegext, exCalf] },
  { offset: 4, dayId: 'd3', ex: [exOhp, exPulldown, exIncline, exCurl] },
  { offset: 6, dayId: 'd1', ex: [exBench, exRow, exIncline, exLateral] },
  { offset: 9, dayId: 'd4', ex: [exRdl, exSquat, exLegcurl, exCalf] },
  { offset: 11, dayId: 'd2', ex: [exSquat, exRdl, exLegext, exCalf] },
  { offset: 13, dayId: 'd1', ex: [exBench, exRow, exPulldown, exLateral] },
];

const histWorkoutRows: Record<string, unknown>[] = [];
const histSetRows: Record<string, unknown>[] = [];
let hsId = 0;
export const previewHistoryWorkouts: Workout[] = historyPlan.map((p, wi) => {
  const d = daysAgo(p.offset);
  const start = at(d, 18, 0);
  const id = `wh${wi}`;
  const sets: WorkoutSet[] = [];
  let order = 0;
  p.ex.forEach((e) => {
    for (let n = 1; n <= 3; n++) {
      const done = at(d, 18, 5 + order * 4);
      const w = 60 + ((wi + order) % 5) * 10;
      const set: WorkoutSet = { id: `wsh${++hsId}`, workout_id: id, exercise_id: e.id, exercise: e, set_number: n, weight: w, reps: 8 + (n % 3), rpe: 8, completed: true, completed_at: iso(done) };
      sets.push(set);
      histSetRows.push({ id: set.id, workout_id: id, exercise_id: e.id, set_number: n, weight: w, reps: set.reps, rpe: 8, completed: true, completed_at: set.completed_at, created_at: iso(start) });
      order++;
    }
  });
  const completedAt = at(d, 19, 5);
  histWorkoutRows.push({ id, user_id: PREVIEW_USER_ID, split_day_id: p.dayId, date: ymd(d), notes: null, completed: true, completed_at: iso(completedAt), created_at: iso(start) });
  return { id, user_id: PREVIEW_USER_ID, split_day_id: p.dayId, date: ymd(d), notes: null, completed: true, completed_at: iso(completedAt), created_at: iso(start), sets };
});

// blank metric/bookkeeping fields for plain manual entries
const manualActivityDefaults = {
  strain: null,
  avg_hr: null,
  max_hr: null,
  energy_kcal: null,
  distance_m: null,
  auto_grouped: false,
  user_edited: false,
  dismissed_at: null,
};

/* ── Seeded whoop-style interval run: 8 hard laps recorded as separate WHOOP
      workouts, grouped into one interval_run session with per-lap segments ── */
const intervalLapActiveS = 130;
const intervalLapGapS = 90;
const intervalStart = at(daysAgo(4), 7, 20);
const intervalLapAvgHrs = [168, 171, 173, 175, 176, 178, 180, 181];
const intervalLapMaxHrs = [178, 182, 184, 186, 187, 189, 191, 191];

export const previewActivitySegments: ActivitySegment[] = intervalLapAvgHrs.map((avgHr, i) => {
  const start = new Date(intervalStart.getTime() + i * (intervalLapActiveS + intervalLapGapS) * 1000);
  const end = new Date(start.getTime() + intervalLapActiveS * 1000);
  return {
    id: `seg_intervals_${i + 1}`,
    user_id: PREVIEW_USER_ID,
    session_id: 'act_intervals',
    source: 'whoop' as const,
    external_id: `whoop-lap-${i + 1}`,
    sport: 'running',
    started_at: iso(start),
    ended_at: iso(end),
    duration_seconds: intervalLapActiveS,
    strain: Math.round((5.4 + i * 0.4) * 10) / 10,
    avg_hr: avgHr,
    max_hr: intervalLapMaxHrs[i],
    energy_kcal: 31,
    distance_m: 495 + i * 2,
    raw: null,
    created_at: iso(at(daysAgo(4), 8, 6)),
    updated_at: iso(at(daysAgo(4), 8, 6)),
  };
});

const intervalSessionEnd = new Date(
  intervalStart.getTime() + (7 * (intervalLapActiveS + intervalLapGapS) + intervalLapActiveS) * 1000
);

export const previewActivitySessions: ActivitySession[] = [
  {
    id: 'act_today_bike',
    user_id: PREVIEW_USER_ID,
    activity_type: 'bike_ride',
    title: 'Easy lake loop',
    date: PREVIEW_TODAY,
    started_at: iso(at(now, 8, 10)),
    ended_at: iso(at(now, 9, 2)),
    duration_seconds: 52 * 60,
    source: 'manual',
    notes: 'Kept it aerobic.',
    ...manualActivityDefaults,
    created_at: iso(at(now, 9, 5)),
    updated_at: iso(at(now, 9, 5)),
  },
  {
    id: 'act_lower_climb',
    user_id: PREVIEW_USER_ID,
    activity_type: 'climbing',
    title: null,
    date: ymd(daysAgo(2)),
    started_at: iso(at(daysAgo(2), 11, 0)),
    ended_at: iso(at(daysAgo(2), 12, 15)),
    duration_seconds: 75 * 60,
    source: 'manual',
    notes: 'Bouldering volume after lower day.',
    ...manualActivityDefaults,
    created_at: iso(at(daysAgo(2), 12, 18)),
    updated_at: iso(at(daysAgo(2), 12, 18)),
  },
  {
    // grouped from the 8 whoop lap segments above; duration is ACTIVE lap time
    id: 'act_intervals',
    user_id: PREVIEW_USER_ID,
    activity_type: 'interval_run',
    title: '8x fast lap',
    date: ymd(daysAgo(4)),
    started_at: iso(intervalStart),
    ended_at: iso(intervalSessionEnd),
    duration_seconds: 8 * intervalLapActiveS,
    source: 'whoop',
    notes: 'One hard lap, one float lap.',
    strain: 8.2,
    avg_hr: 175,
    max_hr: 191,
    energy_kcal: 248,
    distance_m: 4016,
    auto_grouped: true,
    user_edited: false,
    dismissed_at: null,
    created_at: iso(at(daysAgo(4), 8, 6)),
    updated_at: iso(at(daysAgo(4), 8, 6)),
  },
  {
    id: 'act_tennis',
    user_id: PREVIEW_USER_ID,
    activity_type: 'tennis',
    title: null,
    date: ymd(daysAgo(6)),
    started_at: iso(at(daysAgo(6), 17, 30)),
    ended_at: iso(at(daysAgo(6), 18, 45)),
    duration_seconds: 75 * 60,
    source: 'manual',
    notes: null,
    ...manualActivityDefaults,
    created_at: iso(at(daysAgo(6), 18, 50)),
    updated_at: iso(at(daysAgo(6), 18, 50)),
  },
];

/* ── Flat table rows for the mock Supabase client ── */
const stamp = (rows: Record<string, unknown>[]) => rows.map((r) => ({ created_at: iso(daysAgo(40)), ...r }));

const currentWorkoutSetRows = previewCurrentWorkout.sets.map((s) => ({
  id: s.id, workout_id: s.workout_id, exercise_id: s.exercise_id, set_number: s.set_number, weight: s.weight, reps: s.reps, rpe: s.rpe, completed: s.completed, completed_at: s.completed_at, created_at: previewCurrentWorkout.created_at,
}));

export const previewTables: Record<string, Record<string, unknown>[]> = {
  profiles: [{ id: PREVIEW_USER_ID, display_name: 'Sam Rivera', created_at: iso(daysAgo(120)) }],
  exercises: stamp(previewExercises.map((e) => ({ ...e }))),
  splits: [{ id: 'split1', user_id: PREVIEW_USER_ID, name: previewSplit.name, description: previewSplit.description, days_per_week: 4, is_active: true, created_at: iso(daysAgo(40)) }],
  split_days: previewSplit.days.map((d) => ({ id: d.id, split_id: 'split1', day_name: d.day_name, day_order: d.day_order, created_at: iso(daysAgo(40)) })),
  split_exercises: stamp(previewSplit.days.flatMap((d) => d.exercises.map((x) => ({ id: x.id, split_day_id: d.id, exercise_id: x.exercise_id, target_sets: x.target_sets, target_reps_min: x.target_reps_min, target_reps_max: x.target_reps_max, exercise_order: x.exercise_order, notes: x.notes })))),
  macro_targets: [{ ...previewMacroTarget, created_at: iso(daysAgo(40)) }],
  volume_landmarks: previewLandmarks.map((l) => ({ ...l, created_at: iso(daysAgo(40)) })),
  foods: stamp(previewFoods.map((f) => ({ ...f }))),
  nutrition_logs: previewNutritionLogs.map((l) => ({ ...l })),
  workouts: [
    { id: 'w_current', user_id: PREVIEW_USER_ID, split_day_id: 'd1', date: PREVIEW_TODAY, notes: null, completed: false, completed_at: null, created_at: previewCurrentWorkout.created_at },
    ...histWorkoutRows,
  ],
  sets: [...currentWorkoutSetRows, ...histSetRows],
  workout_day_plans: [],
  flex_day_templates: [],
  program_preferences: [],
  plan_schedules: [],
  activity_sessions: previewActivitySessions.map((activity) => ({ ...activity })),
  activity_segments: previewActivitySegments.map((segment) => ({ ...segment })),
  // start disconnected; the Settings "Connect" flows insert mock rows
  whoop_connections: [],
  strava_connections: [],
};
