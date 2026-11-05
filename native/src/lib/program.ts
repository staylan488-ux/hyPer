// Program on native: open the shared editor, act on programs and quick starts
// through the shared store actions, and ask with iOS's own alerts where the
// web uses its confirm sheet or window prompts.
import { router } from 'expo-router';
import { Alert } from 'react-native';
import { create } from 'zustand';

import type { ConfirmOptions } from '@/lib/confirmDialog';
import { dismissPlanStartPrompt, shouldPromptPlanStart } from '@/lib/planSchedule';
import { renameTemplateWithConfirm } from '@/lib/programSummary';
import { parseSetRangeNotes } from '@/lib/setRangeNotes';
import { useAppStore } from '@/stores/appStore';
import { useAuthStore } from '@/stores/authStore';
import { useSplitEditStore, type SavedSplit } from '@/stores/splitEditStore';
import { dayLabel, type DraftExercise, type DraftSplit } from '@/lib/splitDraft';
import type { FlexDayTemplate, Split, Workout } from '@/types';

import { formatTarget } from './format';
import { haptics } from './haptics';

/** The web's confirm question as an iOS alert. */
export function confirmAlert({ title, message, confirmLabel = 'OK', cancelLabel = 'Cancel', destructive }: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: cancelLabel, style: 'cancel', onPress: () => resolve(false) },
      { text: confirmLabel, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}

const userId = () => useAuthStore.getState().user?.id ?? null;

// The caller's control plays the tap (a row, a capsule, a swipe action, or
// the screen's own tap for a header item), so these two stay silent.

/** Opens the editor on a saved program. */
export function editProgram(split: Split) {
  useSplitEditStore.getState().startEdit(split, { userId: userId() });
  router.push({ pathname: '/program-edit', params: { mode: 'edit' } });
}

/** Opens the new-program chooser. */
export function newProgram() {
  useSplitEditStore.getState().cancelEdit();
  router.push({ pathname: '/program-edit', params: { mode: 'new' } });
}

/**
 * After a program is created or set active: offers to set Day 1 and the
 * rhythm when it has no schedule yet, unless Later was chosen for it.
 * Resolves true when it asked, since its alert already says the program is active.
 */
export async function offerPlanStart(splitId: string, name: string): Promise<boolean> {
  const user = userId();
  if (!user || !(await shouldPromptPlanStart(user, splitId))) return false;
  // Only for the program that is still the active one.
  if (useAppStore.getState().activeSplit?.id !== splitId) return false;
  Alert.alert(`${name} is active`, 'Set your Day 1 and weekly rhythm now. It takes about 15 seconds and lets hyPer call your next session.', [
    { text: 'Later', style: 'cancel', onPress: () => dismissPlanStartPrompt(user, splitId) },
    { text: 'Set now', onPress: () => router.push('/schedule') },
  ]);
  return true;
}

/** After the editor saves: a new program may need a schedule; an edit needs a fresh list. */
export function afterProgramSaved(saved: SavedSplit) {
  if (saved.created) void offerPlanStart(saved.id, saved.name);
  else void useAppStore.getState().fetchSplits({ force: true });
}

/** Resolves true when the plan-start alert was shown. */
export async function setActiveProgram(split: Split): Promise<boolean> {
  const result = await useAppStore.getState().setActiveSplit(split.id);
  if (!result.ok) {
    haptics.error();
    Alert.alert('Not changed', result.reason ?? 'Could not set the active program.');
    return false;
  }
  haptics.success();
  return offerPlanStart(split.id, split.name);
}

/** The program a workout in progress came from, which must not be deleted under it. */
function programInUse(split: Split): boolean {
  const workout = useAppStore.getState().currentWorkout;
  if (!workout || workout.completed || !workout.split_day_id) return false;
  return split.days.some((day) => day.id === workout.split_day_id);
}

/** The program day a workout in progress came from, or null. */
export function liveWorkoutDayId(workout: Pick<Workout, 'split_day_id' | 'completed'> | null): string | null {
  return workout && !workout.completed ? workout.split_day_id : null;
}

function refuseLiveDay(label: string) {
  haptics.error();
  Alert.alert('Finish your workout first', `Today's workout is ${label}.`);
}

/** Cached programs do not establish whether this account has an unfinished workout. */
function refuseUntilWorkoutLoaded(): boolean {
  const user = userId();
  if (user && useAppStore.getState().workoutLoadedForUserId === user) return false;
  haptics.error();
  Alert.alert('Workout still loading', 'Wait for your workout to load before removing a day, deleting a program, or saving program edits. If it does not load, check your connection and refresh Train.');
  return true;
}

/**
 * Removing the day a workout in progress came from would drop that session
 * (its workout loses the day), so the editor refuses, as deleting its program
 * does. True when refused.
 */
export function refuseRemovingLiveDay(dayId: string, label: string): boolean {
  if (refuseUntilWorkoutLoaded()) return true;
  if (dayId !== liveWorkoutDayId(useAppStore.getState().currentWorkout)) return false;
  refuseLiveDay(label);
  return true;
}

