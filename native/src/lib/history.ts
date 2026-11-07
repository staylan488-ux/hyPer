// History's data on native: the month on screen, its workouts and activities,
// and every edit to a past workout, through the shared store actions and the
// shared edit protocol in src/lib/workoutEdit (edit → reload → completion only
// after a clean save).
import { format, isSameMonth, startOfMonth } from 'date-fns';
import { Alert } from 'react-native';
import { create } from 'zustand';

import { captureAccountScope } from '@/lib/accountScope';
import { guardActivityEdit, resolveActivityTitle } from '@/lib/activitySessions';
import { fetchHistoryMonth, historyDayKey, moveHistoryMovement, orderHistoryMovements, type HistoryWorkout } from '@/lib/historyMonth';
import { supabase } from '@/lib/supabase';
import { whoopSyncMessage } from '@/lib/whoopStatus';
import { runWorkoutEdit } from '@/lib/workoutEdit';
import { parseWorkoutNotes, serializeWorkoutNotes } from '@/lib/workoutNotes';
import { useAppStore } from '@/stores/appStore';
import type { ActivitySession, ActivitySessionInput, Workout, WorkoutDayPlan } from '@/types';

import { useWorkoutsRevision } from './accountData';
import { haptics } from './haptics';

export const NOTE_LIMIT = 200;

type HistoryState = {
  /** The first day of the month on screen. */
  month: Date;
  /** The chosen day, yyyy-MM-dd. */
  day: string;
  workouts: HistoryWorkout[];
  activities: ActivitySession[];
  /** Session plans by workout id, loaded when a workout opens (null: none). */
  plans: Record<string, WorkoutDayPlan | null>;
  /** True until the month on screen has loaded once. */
  loading: boolean;
  failed: boolean;
};

const dayKeyOf = (date: Date) => format(date, 'yyyy-MM-dd');

const initial = (): HistoryState => ({
  month: startOfMonth(new Date()),
  day: dayKeyOf(new Date()),
  workouts: [],
  activities: [],
  plans: {},
  loading: true,
  failed: false,
});

export const useHistoryStore = create<HistoryState>(() => initial());

// The day History showed as today when it was chosen, so a return after
// midnight moves on to the new today instead of staying on yesterday.
let shownToday: string | null = useHistoryStore.getState().day;

function setDay(day: string): Pick<HistoryState, 'day'> {
  shownToday = day === dayKeyOf(new Date()) ? day : null;
  return { day };
}

// Only the latest month request may write, so quick month changes can never
// leave one month's data under another's heading.
let monthRequest = 0;
// Edits to one workout run one after another, notes included, so a note save
// and a set edit never overwrite each other.
const queues = new Map<string, Promise<unknown>>();
// Workouts, sets and activities taken off the screen whose delete has not
// run yet: a reload meanwhile (an earlier edit's, a pull to refresh) must not
// bring them back.
const removing = new Set<string>();
// How many reloads have landed per workout, so a delete can tell whether the
// screen already shows what the server holds.
const reloads = new Map<string, number>();
// When this screen last changed each workout or activity, on one counter, and
// whether that change took it away (deleted, hidden, merged into another). A
// month read that started before a change keeps the screen's version of that
// row, and leaves out one taken away, instead of bringing back what the change
// replaced (a set just added, a workout just deleted).
let changeSeq = 0;
const changes = new Map<string, { seq: number; gone: boolean }>();

function note(ids: string[], gone: boolean) {
  changeSeq += 1;
  ids.forEach((id) => changes.set(id, { seq: changeSeq, gone }));
}
const markChanged = (...ids: string[]) => note(ids, false);
const markGone = (...ids: string[]) => note(ids, true);
const changedSince = (id: string, since: number) => (changes.get(id)?.seq ?? 0) > since;

/** A month read's rows, with the screen's own version of every row changed since the read started. */
function mergeMonthRows<T extends { id: string }>(fetched: T[], shown: T[], since: number): T[] {
  const kept = new Map(shown.filter((row) => changedSince(row.id, since)).map((row) => [row.id, row]));
  const fetchedIds = new Set(fetched.map((row) => row.id));
  return [
    ...fetched.flatMap((row) => {
      if (removing.has(row.id)) return [];
      if (!changedSince(row.id, since)) return [row];
      if (changes.get(row.id)?.gone) return [];
      // Not on screen (its month was left meanwhile): the read's row stands.
      return [kept.get(row.id) ?? row];
    }),
    ...[...kept.values()].filter((row) => !fetchedIds.has(row.id) && !removing.has(row.id)),
  ];
}

