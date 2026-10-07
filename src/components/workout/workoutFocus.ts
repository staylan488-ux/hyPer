import type { WorkoutSet, Workout, SplitExercise, WorkoutDayPlan } from '@/types';
import { restingScrollEnd } from '@/lib/titleSnap';
import type { AutofillSetValues } from '@/lib/setAutofill';
import { formatWorkoutDuration } from '@/lib/workoutSessions';

export interface WorkoutExpansion {
  expandedExerciseId: string | null;
  /** Missing chooses the first unfinished set; null leaves every row closed. */
  selectedSets: Record<string, string | null>;
}

export const initialWorkoutExpansion: WorkoutExpansion = { expandedExerciseId: null, selectedSets: {} };

type ExpansionAction =
  | { type: 'toggle'; exerciseId: string }
  /** Opening the live workout: expand the next movement unless one is already open. */
  | { type: 'open-if-closed'; exerciseId: string }
  | { type: 'select'; exerciseId: string; setId: string }
  | { type: 'hide'; exerciseId: string }
  | { type: 'saved'; exerciseId: string; setId: string }
  | { type: 'replace'; exerciseId: string; replacementId: string }
  | { type: 'reset' };

/** Browsing is independent of progression and rest; late saves never move the user. */
export function workoutExpansionReducer(state: WorkoutExpansion, action: ExpansionAction): WorkoutExpansion {
  switch (action.type) {
    case 'reset': return initialWorkoutExpansion;
    case 'toggle': return { ...state, expandedExerciseId: state.expandedExerciseId === action.exerciseId ? null : action.exerciseId };
    case 'open-if-closed': return state.expandedExerciseId === null ? { ...state, expandedExerciseId: action.exerciseId } : state;
    case 'select': return { expandedExerciseId: action.exerciseId, selectedSets: { ...state.selectedSets, [action.exerciseId]: action.setId } };
    case 'hide': return { ...state, selectedSets: { ...state.selectedSets, [action.exerciseId]: null } };
    case 'replace': {
      const selectedSets = { ...state.selectedSets };
      delete selectedSets[action.exerciseId];
      delete selectedSets[action.replacementId];
      return { expandedExerciseId: state.expandedExerciseId === action.exerciseId ? action.replacementId : state.expandedExerciseId, selectedSets };
    }
    case 'saved': {
      const selected = state.selectedSets[action.exerciseId];
      if (selected !== undefined && selected !== action.setId) return state;
      return { ...state, selectedSets: { ...state.selectedSets, [action.exerciseId]: null } };
    }
  }
}

export function expandedWorkoutSet(sets: WorkoutSet[], state: WorkoutExpansion): WorkoutSet | undefined {
  const exerciseId = state.expandedExerciseId;
  if (!exerciseId) return undefined;
  const selectedId = state.selectedSets[exerciseId];
  if (selectedId === null) return undefined;
  return sets.find((set) => set.exercise_id === exerciseId && set.id === selectedId)
    ?? sets.find((set) => set.exercise_id === exerciseId && !set.completed);
}

/** Resolve the next real row, respecting paired A/B rounds and display order. */
export function nextWorkoutSet(
  sets: WorkoutSet[],
  exerciseOrder: string[],
  loggedSet?: WorkoutSet,
  partner?: { role: 'A' | 'B'; partnerExerciseId: string },
  pairings?: ReadonlyMap<string, { role: 'A' | 'B'; partnerExerciseId: string }>,
): WorkoutSet | undefined {
  const unfinished = sets.filter((set) => !set.completed && set.id !== loggedSet?.id).sort((a, b) => a.set_number - b.set_number);
  if (loggedSet && partner) {
    const paired = unfinished.find((set) =>
      set.exercise_id === partner.partnerExerciseId &&
      set.set_number === loggedSet.set_number + (partner.role === 'B' ? 1 : 0));
    if (paired) return paired;
  }
  if (loggedSet) {
    const sameMovement = unfinished.find((set) => set.exercise_id === loggedSet.exercise_id);
    if (sameMovement) return sameMovement;
  }
  const eligible = unfinished.filter((set) => {
    const flow = pairings?.get(set.exercise_id);
    if (!flow) return true;
    const precedingRound = flow.role === 'B' ? set.set_number : set.set_number - 1;
    return !unfinished.some((candidate) => candidate.exercise_id === flow.partnerExerciseId && candidate.set_number === precedingRound);
  });
  return [...eligible].sort((a, b) => {
    const rank = (id: string) => {
      const index = exerciseOrder.indexOf(id);
      return index < 0 ? Number.MAX_SAFE_INTEGER : index;
    };
    return rank(a.exercise_id) - rank(b.exercise_id) || a.set_number - b.set_number;
  })[0];
}