/** The same at Save, for a draft that left the day out (a restored one can). True when refused. */
export function refuseSavingWithoutLiveDay(draft: Pick<DraftSplit, 'id' | 'days' | '_isNew'>): boolean {
  if (draft._isNew) return false;
  if (refuseUntilWorkoutLoaded()) return true;
  const { currentWorkout, activeSplit, splits } = useAppStore.getState();
  const dayId = liveWorkoutDayId(currentWorkout);
  if (!dayId || draft.days.some((day) => day.id === dayId)) return false;
  const saved = [activeSplit, ...splits].find((split) => split?.id === draft.id);
  const index = saved?.days.findIndex((day) => day.id === dayId) ?? -1;
  if (!saved || index < 0) return false;
  refuseLiveDay(dayLabel(saved.days[index], index));
  return true;
}

/**
 * Programs on their way out: off the list from the moment Delete is chosen,
 * back if the delete fails. A deleted one stays off, even before the list
 * reloads.
 */
export const useDeletingPrograms = create<{ ids: ReadonlySet<string> }>(() => ({ ids: new Set<string>() }));

function markDeleting(id: string, deleting: boolean) {
  useDeletingPrograms.setState((state) => {
    const ids = new Set(state.ids);
    if (deleting) ids.add(id);
    else ids.delete(id);
    return { ids };
  });
}

/**
 * Asks first, as on the web. Once Delete is chosen the program leaves the
 * list and `onConfirmed` runs (its own screen closes there); a failure brings
 * it back. Resolves true once deleted.
 */
export async function deleteProgram(split: Split, onConfirmed?: () => void): Promise<boolean> {
  if (refuseUntilWorkoutLoaded()) return false;
  if (programInUse(split)) {
    haptics.error();
    Alert.alert('Finish your workout first', `Today's workout is from ${split.name}.`);
    return false;
  }
  const confirmed = await confirmAlert({
    title: 'Delete program?',
    message: `${split.name} and its training days will be deleted. Past workouts stay in History.`,
    confirmLabel: 'Delete',
    destructive: true,
  });
  if (!confirmed || refuseUntilWorkoutLoaded()) return false;
  markDeleting(split.id, true);
  onConfirmed?.();
  const result = await useAppStore
    .getState()
    .deleteSplit(split.id)
    .catch((): { ok: boolean; reason?: string } => ({ ok: false }));
  if (!result.ok) {
    markDeleting(split.id, false);
    haptics.error();
    Alert.alert('Not deleted', result.reason ?? 'Could not delete the program.');
    return false;
  }
  haptics.success();
  return true;
}

export function renameQuickStart(template: FlexDayTemplate) {
  Alert.prompt(
    'Rename quick start',
    undefined,
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Save',
        onPress: (text?: string) => {
          const label = (text ?? '').slice(0, 40);
          if (label.trim() === template.label) return;
          void renameTemplateWithConfirm({
            rename: useAppStore.getState().renameFlexTemplate,
            confirmOverwrite: (conflict) =>
              confirmAlert({ title: `Replace “${conflict}”?`, message: 'A quick start with that name already exists.', confirmLabel: 'Replace', destructive: true }),
            templateId: template.id,
            label,
          }).then((failure) => {
            if (failure) {
              haptics.error();
              Alert.alert('Not renamed', failure);
            } else haptics.success();
          });
        },
      },
    ],
    'plain-text',
    template.label,
  );
}

/** Starts a flexible session from a quick start, then shows it on Train. */
export async function startQuickStart(template: FlexDayTemplate): Promise<void> {
  try {
    const started = await useAppStore.getState().startFlexibleWorkoutFromTemplate(template.label);
    if (!started) {
      haptics.error();
      Alert.alert('Finish your other workout first', 'A program session from today is still open.');
      return;
    }
    haptics.success();
    router.dismissTo('/train');
  } catch (error) {
    haptics.error();
    Alert.alert('Could not start', error instanceof Error ? error.message : 'Check your connection and try again.');
  }
}

/** "3 × 8–12", "5 × 5", or "2–4 × 8–12" with a set range. */
export function targetsLine(exercise: DraftExercise): string {
  return formatTarget(exercise.target_sets, exercise.target_reps_min, exercise.target_reps_max, {
    min: exercise.target_sets_min,
    max: exercise.target_sets_max,
  });
}

/**
 * A saved program exercise or planned movement written the same way, its set
 * range read from its notes; null when it names no set count.
 */
export function planTarget(item: {
  notes?: string | null;
  target_sets?: number | null;
  target_reps_min?: number | null;
  target_reps_max?: number | null;
}): string | null {
  if (typeof item.target_sets !== 'number' || item.target_sets < 1) return null;
  const range = parseSetRangeNotes(item.notes, item.target_sets);
  // Without a range the count stays as saved (a session may hold up to 12).
  if (range.minSets === range.maxSets) return formatTarget(item.target_sets, item.target_reps_min, item.target_reps_max);
  return formatTarget(range.targetSets, item.target_reps_min, item.target_reps_max, { min: range.minSets, max: range.maxSets });
}