function withoutRemoving(workout: HistoryWorkout): HistoryWorkout {
  return workout.sets.some((set) => removing.has(set.id)) ? { ...workout, sets: workout.sets.filter((set) => !removing.has(set.id)) } : workout;
}

function enqueue<T>(workoutId: string, run: () => Promise<T>): Promise<T> {
  const previous = queues.get(workoutId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(run);
  queues.set(workoutId, next);
  void next.finally(() => {
    if (queues.get(workoutId) === next) queues.delete(workoutId);
  });
  return next;
}

/** Leaves nothing of this account behind (sign-out). */
export function resetHistory() {
  monthRequest += 1;
  queues.clear();
  removing.clear();
  reloads.clear();
  changes.clear();
  const state = initial();
  shownToday = state.day;
  useHistoryStore.setState(state);
}

export async function loadHistoryMonth(month = useHistoryStore.getState().month) {
  const request = ++monthRequest;
  const isCurrent = captureAccountScope();
  const since = changeSeq;
  const state = useHistoryStore.getState();
  const changed = !isSameMonth(month, state.month);
  // A retry after a failure shows Loading, not "Nothing logged", until it answers.
  useHistoryStore.setState(
    changed ? { month, loading: true, failed: false, workouts: [], activities: [] } : { month, failed: false, loading: state.loading || state.failed },
  );
  try {
    const { workouts, activities } = await fetchHistoryMonth(month);
    if (request !== monthRequest || !isCurrent()) return;
    useHistoryStore.setState((current) => ({
      workouts: mergeMonthRows(workouts, current.workouts, since).map(withoutRemoving),
      activities: mergeMonthRows(activities, current.activities, since),
      loading: false,
    }));
  } catch {
    if (request !== monthRequest || !isCurrent()) return;
    useHistoryStore.setState({ loading: false, failed: true });
  }
}

/** Chooses a day, moving to its month when it lies outside the one on screen. */
export function selectHistoryDay(date: Date) {
  const state = useHistoryStore.getState();
  useHistoryStore.setState(setDay(dayKeyOf(date)));
  if (!isSameMonth(date, state.month)) void loadHistoryMonth(startOfMonth(date));
}

/**
 * When History still shows a today that has passed (it was left open past
 * midnight), moves it to the new today and reads that month again. Returns
 * true when it did.
 */
export function followToday(now = new Date()): boolean {
  const today = dayKeyOf(now);
  const { day } = useHistoryStore.getState();
  if (shownToday === null || day !== shownToday || day === today) return false;
  useHistoryStore.setState(setDay(today));
  void loadHistoryMonth(startOfMonth(now));
  return true;
}

/**
 * Reads a workout's plan when it opens. A failed read keeps the plan already
 * shown (or none yet), so the next open tries again; a read that an edit's
 * reload overtook is dropped.
 */
export async function loadPlan(workoutId: string) {
  const isCurrent = captureAccountScope();
  const since = changeSeq;
  let plan: WorkoutDayPlan | null;
  try {
    plan = await useAppStore.getState().fetchWorkoutDayPlanByWorkoutId(workoutId, { throwOnError: true });
  } catch {
    return;
  }
  if (!isCurrent() || changedSince(workoutId, since)) return;
  useHistoryStore.setState((state) => ({
    plans: { ...state.plans, [workoutId]: plan ?? null },
    workouts: plan?.day_label
      ? state.workouts.map((workout) => (workout.id === workoutId ? { ...workout, day_label: plan.day_label } : workout))
      : state.workouts,
  }));
}

/** Reloads one workout and its plan after an edit, syncing completion first on a clean save. */
async function refreshWorkout(workoutId: string, syncCompletion: boolean) {
  const store = useAppStore.getState();
  let completionError: unknown;
  if (syncCompletion) {
    const wasCompleted = useHistoryStore.getState().workouts.find((item) => item.id === workoutId)?.completed ?? false;
    try {
      const { completed } = await store.syncWorkoutCompletion(workoutId);
      // Today and Train count finished workouts, and this edit finished one.
      if (completed && !wasCompleted) useWorkoutsRevision.getState().bump();
    } catch (error) {
      completionError = error;
    }
  }
  const [workout, plan] = await Promise.all([
    store.fetchWorkoutById(workoutId),
    // undefined: the plan could not be read, so the plan shown stays.
    store.fetchWorkoutDayPlanByWorkoutId(workoutId, { throwOnError: true }).catch(() => undefined),
  ]);
  if (workout) {
    reloads.set(workoutId, (reloads.get(workoutId) ?? 0) + 1);
    markChanged(workoutId);
    useHistoryStore.setState((state) => ({
      workouts: state.workouts.map((item) =>
        item.id === workoutId
          ? withoutRemoving({ ...workout, split_day: item.split_day, day_label: plan?.day_label ?? item.day_label ?? null })
          : item,
      ),
      plans: plan === undefined ? state.plans : { ...state.plans, [workoutId]: plan },
    }));
  }
  if (completionError) throw completionError;
}

/**
 * Runs an edit to a past workout. Never rejects: false means it did not save.
 * The workout is reloaded either way, so the screen shows what the server
 * holds even after a partial failure. This week's volume follows the edit.
 */
export function editPastWorkout(workoutId: string, mutate: () => Promise<void>): Promise<boolean> {
  return enqueue(workoutId, async () => {
    const saved = await runWorkoutEdit(mutate, (syncCompletion) => refreshWorkout(workoutId, syncCompletion));
    void useAppStore.getState().calculateWeeklyVolume();
    return saved;
  });
}

/**
 * Saves one movement's note (200 characters) into the workout's notes. The
 * notes field holds every movement's note, so the save builds on what the
 * server holds: the copy here can be behind (after a reload that failed), and
 * building on it would erase the other movements' notes.
 */
export function savePastNote(workoutId: string, exerciseId: string, text: string): Promise<boolean> {
  return editPastWorkout(workoutId, async () => {
    const { data, error } = await supabase.from('workouts').select('notes').eq('id', workoutId).maybeSingle();
    if (error || !data) throw new Error('Could not read the workout notes.');
    const parsed = parseWorkoutNotes((data as { notes: string | null }).notes ?? null);
    const notes = { ...parsed.movementNotes };
    const bounded = text.trim().slice(0, NOTE_LIMIT);
    if (bounded) notes[exerciseId] = bounded;
    else delete notes[exerciseId];
    const serialized = serializeWorkoutNotes(notes, parsed.legacyNote);
    await useAppStore.getState().updateWorkoutNotes(workoutId, serialized);
    // Shown at once, even when the reload after it fails.
    markChanged(workoutId);
    useHistoryStore.setState((state) => ({
      workouts: state.workouts.map((entry) => (entry.id === workoutId ? { ...entry, notes: serialized } : entry)),
    }));
  });
}

/**
 * Moves a movement of a past workout one place up or down, for an edit's
 * mutate. The order comes from the saved plan and the sets on screen when the
 * edit runs, so a second move made before the first one's reload builds on it
 * instead of undoing it.
 */
export async function movePastMovement(workoutId: string, exerciseId: string, direction: -1 | 1): Promise<void> {
  const store = useAppStore.getState();
  const plan = await store.fetchWorkoutDayPlanByWorkoutId(workoutId, { throwOnError: true });
  const sets = useHistoryStore.getState().workouts.find((entry) => entry.id === workoutId)?.sets ?? [];
  const order = moveHistoryMovement(orderHistoryMovements(sets, plan).map((movement) => movement.exerciseId), exerciseId, direction);
  if (order) await store.reorderWorkoutExercises(workoutId, order);
}

/**
 * Deletes one set of a past workout. The row leaves at once; the delete then
 * runs in the workout's queue and reloads it, so a failed delete brings the
 * set back (from here when even the reload could not run). Resolves true
 * once the set is gone.
 */
export async function removePastSet(workoutId: string, exerciseId: string, setId: string): Promise<boolean> {
  const isCurrent = captureAccountScope();
  const set = useHistoryStore.getState().workouts.find((entry) => entry.id === workoutId)?.sets.find((entry) => entry.id === setId) ?? null;
  removing.add(setId);
  markChanged(workoutId);
  useHistoryStore.setState((state) => ({ workouts: state.workouts.map((entry) => (entry.id === workoutId ? withoutRemoving(entry) : entry)) }));
  let deleted = false;
  let reloadsBefore = 0;
  await editPastWorkout(workoutId, async () => {
    reloadsBefore = reloads.get(workoutId) ?? 0;
    try {
      await useAppStore.getState().removeSetFromWorkout(workoutId, exerciseId, setId);
      deleted = true;
    } finally {
      // From here a reload shows what the server holds.
      removing.delete(setId);
    }
  });
  if (!isCurrent()) return false;
  const reloaded = (reloads.get(workoutId) ?? 0) > reloadsBefore;
  const shown = (useHistoryStore.getState().workouts.find((entry) => entry.id === workoutId)?.sets ?? []).some((entry) => entry.id === setId);
  if (reloaded) return !shown;
  if (!deleted && set && !shown) {
    markChanged(workoutId);
    useHistoryStore.setState((state) => ({
      workouts: state.workouts.map((entry) => (entry.id === workoutId ? { ...entry, sets: [...entry.sets, set] } : entry)),
    }));
  }
  return deleted;
}

/**
 * Deletes a workout with its sets and plan. It leaves History at once and
 * comes back if the delete fails. Clears the live workout if it was this one.
 */
export async function deletePastWorkout(workoutId: string): Promise<boolean> {
  const isCurrent = captureAccountScope();
  const { month, workouts } = useHistoryStore.getState();
  const workout = workouts.find((entry) => entry.id === workoutId) ?? null;
  removing.add(workoutId);
  markGone(workoutId);
  useHistoryStore.setState((state) => ({ workouts: state.workouts.filter((entry) => entry.id !== workoutId) }));
  try {
    await enqueue(workoutId, () => useAppStore.getState().deleteWorkout(workoutId));
  } catch {
    removing.delete(workoutId);
    if (workout && isCurrent()) {
      markChanged(workoutId);
      useHistoryStore.setState((state) =>
        isSameMonth(state.month, month) && !state.workouts.some((entry) => entry.id === workoutId) ? { workouts: [...state.workouts, workout] } : {},
      );
    }
    return false;
  }
  removing.delete(workoutId);
  markGone(workoutId);
  useHistoryStore.setState((state) => {
    const plans = { ...state.plans };
    delete plans[workoutId];
    return { workouts: state.workouts.filter((entry) => entry.id !== workoutId), plans };
  });
  void useAppStore.getState().calculateWeeklyVolume();
  // Today and Train re-read what was done: today's session, the plan's place.
  useWorkoutsRevision.getState().bump();
  // The WHOOP activity whose stats it carried is back on its day.
  if (workout?.whoop_session_id && isCurrent()) void loadHistoryMonth();
  return true;
}

type DeleteHooks = {
  /** Runs as soon as Delete is chosen (the row has left by then): a screen showing it can close. */
  onConfirmed?: () => void;
  /** Runs once the delete has gone through. */
  onDeleted?: () => void;
};

/** Asks before deleting; it cannot be undone. Resolves true once deleted, false when kept or not deleted. */
function confirmDelete(title: string, message: string, run: () => Promise<boolean>, hooks: DeleteHooks): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      `Delete ${title}?`,
      message,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            hooks.onConfirmed?.();
            void run().then((deleted) => {
              if (deleted) {
                haptics.success();
                hooks.onDeleted?.();
              } else {
                haptics.error();
                Alert.alert('Not deleted', 'Check your connection and try again.');
              }
              resolve(deleted);
            });
          },
        },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