/**
 * The bottom primary action between sets: the session's next set and its
 * position within its movement. Nothing while a set entry is already open,
 * since the open entry's save key is then the primary action.
 */
export function nextSetAction(
  sets: WorkoutSet[],
  exerciseOrder: string[],
  pairings: ReadonlyMap<string, { role: 'A' | 'B'; partnerExerciseId: string }> | undefined,
  openSet: WorkoutSet | undefined,
): { set: WorkoutSet; position: number; total: number } | undefined {
  if (openSet) return undefined;
  const set = nextWorkoutSet(sets, exerciseOrder, undefined, undefined, pairings);
  if (!set) return undefined;
  const movementSets = sets.filter((candidate) => candidate.exercise_id === set.exercise_id)
    .sort((a, b) => a.set_number - b.set_number);
  return { set, position: movementSets.findIndex((candidate) => candidate.id === set.id) + 1, total: movementSets.length };
}

/** Dashboard resume cue uses the same round-aware selection as the training screen. */
export function getWorkoutResumeSet(
  workout: Pick<Workout, 'id' | 'split_day_id' | 'sets'>,
  splitDay?: { id: string; exercises: Array<Pick<SplitExercise, 'exercise_id' | 'exercise_order' | 'superset_group_id'>> } | null,
  dayPlan?: Pick<WorkoutDayPlan, 'workout_id' | 'items'> | null,
): WorkoutSet | undefined {
  // The session plan holds this workout's swaps and order, like the Train screen.
  const movements = dayPlan?.workout_id === workout.id
    ? dayPlan.items.filter((item) => !item.hidden).map((item) => ({ id: item.exercise_id, order: item.order, group: item.superset_group_id }))
    : splitDay?.id === workout.split_day_id
      ? splitDay.exercises.map((exercise) => ({ id: exercise.exercise_id, order: exercise.exercise_order, group: exercise.superset_group_id }))
      : [];
  movements.sort((a, b) => a.order - b.order);
  const groups = new Map<string, string[]>();
  for (const movement of movements) {
    if (movement.group) groups.set(movement.group, [...(groups.get(movement.group) ?? []), movement.id]);
  }
  const pairings = new Map<string, { role: 'A' | 'B'; partnerExerciseId: string }>();
  for (const members of groups.values()) {
    if (members.length !== 2) continue;
    pairings.set(members[0], { role: 'A', partnerExerciseId: members[1] });
    pairings.set(members[1], { role: 'B', partnerExerciseId: members[0] });
  }
  return nextWorkoutSet(workout.sets, movements.map((movement) => movement.id), undefined, undefined, pairings);
}

/**
 * A movement's set count for today. The rows are today's sets, so today's
 * count is the one number shown; when it differs from the program the
 * difference is said plainly once ("3 sets · 1 fewer than planned").
 */
export function todaySetCountLabel(todaySets: number, programSets?: number | null): string {
  const count = `${todaySets} ${todaySets === 1 ? 'set' : 'sets'}`;
  if (!programSets || programSets === todaySets) return count;
  const difference = Math.abs(programSets - todaySets);
  return `${count} · ${difference} ${todaySets < programSets ? 'fewer' : 'more'} than planned`;
}

