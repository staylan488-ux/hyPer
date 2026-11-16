// Replays the set-target rule over a training history: for each past session
// of each movement, the targets the app would have shown (worked out only from
// the sessions before it, through the same history read the app uses), set
// beside what was logged. Test-only; the real history stays out of the repo.
import { buildMovementHistory } from '@/lib/previousSetTargets';
import {
  DEFAULT_TARGET_OPTIONS,
  liveSetTarget,
  planMovementTargets,
  setReachesTarget,
  targetOutcome,
  type LoggedSet,
  type RepRange,
  type SetTarget,
  type TargetOptions,
} from '@/lib/setTargets';

export type ReplayWorkout = { id: string; date: string; created_at?: string | null; split_day_id?: string | null };
export type ReplaySet = {
  workout_id: string;
  exercise_id: string;
  set_number: number;
  weight: number | null;
  reps: number | null;
  rpe?: number | null;
  completed: boolean;
};
export type ReplayExercise = { id: string; name: string; equipment: string | null };
export type ReplayPlanItem = { split_day_id?: string | null; exercise_id: string; target_reps_min: number | null; target_reps_max: number | null; is_active?: boolean };

export type ReplayInput = {
  workouts: ReplayWorkout[];
  sets: ReplaySet[];
  exercises: ReplayExercise[];
  program: ReplayPlanItem[];
};

export type ReplayRow = {
  date: string;
  exercise: string;
  position: number;
  target: SetTarget;
  done: { weight: number; reps: number };
  last: { weight: number; reps: number } | null;
  range: RepRange | null;
  outcome: 'hit' | 'beat' | 'missed';
};

export type ReplayReport = {
  options: Partial<TargetOptions>;
  movementSessions: number;
  sessionsWithTargets: number;
  /** Movement sessions where every target was reached. */
  sessionsAllHit: number;
  targets: number;
  hit: number;
  beat: number;
  missed: number;
  /** Below last time's same set with no dip behind it (a repeat, match or in-session move). */
  belowLastWithoutDip: ReplayRow[];
  /** Reps outside the rep range, by why. */
  outsideRange: Record<string, number>;
  /** Set 1 only: the target before anything is logged that day. */
  firstSets: number;
  firstReached: number;
  /** A weight the rule chose (not the person's own that day) never logged on the movement before that session, and never at all. */
  unseenBefore: ReplayRow[];
  unseenEver: ReplayRow[];
  byWhy: Record<string, { targets: number; reached: number }>;
  rows: ReplayRow[];
};

const round2 = (value: number) => Math.round(value * 100) / 100;

function rangeFinder(input: ReplayInput) {
  const byDay = new Map<string, RepRange>();
  const byExercise = new Map<string, RepRange>();
  const ordered = [...input.program].sort((a, b) => Number(Boolean(b.is_active)) - Number(Boolean(a.is_active)));
  for (const item of ordered) {
    if (typeof item.target_reps_min !== 'number' || typeof item.target_reps_max !== 'number') continue;
    const range = { min: item.target_reps_min, max: item.target_reps_max };
    if (item.split_day_id) byDay.set(`${item.split_day_id}:${item.exercise_id}`, range);
    if (!byExercise.has(item.exercise_id)) byExercise.set(item.exercise_id, range);
  }
  return (workout: ReplayWorkout, exerciseId: string): RepRange | null =>
    (workout.split_day_id ? byDay.get(`${workout.split_day_id}:${exerciseId}`) : undefined) ?? byExercise.get(exerciseId) ?? null;
}