/** Asks before deleting a workout with its sets. */
export function confirmDeleteWorkout(title: string, workoutId: string, hooks: DeleteHooks = {}): Promise<boolean> {
  return confirmDelete(title, 'Its sets are deleted too. This can’t be undone.', () => deletePastWorkout(workoutId), hooks);
}

export function workoutsOnDay(workouts: HistoryWorkout[], day: string): HistoryWorkout[] {
  return workouts
    .filter((workout) => historyDayKey(workout) === day)
    .sort((a, b) => new Date(a.created_at || `${a.date}T00:00:00`).getTime() - new Date(b.created_at || `${b.date}T00:00:00`).getTime());
}

// ── Activities ────────────────────────────────────────────────

/** Saves a new or edited activity and shows its day. */
export async function saveActivity(editing: ActivitySession | null, input: ActivitySessionInput): Promise<boolean> {
  const store = useAppStore.getState();
  const guarded = guardActivityEdit(input, editing);
  const saved = editing ? await store.updateActivitySession(editing.id, guarded) : await store.createActivitySession(guarded);
  if (!saved) return false;
  markChanged(saved.id);
  useHistoryStore.setState((state) => {
    const others = state.activities.filter((activity) => activity.id !== saved.id);
    const inMonth = isSameMonth(new Date(`${saved.date}T12:00:00`), state.month);
    return { activities: inMonth ? [...others, saved] : others, ...setDay(saved.date) };
  });
  const savedMonth = startOfMonth(new Date(`${saved.date}T12:00:00`));
  if (!isSameMonth(savedMonth, useHistoryStore.getState().month)) void loadHistoryMonth(savedMonth);
  return true;
}