/**
 * A closed movement's progress, stated once with today's set count: "3 sets"
 * before any is logged, "1 of 3 sets" part-way, "3 sets · Complete" when done.
 */
export function movementProgressLabel(completed: number, total: number): string {
  const count = `${total} ${total === 1 ? 'set' : 'sets'}`;
  if (total > 0 && completed >= total) return `${count} · Complete`;
  return completed > 0 ? `${completed} of ${count}` : count;
}

/** "60 × 9" for an autofill offer, so it can be weighed against the plan. */
const offerNumbers = (values: AutofillSetValues) => (values.weight && values.reps ? `${values.weight} × ${values.reps}` : '');

/**
 * The offer to reuse earlier numbers, named for what it does. Planned numbers
 * carry no progression reason, so the offer never implies one: it repeats
 * last workout's (or this session's last) set.
 */
export function repeatOfferLabel(values: AutofillSetValues): string {
  const verb = values.source === 'current_workout' ? 'Repeat last set' : 'Repeat last';
  const numbers = offerNumbers(values);
  return numbers ? `${verb} · ${numbers}` : verb;
}

/** Elapsed session time ("24m"), or a dash before the session has a start. */
export function formatSessionDuration(createdAt: string | null, now: number): string {
  return createdAt
    ? formatWorkoutDuration(Math.max(0, now - new Date(createdAt).getTime()))
    : '—';
}

/** The compact bar title once the session title has scrolled under the bar. */
export function compactSessionTitle(title: string, elapsed: string): string {
  return `${title} · ${elapsed}`;
}

/**
 * Where the live session header settles once scrolling ends. Like a large
 * title it rests expanded (0) or collapsed under the bar (`collapse`, the
 * scroll at which the title and ring sit wholly under the bar's solid edge),
 * never in between where the ring would rest half-faded. Null: leave it.
 */
export function liveHeaderSnapTarget(scrollTop: number, collapse: number): number | null {
  if (collapse <= 1 || scrollTop <= 0.5 || scrollTop >= collapse - 0.5) return null;
  return scrollTop < collapse / 2 ? 0 : collapse;
}

/**
 * The scroll at which the session header (title and ring) has gone wholly
 * under the bar's solid edge: its bottom in the scroll column, less the
 * band's solid height. Rounded up so the ring never peeks into the fade.
 *
 * Given where the first movement's content starts and where the band's ramp
 * ends (its foot), the collapsed rest instead lands that content on the
 * foot, so no row rests split under the bar. Only the header's quiet
 * trailing edge (padding and its rule, at most half the ramp) may then sit
 * in the ramp's strongest, blurred half; its content stays under the solid.
 */
export function liveHeaderCollapseOffset(
  headerBottom: number,
  edgeSolid: number,
  next?: { contentTop: number; edgeFoot: number },
): number {
  const underSolid = headerBottom - edgeSolid;
  if (!next || !(next.edgeFoot > edgeSolid)) return Math.max(0, Math.ceil(underSolid));
  const halfRamp = (next.edgeFoot - edgeSolid) / 2;
  const clearOfRamp = next.contentTop - next.edgeFoot;
  return Math.max(0, Math.ceil(Math.max(underSolid - halfRamp, Math.min(underSolid, clearOfRamp))));
}

/**
 * Where the live session's scroll may end. Its natural end (content height
 * less the viewport) can leave a movement split under the bar, so the page
 * gets a little extra room to end on a rest instead: an offset where a
 * movement's content starts at the band's ramp foot (and the row above sits
 * wholly under the bar). Never less than the header's collapse; never more
 * than `limit` beyond the natural end (then the natural end stands).
 */
export function liveScrollEnd(naturalEnd: number, collapse: number, rests: number[], limit: number): number {
  if (collapse > naturalEnd + 0.5) return Math.ceil(collapse);
  return Math.max(0, Math.ceil(restingScrollEnd(naturalEnd, rests, limit)));
}
