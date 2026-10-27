// History's data on native: the month on screen, its workouts and activities,
// and every edit to a past workout, through the shared store actions and the
// web's edit protocol (edit → reload → completion only after a clean save).
import { format, isSameMonth, startOfMonth } from 'date-fns';
import { Alert } from 'react-native';
import { create } from 'zustand';

import { captureAccountScope } from '@/lib/accountScope';
import { guardActivityEdit } from '@/lib/activitySessions';
import { fetchHistoryMonth, historyDayKey, type HistoryWorkout } from '@/lib/historyMonth';
import { whoopSyncMessage } from '@/lib/whoopStatus';
import { runWorkoutEdit } from '@/lib/workoutEdit';
import { parseWorkoutNotes, serializeWorkoutNotes } from '@/lib/workoutNotes';
import { useAppStore } from '@/stores/appStore';
import type { ActivitySession, ActivitySessionInput, Workout, WorkoutDayPlan } from '@/types';

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

const initial = (): HistoryState => ({
  month: startOfMonth(new Date()),
  day: format(new Date(), 'yyyy-MM-dd'),
  workouts: [],
  activities: [],
  plans: {},
  loading: true,
  failed: false,
});

export const useHistoryStore = create<HistoryState>(() => initial());

// Only the latest month request may write, so quick month changes can never
// leave one month's data under another's heading.
let monthRequest = 0;
// Edits to one workout run one after another, notes included, so a note save
// and a set edit never overwrite each other.
const queues = new Map<string, Promise<unknown>>();

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
  useHistoryStore.setState(initial());
}

export async function loadHistoryMonth(month = useHistoryStore.getState().month) {
  const request = ++monthRequest;
  const isCurrent = captureAccountScope();
  const changed = !isSameMonth(month, useHistoryStore.getState().month);
  useHistoryStore.setState(changed ? { month, loading: true, failed: false, workouts: [], activities: [] } : { month, failed: false });
  try {
    const { workouts, activities } = await fetchHistoryMonth(month);
    if (request !== monthRequest || !isCurrent()) return;
    useHistoryStore.setState({ workouts, activities, loading: false });
  } catch {
    if (request !== monthRequest || !isCurrent()) return;
    useHistoryStore.setState({ loading: false, failed: true });
  }
}

/** Chooses a day, moving to its month when it lies outside the one on screen. */
export function selectHistoryDay(date: Date) {
  const state = useHistoryStore.getState();
  useHistoryStore.setState({ day: format(date, 'yyyy-MM-dd') });
  if (!isSameMonth(date, state.month)) void loadHistoryMonth(startOfMonth(date));
}

export async function loadPlan(workoutId: string) {
  if (Object.prototype.hasOwnProperty.call(useHistoryStore.getState().plans, workoutId)) return;
  const plan = await useAppStore.getState().fetchWorkoutDayPlanByWorkoutId(workoutId);
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
    try {
      await store.syncWorkoutCompletion(workoutId);
    } catch (error) {
      completionError = error;
    }
  }
  const [workout, plan] = await Promise.all([store.fetchWorkoutById(workoutId), store.fetchWorkoutDayPlanByWorkoutId(workoutId)]);
  if (workout) {
    useHistoryStore.setState((state) => ({
      workouts: state.workouts.map((item) =>
        item.id === workoutId ? { ...workout, split_day: item.split_day, day_label: plan?.day_label ?? item.day_label ?? null } : item,
      ),
      plans: { ...state.plans, [workoutId]: plan ?? null },
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

/** Saves one movement's note (200 characters) into the workout's notes. */
export function savePastNote(workoutId: string, exerciseId: string, text: string): Promise<boolean> {
  return editPastWorkout(workoutId, async () => {
    const workout = useHistoryStore.getState().workouts.find((entry) => entry.id === workoutId);
    const parsed = parseWorkoutNotes(workout?.notes ?? null);
    const notes = { ...parsed.movementNotes };
    const bounded = text.trim().slice(0, NOTE_LIMIT);
    if (bounded) notes[exerciseId] = bounded;
    else delete notes[exerciseId];
    await useAppStore.getState().updateWorkoutNotes(workoutId, serializeWorkoutNotes(notes, parsed.legacyNote));
  });
}

/** Deletes a workout with its sets and plan. Clears the live workout if it was this one. */
export async function deletePastWorkout(workoutId: string): Promise<boolean> {
  try {
    await enqueue(workoutId, () => useAppStore.getState().deleteWorkout(workoutId));
  } catch {
    return false;
  }
  useHistoryStore.setState((state) => {
    const plans = { ...state.plans };
    delete plans[workoutId];
    return { workouts: state.workouts.filter((workout) => workout.id !== workoutId), plans };
  });
  void useAppStore.getState().calculateWeeklyVolume();
  return true;
}

/** Asks before deleting a workout; it cannot be undone. */
export function confirmDeleteWorkout(title: string, workoutId: string, onDeleted?: () => void) {
  Alert.alert(`Delete ${title}?`, 'Its sets are deleted too. This can’t be undone.', [
    { text: 'Cancel', style: 'cancel' },
    {
      text: 'Delete',
      style: 'destructive',
      onPress: async () => {
        const deleted = await deletePastWorkout(workoutId);
        if (deleted) {
          haptics.success();
          onDeleted?.();
        } else {
          haptics.error();
          Alert.alert('Not deleted', 'Check your connection and try again.');
        }
      },
    },
  ]);
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
  useHistoryStore.setState((state) => {
    const others = state.activities.filter((activity) => activity.id !== saved.id);
    const inMonth = isSameMonth(new Date(`${saved.date}T12:00:00`), state.month);
    return { activities: inMonth ? [...others, saved] : others, day: saved.date };
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
  useHistoryStore.setState((state) => ({ activities: state.activities.filter((entry) => entry.id !== activity.id) }));
  return true;
}

/** Merges same-day activities WHOOP recorded separately into one. */
export async function mergeActivities(chosen: ActivitySession[]): Promise<boolean> {
  if (chosen.length < 2) return false;
  try {
    const merged = await useAppStore.getState().mergeActivitySessions(chosen);
    if (!merged) return false;
    const absorbed = new Set(chosen.map((activity) => activity.id).filter((id) => id !== merged.id));
    useHistoryStore.setState((state) => ({
      activities: state.activities.filter((activity) => !absorbed.has(activity.id)).map((activity) => (activity.id === merged.id ? merged : activity)),
    }));
    return true;
  } catch {
    return false;
  }
}

/** Runs a WHOOP sync and reloads the month. The words match the web's History toast. */
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
  const updated = await useAppStore.getState().attachWhoopToWorkout(workout, activity).catch(() => null);
  if (!updated) return false;
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
  useHistoryStore.setState((state) => ({
    workouts: state.workouts.map((entry) => (entry.id === updated.id ? { ...entry, ...updated } : entry)),
  }));
  if (sessionId) await loadHistoryMonth();
  return true;
}