/**
 * Removes an activity. Anything WHOOP knows about is hidden instead of
 * deleted, so its segments stay attached and the next sync relinks rather
 * than recreating it.
 */
export async function deleteActivity(activity: ActivitySession): Promise<boolean> {
  const store = useAppStore.getState();
  try {
    const tombstone = activity.source === 'whoop' || (await store.hasLinkedWhoopSegments(activity.id));
    if (tombstone) {
      const hidden = await store.updateActivitySession(activity.id, { dismissed_at: new Date().toISOString() });
      if (!hidden) return false;
    } else {
      await store.deleteActivitySession(activity.id);
    }
  } catch {
    return false;
  }
  markGone(activity.id);
  useHistoryStore.setState((state) => ({ activities: state.activities.filter((entry) => entry.id !== activity.id) }));
  return true;
}

/** Deletes an activity off the screen at once; it comes back if the delete fails. */
async function removeActivity(activity: ActivitySession): Promise<boolean> {
  const isCurrent = captureAccountScope();
  const { month, activities } = useHistoryStore.getState();
  const shown = activities.find((entry) => entry.id === activity.id) ?? activity;
  removing.add(activity.id);
  markGone(activity.id);
  useHistoryStore.setState((state) => ({ activities: state.activities.filter((entry) => entry.id !== activity.id) }));
  const deleted = await deleteActivity(shown);
  removing.delete(activity.id);
  if (!deleted && isCurrent()) {
    markChanged(activity.id);
    useHistoryStore.setState((state) =>
      isSameMonth(state.month, month) && !state.activities.some((entry) => entry.id === activity.id) ? { activities: [...state.activities, shown] } : {},
    );
  }
  return deleted;
}