export function replaySetTargets(input: ReplayInput, options: Partial<TargetOptions> = {}): ReplayReport {
  const workouts = [...input.workouts].sort((a, b) =>
    a.date.localeCompare(b.date) || String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')) || a.id.localeCompare(b.id));
  const exercises = new Map(input.exercises.map((exercise) => [exercise.id, exercise]));
  const setsByWorkout = new Map<string, ReplaySet[]>();
  for (const set of input.sets) {
    const list = setsByWorkout.get(set.workout_id) ?? [];
    list.push(set);
    setsByWorkout.set(set.workout_id, list);
  }
  const rangeFor = rangeFinder(input);
  const report: ReplayReport = {
    options,
    movementSessions: 0,
    sessionsWithTargets: 0,
    sessionsAllHit: 0,
    targets: 0,
    firstSets: 0,
    firstReached: 0,
    hit: 0,
    beat: 0,
    missed: 0,
    belowLastWithoutDip: [],
    outsideRange: {},
    unseenBefore: [],
    unseenEver: [],
    byWhy: {},
    rows: [],
  };
  const everWeights = new Map<string, Set<number>>();
  for (const set of input.sets) {
    if (!set.completed || typeof set.weight !== 'number') continue;
    const weights = everWeights.get(set.exercise_id) ?? new Set<number>();
    weights.add(round2(set.weight));
    everWeights.set(set.exercise_id, weights);
  }

  workouts.forEach((workout, index) => {
    const sets = setsByWorkout.get(workout.id) ?? [];
    const exerciseIds = [...new Set(sets.filter((set) => set.completed).map((set) => set.exercise_id))];
    if (exerciseIds.length === 0) return;
    // The app's read: the 30 workouts before this one, newest first.
    const earlier = workouts.slice(Math.max(0, index - 30), index).reverse();
    const earlierIds = new Set(earlier.map((candidate) => candidate.id));
    const earlierSets = input.sets.filter((set) => earlierIds.has(set.workout_id) && exerciseIds.includes(set.exercise_id));
    const history = buildMovementHistory(earlier, earlierSets);

    for (const exerciseId of exerciseIds) {
      report.movementSessions += 1;
      const movementSets = sets.filter((set) => set.exercise_id === exerciseId).sort((a, b) => a.set_number - b.set_number);
      const slots: LoggedSet[] = [];
      let previousNumber: number | undefined;
      for (const set of movementSets) {
        if (set.set_number === previousNumber) continue;
        previousNumber = set.set_number;
        slots.push(set.completed && typeof set.weight === 'number' && typeof set.reps === 'number' ? { weight: set.weight, reps: set.reps } : null);
      }
      const range = rangeFor(workout, exerciseId);
      const exercise = exercises.get(exerciseId);
      const past = history[exerciseId] ?? [];
      const targets = planMovementTargets({ history: past, today: workout.date, setCount: slots.length, range, equipment: exercise?.equipment ?? null, options });
      if (!targets) continue;
      const lastSession = past[0];
      const seenBefore = new Set<number>();
      for (const session of past) for (const set of session.sets) if (set && typeof set.weight === 'number') seenBefore.add(round2(set.weight));
      let any = false;
      let all = true;
      slots.forEach((done, position) => {
        if (!done) return;
        const target = liveSetTarget(targets, slots, position + 1, { ...DEFAULT_TARGET_OPTIONS, ...options });
        if (!target) return;
        any = true;
        const outcome = targetOutcome(done, target).kind;
        const lastSet = lastSession?.sets[position];
        const last = lastSet && typeof lastSet.weight === 'number' && typeof lastSet.reps === 'number' && lastSet.reps > 0 ? { weight: lastSet.weight, reps: lastSet.reps } : null;
        const row: ReplayRow = { date: workout.date, exercise: exercise?.name ?? exerciseId, position: position + 1, target, done, last, range, outcome };
        report.rows.push(row);
        report.targets += 1;
        report[outcome] += 1;
        if (outcome === 'missed') all = false;
        if (position === 0) {
          report.firstSets += 1;
          if (outcome !== 'missed') report.firstReached += 1;
        }
        const why = target.why.kind === 'match' ? `match:${target.why.cause}` : target.why.kind === 'moved' ? `moved:${target.why.cause}` : target.why.kind;
        const tally = (report.byWhy[why] ??= { targets: 0, reached: 0 });
        tally.targets += 1;
        if (outcome !== 'missed') tally.reached += 1;
        const dip = target.why.kind === 'repeat' || target.why.kind === 'match' || target.why.kind === 'moved';
        if (last && !dip) {
          const lighter = target.weight < last.weight - 0.01;
          const fewer = Math.abs(target.weight - last.weight) <= 0.01 && target.reps < last.reps;
          if (lighter || fewer) report.belowLastWithoutDip.push(row);
        }
        if (range && (target.reps < range.min || target.reps > range.max)) {
          report.outsideRange[why] = (report.outsideRange[why] ?? 0) + 1;
        }
        // A moved target sits on the weight the person chose that day.
        if (target.why.kind !== 'moved' && target.weight > 0 && !seenBefore.has(round2(target.weight))) {
          report.unseenBefore.push(row);
          if (!everWeights.get(exerciseId)?.has(round2(target.weight))) report.unseenEver.push(row);
        }
      });
      if (any) {
        report.sessionsWithTargets += 1;
        if (all) report.sessionsAllHit += 1;
      }
    }
  });
  return report;
}

const percent = (part: number, whole: number) => (whole === 0 ? '–' : `${Math.round((part / whole) * 100)}%`);

export function summarizeReplay(report: ReplayReport): string {
  const reached = report.hit + report.beat;
  const lines = [
    `options ${JSON.stringify(report.options)}`,
    `targets ${report.targets}: reached ${reached} (${percent(reached, report.targets)}; hit ${report.hit}, beat ${report.beat}), missed ${report.missed}`,
    `set 1 targets ${report.firstSets}: reached ${report.firstReached} (${percent(report.firstReached, report.firstSets)})`,
    `movement sessions ${report.movementSessions}, with targets ${report.sessionsWithTargets}, every target reached ${report.sessionsAllHit} (${percent(report.sessionsAllHit, report.sessionsWithTargets)})`,
    `below last time without a dip: ${report.belowLastWithoutDip.length}`,
    `outside the rep range: ${JSON.stringify(report.outsideRange)}`,
    `weight never logged before: ${report.unseenBefore.length} (never logged at all: ${report.unseenEver.length})`,
    `by why: ${Object.entries(report.byWhy).map(([why, tally]) => `${why} ${tally.reached}/${tally.targets}`).join(', ')}`,
  ];
  return lines.join('\n');
}

export function checkSetTargetReplay(report: ReplayReport): string[] {
  const problems: string[] = [];
  for (const row of report.rows) {
    if (!Number.isFinite(row.target.weight) || !Number.isFinite(row.target.reps) || row.target.reps < 1 || row.target.weight < 0) {
      problems.push(`${row.date} ${row.exercise} set ${row.position}: bad target ${row.target.weight} × ${row.target.reps}`);
    }
    if (!Number.isInteger(row.target.reps)) problems.push(`${row.date} ${row.exercise} set ${row.position}: fractional reps ${row.target.reps}`);
  }
  // A target the person reached by doing exactly it is a hit, never a miss.
  if (!setReachesTarget({ weight: 100, reps: 10 }, { weight: 100, reps: 10 })) problems.push('hit check broken');
  return problems;
}