/**
 * Asks before deleting an activity, in the same words wherever it is
 * deleted (one added by hand is gone for good).
 */
export function confirmDeleteActivity(activity: ActivitySession, hooks: DeleteHooks = {}): Promise<boolean> {
  return confirmDelete(
    resolveActivityTitle(activity),
    activity.source === 'whoop' ? 'It is hidden from History; WHOOP will not bring it back.' : 'This can’t be undone.',
    () => removeActivity(activity),
    hooks,
  );
}

/** Merges same-day activities WHOOP recorded separately into one. */
export async function mergeActivities(chosen: ActivitySession[]): Promise<boolean> {
  if (chosen.length < 2) return false;
  try {
    const merged = await useAppStore.getState().mergeActivitySessions(chosen);
    if (!merged) return false;
    const absorbed = new Set(chosen.map((activity) => activity.id).filter((id) => id !== merged.id));
    markChanged(merged.id);
    markGone(...absorbed);
    useHistoryStore.setState((state) => ({
      activities: state.activities.filter((activity) => !absorbed.has(activity.id)).map((activity) => (activity.id === merged.id ? merged : activity)),
    }));
    return true;
  } catch {
    return false;
  }
}

/** Runs a WHOOP sync and reloads the month. The words come from the shared src/lib/whoopStatus. */
export async function syncActivities(): Promise<string> {
  try {
    const result = await useAppStore.getState().syncWhoop();
    if (result) await loadHistoryMonth();
    return whoopSyncMessage(result);
  } catch {
    return 'Sync failed';
  }
}

/** Moves an activity's strain and heart rate onto a workout; the activity leaves the day. */
export async function attachStats(workout: Workout, activity: ActivitySession): Promise<boolean> {
  const isCurrent = captureAccountScope();
  const updated = await useAppStore.getState().attachWhoopToWorkout(workout, activity).catch(() => null);
  if (!updated) {
    // The stats may have landed before hiding the activity failed: show what the server holds.
    if (isCurrent()) void loadHistoryMonth();
    return false;
  }
  markChanged(updated.id);
  markGone(activity.id);
  useHistoryStore.setState((state) => ({
    workouts: state.workouts.map((entry) => (entry.id === updated.id ? { ...entry, ...updated } : entry)),
    activities: state.activities.filter((entry) => entry.id !== activity.id),
  }));
  return true;
}

/** Takes the stats back off a workout; the activity returns to its day. */
export async function detachStats(workout: Workout): Promise<boolean> {
  const sessionId = workout.whoop_session_id ?? null;
  const updated = await useAppStore.getState().detachWhoopFromWorkout(workout).catch(() => null);
  if (!updated) return false;
  markChanged(updated.id);
  useHistoryStore.setState((state) => ({
    workouts: state.workouts.map((entry) => (entry.id === updated.id ? { ...entry, ...updated } : entry)),
  }));
  if (sessionId) await loadHistoryMonth();
  return true;
}
